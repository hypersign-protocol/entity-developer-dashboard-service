import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, UpdateQuery } from 'mongoose';
import {
  CreditPlan,
  CreditPlanDocument,
  CreditStatus,
  OnChainCreditAllowance,
  scope,
} from '../schemas/credit.schema';
import { CreditType } from '@hypersign-protocol/credit-middleware';
import { SERVICE_TYPES } from '../../supported-service/services/iServiceList';
import { CreditLedger } from '../schemas/credit-ledger.schema';
import { CreateCreditLedgerEvent } from './credit-ledger.repository';

@Injectable()
export class CreditRepository {
  constructor(
    @InjectModel(CreditPlan.name)
    private readonly creditModel: Model<CreditPlanDocument>,
    @InjectModel(CreditLedger.name)
    private readonly creditLedgerModel: Model<CreditLedger>,
  ) {}

  async create(credit: Partial<CreditPlan>): Promise<CreditPlan> {
    Logger.log('Creating credit plan', 'CreditRepository');
    if (credit.serviceId && credit.referenceId) {
      return this.creditModel
        .findOneAndUpdate(
          { serviceId: credit.serviceId, referenceId: credit.referenceId },
          { $setOnInsert: credit },
          { new: true, upsert: true, setDefaultsOnInsert: true },
        )
        .exec();
    }
    return new this.creditModel(credit).save();
  }

  async findCreditDetailList(
    creditFilterQuery: FilterQuery<CreditPlan>,
  ): Promise<CreditPlan[]> {
    Logger.log('Fetching list of credit plan', 'CreditRepository');

    return this.creditModel
      .find(creditFilterQuery)
      .sort({ createdAt: 1 })
      .exec();
  }

  async findParticularCreditDetail(
    creditFilterQuery: FilterQuery<CreditPlan>,
  ): Promise<CreditPlan> {
    Logger.log('Fetching particular credit detail ', 'CreditRepository');
    return this.creditModel.findOne(creditFilterQuery);
  }

  async findActiveCreditForService(
    serviceId: string,
    excludeCreditId?: string,
  ): Promise<CreditPlan> {
    const now = new Date();
    return this.creditModel
      .findOne({
        serviceId,
        status: CreditStatus.ACTIVE,
        ...(excludeCreditId && { _id: { $ne: excludeCreditId } }),
        $or: [
          { expiresAt: { $gt: now } },
          { expiresAt: { $exists: false } },
          { expiresAt: null },
        ],
        $expr: { $lt: ['$apiCredit.used', '$apiCredit.total'] },
      })
      .lean()
      .exec();
  }

  async findOneAndUpdate(
    filter: FilterQuery<CreditPlan>,
    update: UpdateQuery<CreditPlan>,
  ): Promise<CreditPlan> {
    Logger.log('Updating one credit detail', 'CreditRepository');
    return this.creditModel
      .findOneAndUpdate(filter, update, { new: true })
      .lean()
      .exec();
  }

