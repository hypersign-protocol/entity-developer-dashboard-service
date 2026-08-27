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
import { CreateCreditLedgerEvent } from './credit-ledger.repository';
import {
  CreditCommitLedgerStatus,
  CreditCommitOutbox,
} from '../schemas/credit-commit-outbox.schema';
import { randomUUID } from 'crypto';

@Injectable()
export class CreditRepository {
  constructor(
    @InjectModel(CreditPlan.name)
    private readonly creditModel: Model<CreditPlanDocument>,
    @InjectModel(CreditCommitOutbox.name)
    private readonly creditCommitOutboxModel: Model<CreditCommitOutbox>,
  ) {}

  async initializeCommitPersistence(): Promise<void> {
    await this.creditCommitOutboxModel.init();
  }

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
    const statusCondition =
      serviceType === SERVICE_TYPES.SSI_API
        ? {
            $and: [
              {
                $eq: [
                  isApiCredit
                    ? updatedUsed
                    : { $ifNull: ['$apiCredit.used', 0] },
                  '$apiCredit.total',
                ],
              },
              {
                $eq: [
                  isBlockchainCredit
                    ? updatedUsed
                    : { $ifNull: ['$onChainAllowance.usedAmount', 0] },
                  '$onChainAllowance.amount',
                ],
              },
            ],
          }
        : { $eq: [updatedUsed, `$${totalField}`] };
    const session = await this.creditModel.db.startSession();
    let updatedCredit: CreditPlan = null;
    try {
      await session.withTransaction(async () => {
        await new this.creditCommitOutboxModel({
          ...ledgerEvent,
          ledgerStatus: CreditCommitLedgerStatus.PENDING,
        }).save({ session });

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
                    $cond: [statusCondition, CreditStatus.INACTIVE, '$status'],
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
      await this.creditCommitOutboxModel
        .exists({ eventId, 'metadata.serviceId': appId })
        .exec(),
    );
  }

  async claimCommitLedgerWrite(
    eventId: string,
    leaseMs = 30_000,
  ): Promise<string | null> {
    const now = new Date();
    const leaseToken = randomUUID();
    const claimed = await this.creditCommitOutboxModel
      .findOneAndUpdate(
        {
          eventId,
          ledgerStatus: { $ne: CreditCommitLedgerStatus.WRITTEN },
          $or: [
            { ledgerStatus: CreditCommitLedgerStatus.PENDING },
            {
              ledgerStatus: CreditCommitLedgerStatus.WRITING,
              ledgerLeaseUntil: { $lte: now },
            },
            {
              ledgerStatus: CreditCommitLedgerStatus.WRITING,
              ledgerLeaseUntil: { $exists: false },
            },
          ],
        },
        {
          $set: {
            ledgerStatus: CreditCommitLedgerStatus.WRITING,
            ledgerLeaseToken: leaseToken,
            ledgerLeaseUntil: new Date(now.getTime() + leaseMs),
          },
          $inc: { ledgerAttempts: 1 },
          $unset: { ledgerLastError: '' },
        },
        { new: true },
      )
      .lean()
      .exec();
    return claimed ? leaseToken : null;
  }

  async markCommitLedgerWritten(
    eventId: string,
    leaseToken?: string,
  ): Promise<void> {
    await this.creditCommitOutboxModel
      .updateOne(
        {
          eventId,
          ...(leaseToken && { ledgerLeaseToken: leaseToken }),
        },
        {
          $set: {
            ledgerStatus: CreditCommitLedgerStatus.WRITTEN,
            ledgerWrittenAt: new Date(),
          },
          $unset: {
            ledgerLeaseToken: '',
            ledgerLeaseUntil: '',
            ledgerLastError: '',
          },
        },
      )
      .exec();
  }

  async releaseCommitLedgerWrite(
    eventId: string,
    leaseToken: string,
    error: unknown,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    await this.creditCommitOutboxModel
      .updateOne(
        { eventId, ledgerLeaseToken: leaseToken },
        {
          $set: {
            ledgerStatus: CreditCommitLedgerStatus.PENDING,
            ledgerLastError: message.slice(0, 2_000),
          },
          $unset: { ledgerLeaseToken: '', ledgerLeaseUntil: '' },
        },
      )
      .exec();
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
