import { App, AppDocument } from '../schemas/app.schema';
import { FilterQuery, Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupportedServiceService } from 'src/supported-service/services/supported-service.service';
import * as url from 'url';

@Injectable()
export class AppRepository {
  constructor(
    @InjectModel(App.name) private readonly appModel: Model<AppDocument>,
    private readonly config: ConfigService,
    private readonly supportedServices: SupportedServiceService,
  ) {}

  private appDataProjectPipelineToReturn() {
    return {
      appName: 1,
      appId: 1,
      edvId: 1,
      walletAddress: 1,
      description: 1,
      logoUrl: 1,
      whitelistedCors: 1,
      subdomain: 1,
      services: 1,
      dependentServices: 1,
      domain: 1,
      issuerDid: 1,
      env: 1,
      hasDomainVerified: 1,
      domainLinkageCredentialString: 1,
      _id: 0,
      tenantUrl: {
        $concat: [
          {
            $arrayElemAt: [
              {
                $split: [{ $arrayElemAt: ['$services.domain', 0] }, '://'],
              },
              0,
            ],
          },
          '://',
          '$subdomain',
          '.',
          {
            $arrayElemAt: [
              {
                $split: [{ $arrayElemAt: ['$services.domain', 0] }, '://'],
              },
              1,
            ],
          },
        ],
      },
    };
  }

  private getTenantUrlAggeration() {
    return [
      {
        $addFields: {
          serviceDomain: {
            $arrayElemAt: ['$services.domain', 0],
          },
        },
      },
      {
        $match: {
          serviceDomain: { $exists: true },
        },
      },
      {
        $set: {
          serviceDomainProtocol: {
            $arrayElemAt: [
              {
                $split: ['$serviceDomain', '://'],
              },
              0,
            ],
          },
          serviceDomainHostname: {
            $arrayElemAt: [
              {
                $split: ['$serviceDomain', '://'],
              },
              1,
            ],
          },
        },
      },
      {
        $set: {
          tenantUrl: {
            $concat: [
              '$serviceDomainProtocol',
              '//:',
              '$subdomain',
              '.',
              '$serviceDomainHostname',
            ],
          },
        },
      },
    ];
  }

  async findOne(appFilterQuery: FilterQuery<App>): Promise<App> {
    Logger.log(
      'findOne() method: starts, finding particular app from db',
      'AppRepository',
    );
    const aggrerationPipeline = [
      { $match: appFilterQuery },
      ...this.getTenantUrlAggeration(),
    ];
    const apps = await this.appModel.aggregate(aggrerationPipeline);
    return apps[0];
  }
  async find(appsFilterQuery: FilterQuery<App>): Promise<App[]> {
    Logger.log(
      'find() method: starts, finding list of apps from db',
      'AppRepository',
    );

    const pipeline = [
      { $match: { userId: appsFilterQuery.userId } },
      {
        $facet: {
          totalCount: [{ $count: 'total' }],
          data: [
            { $skip: appsFilterQuery.paginationOption.skip },
            { $limit: appsFilterQuery.paginationOption.limit },
            {
              $project: this.appDataProjectPipelineToReturn(),
            },
          ],
        },
      },
    ];
    return this.appModel.aggregate(pipeline);
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
