import { Logger } from '@nestjs/common';
import { User, UserDocument } from '../schema/user.schema';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, UpdateQuery } from 'mongoose';

export class UserRepository {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}
  async findOne(userFilterQuery: FilterQuery<User>): Promise<User> {
    Logger.log(
      'findOne() method: starts, finding particular user from db',
      'UserRepository',
    );
    return this.userModel.findOne(userFilterQuery).lean();
  }

  async create(user: User): Promise<UserDocument> {
    Logger.log(
      'create() method: starts, adding user to userDb',
      'UserRepository',
    );
    const newUser = new this.userModel(user);
    return newUser.save();
  }

  async findOneUpdate(
    userFilterQuery: FilterQuery<UserDocument>,
    user: UpdateQuery<UserDocument>,
  ) {
    Logger.log(
      'findOneUpdate() method: start, updating user db',
      'UserRepository',
    );
    return this.userModel.findOneAndUpdate(userFilterQuery, user, {
      new: true,
    });
  }
  async find(userFilterQuery: FilterQuery<User>): Promise<User[]> {
    Logger.log(
      'find() method: starts, finding particular user from db',
      'UserRepository',
    );
    return this.userModel.find(userFilterQuery).lean();
  }
}
