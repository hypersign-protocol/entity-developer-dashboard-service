import { Injectable } from '@nestjs/common';
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
    const newAuthZCredits = new this.authZCreditModel(authZCredits);
    return newAuthZCredits.save();
  }

  async find(authZCreditsFilterQuery: FilterQuery<AuthZCredits>) {
    return this.authZCreditModel.find(authZCreditsFilterQuery);
  }
  async deleteAuthzDetail(authZCreditsFilterQuery: FilterQuery<AuthZCredits>) {
    return this.authZCreditModel.findOneAndDelete(authZCreditsFilterQuery);
  }
}
