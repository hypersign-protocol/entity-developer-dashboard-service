import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { AdminPeople, AdminPeopleDocument } from '../schema/people.schema';

@Injectable()
export class AdminPeopleRepository {
  constructor(
    @InjectModel(AdminPeople.name)
    private readonly adminPeopleModel: Model<AdminPeopleDocument>,
  ) {}

  async create(adminPeople: AdminPeople): Promise<AdminPeople> {
    const newAdminPeople = new this.adminPeopleModel(adminPeople);
    return newAdminPeople.save();
  }

  async findOneAndUpdate(
    adminPeopleFilterQuery: FilterQuery<AdminPeople>,
    adminPeople: Partial<AdminPeople>,
  ): Promise<AdminPeople> {
    return this.adminPeopleModel.findOneAndUpdate(
      adminPeopleFilterQuery,
      adminPeople,
      {
        new: true,
      },
    );
  }

  async find(
    adminPeopleFilterQuery: FilterQuery<AdminPeople>,
  ): Promise<AdminPeople[]> {
    return this.adminPeopleModel.find(adminPeopleFilterQuery);
  }

  async findOneAndDelete(adminPeopleFilterQuery: FilterQuery<AdminPeople>) {
    return this.adminPeopleModel.findOneAndDelete(adminPeopleFilterQuery);
  }

  async findOne(
    adminPeopleFilterQuery: FilterQuery<AdminPeople>,
  ): Promise<AdminPeople> {
    return this.adminPeopleModel.findOne(adminPeopleFilterQuery);
  }

  async findAllPeopleByAdmin(adminId) {
    return this.adminPeopleModel.aggregate([
      {
        $match: {
          adminId,
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: 'userId',
          as: 'peoples',
        },
      },
      {
        $unwind: {
          path: '$peoples',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $addFields: {
          // userEmailId: '$peoples.email',
          userEmailId: {
            $ifNull: ['$peoples.email', '$userId'],
          },
          authenticators: '$peoples.authenticators',
        },
      },
      {
        $unset: 'peoples',
      },
      {
        $addFields: {
          authenticatorEnabled: {
            $cond: {
              if: {
                $eq: [
                  {
                    $size: { $ifNull: ['$authenticators', []] },
                  },
                  0,
                ],
              },
              then: false,
              else: true,
            },
          },
        },
      },
      {
        $unset: 'authenticators',
      },
    ]);
  }
  async findAllAdminByUser(userId, emailId) {
    return this.adminPeopleModel.aggregate([
      {
        $match: {
          $or: [{ userId: userId }, { userId: emailId }],
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: 'adminId',
          foreignField: 'userId',
          as: 'peoples',
        },
      },
      {
        $unwind: {
          path: '$peoples',
        },
      },
      {
        $addFields: {
          adminEmailId: '$peoples.email',
        },
      },
      {
        $unset: 'peoples',
      },
    ]);
  }
}
