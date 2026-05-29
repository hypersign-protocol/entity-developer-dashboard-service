import { Injectable, Logger } from '@nestjs/common';
import { FilterQuery, Model } from 'mongoose';
import { AuthZCredits, AuthZCreditsDocument } from '../schemas/authz.schema';
import { InjectModel } from '@nestjs/mongoose';

@Injectable()
export class AuthZCreditsRepository {
  constructor(
    @InjectModel(AuthZCredits.name)
    private readonly authZCreditModel: Model<AuthZCreditsDocument>,
  ) {}
  async create(authZCredits: AuthZCredits): Promise<AuthZCredits> {
    Logger.log(
      'Inside create() to create new record of authzDetail',
      'AuthZCreditsRepository',
    );

    const newAuthZCredits = new this.authZCreditModel(authZCredits);
    return newAuthZCredits.save();
  }

  async find(authZCreditsFilterQuery: FilterQuery<AuthZCredits>) {
    Logger.log('Inside find() to find authzDetail', 'AuthZCreditsRepository');

    return this.authZCreditModel.find(authZCreditsFilterQuery);
  }
  async deleteAuthzDetail(authZCreditsFilterQuery: FilterQuery<AuthZCredits>) {
    Logger.log(
      'Inside deleteAuthzDetail() to delete authzDetail',
      'AuthZCreditsRepository',
    );
    return this.authZCreditModel.findOneAndDelete(authZCreditsFilterQuery);
  }
}