  async applyPlanCreditCommit(
    appId: string,
    planId: string,
    amount: number,
    eventId: string,
    creditType: string,
    serviceType: string,
    ledgerEvent: CreateCreditLedgerEvent,
  ): Promise<CreditPlan> {
    const isApiCredit = creditType === CreditType.API_CREDIT;
    const isBlockchainCredit = creditType === CreditType.BLOCKCHAIN_TXN_CREDIT;
    if (!isApiCredit && !isBlockchainCredit) {
      throw new Error(`Unsupported committed credit type: ${creditType}`);
    }
    const usedField = isApiCredit
      ? 'apiCredit.used'
      : 'onChainAllowance.usedAmount';
    const totalField = isApiCredit
      ? 'apiCredit.total'
      : 'onChainAllowance.amount';
    const usedValue = { $ifNull: [`$${usedField}`, 0] };
    const updatedUsed = { $add: [usedValue, amount] };
    const session = await this.creditModel.db.startSession();
    let updatedCredit: CreditPlan = null;
    try {
      await session.withTransaction(async () => {
        await new this.creditLedgerModel(ledgerEvent).save({ session });

        updatedCredit = await this.creditModel
          .findOneAndUpdate(
            {
              _id: planId,
              serviceId: appId,
              serviceType,
              $expr: {
                $lte: [updatedUsed, `$${totalField}`],
              },
            },
            [
              {
                $set: {
                  [usedField]: updatedUsed,
                  status: {
                    $cond: [
                      {
                        $eq: [updatedUsed, `$${totalField}`],
                      },
                      CreditStatus.INACTIVE,
                      '$status',
                    ],
                  },
                },
              },
            ],
            { new: true, session },
          )
          .lean()
          .exec();
        if (!updatedCredit) {
          throw new Error(
            `Credit commit exceeds the plan balance or the plan does not exist`,
          );
        }
      });
      return updatedCredit;
    } catch (error) {
      if (this.isDuplicateKeyError(error)) return null;
      throw error;
    } finally {
      await session.endSession();
    }
  }

  /**
   * Activates an SSI plan without replacing lifecycle-owned usage fields.
   *
   * The aggregation update evaluates against the latest Mongo document. This
   * is important because a blockchain commit can arrive while the external
   * AuthZ/FeeGrant transaction is still being confirmed.
   */
  async activateSsiCreditPlan(
    appId: string,
    planId: string,
    expiresAt: Date,
    criticalBalance: number,
    newAllowance?: OnChainCreditAllowance,
    newScopes?: scope[],
  ): Promise<CreditPlan> {
    const allowance = newAllowance
      ? {
          amount: newAllowance.amount,
          denom: newAllowance.denom,
          usedAmount: 0,
        }
      : null;
    return this.creditModel
      .findOneAndUpdate(
        { _id: planId, serviceId: appId },
        [
          {
            $set: {
              serviceType: SERVICE_TYPES.SSI_API,
              expiresAt,
              criticalBalance,
              ...(allowance
                ? {
                    onChainAllowance: {
                      $ifNull: ['$onChainAllowance', allowance],
                    },
                  }
                : {}),
              ...(newScopes
                ? {
                    onChainAllowanceScopes: {
                      $cond: [
                        {
                          $gt: [
                            {
                              $size: {
                                $ifNull: ['$onChainAllowanceScopes', []],
                              },
                            },
                            0,
                          ],
                        },
                        '$onChainAllowanceScopes',
                        newScopes,
                      ],
                    },
                  }
                : {}),
            },
          },
          {
            $set: {
              status: {
                $cond: [
                  {
                    $and: [
                      { $gt: ['$expiresAt', '$$NOW'] },
                      {
                        $lt: [
                          { $ifNull: ['$apiCredit.used', 0] },
                          { $ifNull: ['$apiCredit.total', 0] },
                        ],
                      },
                      {
                        $lt: [
                          { $ifNull: ['$onChainAllowance.usedAmount', 0] },
                          { $ifNull: ['$onChainAllowance.amount', 0] },
                        ],
                      },
                    ],
                  },
                  CreditStatus.ACTIVE,
                  CreditStatus.INACTIVE,
                ],
              },
            },
          },
        ],
        { new: true },
      )
      .lean()
      .exec();
  }

  async hasProcessedCommit(appId: string, eventId: string): Promise<boolean> {
    return Boolean(
      await this.creditLedgerModel
        .exists({ eventId, 'metadata.serviceId': appId })
        .exec(),
    );
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: number }).code === 11000
    );
  }

  async findBasedOnAggregationPipeline(pipeline): Promise<any[]> {
    Logger.log(
      'Inside findBasedOnAggregationPipeline() to fetch credit based on aggregation',
      'CreditRepository',
    );
    return this.creditModel.aggregate(pipeline);
  }
}
