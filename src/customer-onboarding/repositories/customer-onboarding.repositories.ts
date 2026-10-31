import { InjectModel } from '@nestjs/mongoose';
import {
  CustomerOnboarding,
  CustomerOnboardingDocument,
} from '../schemas/customer-onboarding.schema';
import { Model, FilterQuery, QueryOptions, UpdateQuery } from 'mongoose';
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
    options?: QueryOptions<CustomerOnboarding>,
  ) {
    Logger.log(
      'Finding customer onboarding details,',
      'CustomerOnboardingRepository',
    );
    return this.customerOnboardingModel.findOne(
      customerFilterQuery,
      null,
      options,
    );
  }
  /** The owner's organisation id (their onboarding _id), if they have one. */
  async findOrgIdByOwner(userId: string): Promise<string | undefined> {
    const onboarding = await this.customerOnboardingModel
      .findOne({ userId }, { _id: 1 })
      .lean();
    return onboarding?._id?.toString();
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
