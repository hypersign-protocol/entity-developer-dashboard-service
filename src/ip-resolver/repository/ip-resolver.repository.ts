import { InjectModel } from '@nestjs/mongoose';
import { IpDocument, IpResolver } from '../schemas/ip-resolver.schema';
import { FilterQuery, Model } from 'mongoose';
import { Logger } from '@nestjs/common';

export class IpResolverRepository {
  constructor(
    @InjectModel(IpResolver.name)
    private readonly ipResolverModel: Model<IpDocument>,
  ) {}
  async find(ipFilterQuery: FilterQuery<IpResolver>): Promise<IpResolver[]> {
    Logger.log(
      'find() method: starts, finding ipDetails',
      'IpResolverReposiotry',
    );
    return this.ipResolverModel.find(ipFilterQuery);
  }

  async create(ipDetail: IpResolver): Promise<IpResolver> {
    Logger.log(
      'create() method: start, add ip data to db',
      'IpResolverRepository',
    );
    const newIpData = new this.ipResolverModel(ipDetail);
    return newIpData.save();
  }
  async insertMany(data): Promise<IpResolver[]> {
    Logger.log(
      'Inside insertMany(): to insert many document at a time',
      'IpResolverRepository',
    );
    return this.ipResolverModel.insertMany(data);
  }
}
