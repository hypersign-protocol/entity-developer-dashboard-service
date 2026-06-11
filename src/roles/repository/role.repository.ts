import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { Role, RoleDocument } from '../schemas/role.schema';
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class RoleRepository {
  constructor(
    @InjectModel(Role.name) private readonly roleModel: Model<RoleDocument>,
  ) {}

  async create(role: Role): Promise<Role> {
    Logger.log('Inside create() to create new role', 'RoleRepository');
    const newRole = new this.roleModel(role);
    return newRole.save();
  }

  async find(roleFilterQuery: FilterQuery<Role>) {
    Logger.log('Inside find() to fetch particular role', 'RoleRepository');
    return this.roleModel.find(roleFilterQuery);
  }
  async findOne(roleFilterQuery: FilterQuery<Role>) {
    Logger.log('Inside findOne() to fetch particular role', 'RoleRepository');
    return this.roleModel.findOne(roleFilterQuery);
  }

  async findOneAndUpdate(
    roleFilterQuery: FilterQuery<Role>,
    role: Partial<Role>,
  ) {
    Logger.log('Inside findOneAndUpdate to update role', 'RoleRepository');
    return this.roleModel.findOneAndUpdate(roleFilterQuery, role, {
      new: true,
    });
  }

  async findOneAndDelete(roleFilterQuery: FilterQuery<Role>) {
    Logger.log('Inside findOneAndDelete to delete role', 'RoleRepository');
    return this.roleModel.findOneAndDelete(roleFilterQuery);
  }

  async findUsingAggregation(pipeline: any) {
    Logger.log(
      'Inside findUsingAggregation to fetch role list based on pipeline',
      'RoleRepository',
    );
    return this.roleModel.aggregate(pipeline);
  }
}
