import { App, AppDocument } from '../schemas/app.schema';
import { FilterQuery, Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class AppRepository {
  constructor(
    @InjectModel(App.name) private readonly appModel: Model<AppDocument>,
  ) {}

  async findOne(appFilterQuery: FilterQuery<App>): Promise<App> {
    Logger.log(
      'findOne() method: starts, finding particular app from db',
      'AppRepository',
    );

    return this.appModel.findOne(appFilterQuery);
  }
  async find(appsFilterQuery: FilterQuery<App>): Promise<App[]> {
    Logger.log(
      'find() method: starts, finding list of apps from db',
      'AppRepository',
    );

    return this.appModel.aggregate([
      { $match: { userId: appsFilterQuery.userId } },
      {
        $facet: {
          totalCount: [{ $count: 'total' }],
          data: [
            { $skip: appsFilterQuery.paginationOption.skip },
            { $limit: appsFilterQuery.paginationOption.limit },
            {
              $project: {
                appName: 1,
                appId: 1,
                edvId: 1,
                walletAddress: 1,
                description: 1,
                logoUrl: 1,
                whitelistedCors: 1,
                _id: 0,
              },
            },
          ],
        },
      },
    ]);
  }

  async create(app: App): Promise<App> {
    Logger.log(
      'create() method: starts, adding app data to db',
      'AppRepository',
    );

    const newapp = new this.appModel(app);
    return newapp.save();
  }

  async findOneAndUpdate(
    appFilterQuery: FilterQuery<App>,
    app: Partial<App>,
  ): Promise<App> {
    Logger.log(
      'findOneAndUpdate() method: starts, update  app data to db',
      'AppRepository',
    );

    return this.appModel.findOneAndUpdate(appFilterQuery, app, { new: true });
  }

  async findOneAndDelete(appFilterQuery: FilterQuery<App>): Promise<App> {
    Logger.log(
      'findOneAndDelete() method: starts, delete  app data to db',
      'AppRepository',
    );

    return this.appModel.findOneAndDelete(appFilterQuery);
  }
}
