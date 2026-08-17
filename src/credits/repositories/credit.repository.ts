import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, UpdateQuery } from 'mongoose';
import { CreditPlan, CreditPlanDocument } from '../schemas/credit.schema';

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

  async updateMany(
    filter: FilterQuery<CreditPlan>,
    update: UpdateQuery<CreditPlan>,
  ) {
    Logger.log(
      'Inside updateMany() to update multiple credit at a time',
      'CreditRepository',
    );
    return this.creditModel.updateMany(filter, update).exec();
  }

  async findByIdAndUpdate(
    id: string,
    update: UpdateQuery<CreditPlan>,
  ): Promise<CreditPlan> {
    Logger.log(
      'Inside findByIdAndUpdate() to update  credit detail',
      'CreditRepository',
    );

    return this.creditModel
      .findByIdAndUpdate(id, update, { new: true })
      .lean()
      .exec();
  }

  async applyCreditCommit(
    creditId: string,
    appId: string,
    amount: number,
  ): Promise<CreditPlan> {
    return this.creditModel
      .findOneAndUpdate(
        {
          _id: creditId,
          serviceId: appId,
          $expr: {
            $lte: [{ $add: ['$apiCredit.used', amount] }, '$apiCredit.total'],
          },
        },
        {
          $inc: { 'apiCredit.used': amount },
        },
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
