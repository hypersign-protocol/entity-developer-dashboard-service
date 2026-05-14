import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { Role, RoleDocument } from '../schemas/role.schema';
import { Injectable } from '@nestjs/common';

@Injectable()
export class RoleRepository {
  constructor(
    @InjectModel(Role.name) private readonly roleModel: Model<RoleDocument>,
  ) {}

  async create(role: Role): Promise<Role> {
    const newRole = new this.roleModel(role);
    return newRole.save();
  }

  async find(roleFilterQuery: FilterQuery<Role>) {
    return this.roleModel.find(roleFilterQuery);
  }
  async findOne(roleFilterQuery: FilterQuery<Role>) {
    return this.roleModel.findOne(roleFilterQuery);
  }

  async findOneAndUpdate(
    roleFilterQuery: FilterQuery<Role>,
    role: Partial<Role>,
  ) {
    return this.roleModel.findOneAndUpdate(roleFilterQuery, role, {
      new: true,
    });
  }

  async findOneAndDelete(roleFilterQuery: FilterQuery<Role>) {
    return this.roleModel.findOneAndDelete(roleFilterQuery);
  }
  async findUsingAggregation(pipeline: any) {
    return this.roleModel.aggregate(pipeline);
  }
}
