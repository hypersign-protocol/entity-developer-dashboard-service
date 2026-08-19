import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, UpdateQuery } from 'mongoose';
import {
  CreditPlan,
  CreditPlanDocument,
  CreditStatus,
} from '../schemas/credit.schema';

@Injectable()
export class CreditRepository {
  constructor(
    @InjectModel(CreditPlan.name)
    private readonly creditModel: Model<CreditPlanDocument>,
  ) {}

  async create(credit: Partial<CreditPlan>): Promise<CreditPlan> {
    Logger.log('Creating credit plan', 'CreditRepository');
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

  async applyPlanCreditReservation(
    appId: string,
    planId: string,
    amount: number,
  ): Promise<CreditPlan> {
    return this.creditModel
      .findOneAndUpdate(
        {
          _id: planId,
          serviceId: appId,
          $expr: {
            $lte: [{ $add: ['$apiCredit.used', amount] }, '$apiCredit.total'],
          },
        },
        [
          {
            $set: {
              'apiCredit.used': { $add: ['$apiCredit.used', amount] },
              status: {
                $cond: [
                  {
                    $eq: [
                      { $add: ['$apiCredit.used', amount] },
                      '$apiCredit.total',
                    ],
                  },
                  CreditStatus.INACTIVE,
                  '$status',
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

  async releasePlanCreditReservation(
    appId: string,
    planId: string,
    restoredAmount: number,
  ): Promise<CreditPlan> {
    return this.creditModel
      .findOneAndUpdate(
        {
          _id: planId,
          serviceId: appId,
          $expr: { $gte: ['$apiCredit.used', restoredAmount] },
        },
        [
          {
            $set: {
              'apiCredit.used': {
                $subtract: ['$apiCredit.used', restoredAmount],
              },
              status: {
                $cond: [
                  {
                    $and: [
                      {
                        $lt: [
                          { $subtract: ['$apiCredit.used', restoredAmount] },
                          '$apiCredit.total',
                        ],
                      },
                      {
                        $or: [
                          { $gt: ['$expiresAt', '$$NOW'] },
                          { $eq: ['$expiresAt', null] },
                          { $eq: [{ $type: '$expiresAt' }, 'missing'] },
                        ],
                      },
                    ],
                  },
                  CreditStatus.ACTIVE,
                  '$status',
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

  async findBasedOnAggregationPipeline(pipeline): Promise<any[]> {
    Logger.log(
      'Inside findBasedOnAggregationPipeline() to fetch credit based on aggregation',
      'CreditRepository',
    );
    return this.creditModel.aggregate(pipeline);
  }
}
