import { InjectModel } from '@nestjs/mongoose';
import {
  CustomerOnboarding,
  CustomerOnboardingDocument,
} from '../schemas/customer-onboarding.schema';
import { Model, FilterQuery, UpdateQuery } from 'mongoose';
import { Logger } from '@nestjs/common';

export class CustomerOnboardingRepository {
  constructor(
    @InjectModel(CustomerOnboarding.name)
    private readonly customerOnboardingModel: Model<CustomerOnboardingDocument>,
  ) {}
  async createCustomerOnboarding(
    data: CustomerOnboarding,
  ): Promise<CustomerOnboarding> {
    Logger.log(
      'Creating customer onboarding and stroring in DB',
      'CustomerOnboardingRepository',
    );
    const createdCustomerOnboarding = new this.customerOnboardingModel(data);
    return createdCustomerOnboarding.save();
  }
  findCustomerOnboardingById(
    customerFilterQuery: FilterQuery<CustomerOnboarding>,
  ) {
    Logger.log(
      'Finding customer onboarding details,',
      'CustomerOnboardingRepository',
    );
    return this.customerOnboardingModel.findOne(customerFilterQuery);
  }
  async findCustomerOnboardings(
    customerFilterQuery: FilterQuery<CustomerOnboarding>,
    page: number,
    limit: number,
  ) {
    Logger.log(
      'Finding customer onboarding records',
      'CustomerOnboardingRepository',
    );
    const [result] = await this.customerOnboardingModel.aggregate([
      { $match: customerFilterQuery },
      {
        $facet: {
          data: [
            { $sort: { createdAt: -1 } },
            { $skip: (page - 1) * limit },
            { $limit: limit },
          ],
          totalCount: [{ $count: 'count' }],
        },
      },
      {
        $project: {
          data: 1,
          totalCount: {
            $ifNull: [{ $arrayElemAt: ['$totalCount.count', 0] }, 0],
          },
        },
      },
    ]);
    return result;
  }
  updateCustomerOnboardingDetails(
    customerFilterQuery: FilterQuery<CustomerOnboarding>,
    updateData: UpdateQuery<CustomerOnboarding>,
  ) {
    Logger.log(
      'Updating customer onboarding details',
      'CustomerOnboardingRepository',
    );
    return this.customerOnboardingModel.findOneAndUpdate(
      customerFilterQuery,
      updateData,
      { new: true },
    );
  }
}
