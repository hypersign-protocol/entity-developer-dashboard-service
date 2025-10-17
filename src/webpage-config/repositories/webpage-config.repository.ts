import { FilterQuery, Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { Injectable, Logger } from '@nestjs/common';
import {
  WebPageConfig,
  WebpageConfigDocument,
} from '../schema/webpage-config.schema';
@Injectable()
export class WebPageConfigRepository {
  constructor(
    @InjectModel(WebPageConfig.name)
    private readonly webPageConfigModel: Model<WebpageConfigDocument>,
  ) {}
  async createwebPageConfig(
    webPageConfigDetail: WebPageConfig,
  ): Promise<WebPageConfig> {
    Logger.log(
      'createwebPageConfigConfig() method: starts, adding verifier app configuration to db',
      'WebPageConfigRepository',
    );
    const newWebpageConfig = new this.webPageConfigModel(webPageConfigDetail);
    const webpageConfig = await newWebpageConfig.save();
    return webpageConfig.toObject();
  }

  async findListOfWebpageConfig(
    webpageCofigFilterQuery: FilterQuery<WebPageConfig>,
  ): Promise<WebPageConfig[]> {
    Logger.log(
      'findListOfWebpageConfig() method: starts, fetch list of webpageConfiguration data from db',
      'WebPageConfigRepository',
    );
    return this.webPageConfigModel.find(webpageCofigFilterQuery);
  }
  async findAWebpageConfig(
    webpageCofigFilterQuery: FilterQuery<WebPageConfig>,
  ): Promise<WebPageConfig> {
    Logger.log(
      'findListOfWebpageConfig() method: starts, fetch list of webpageConfiguration data from db',
      'WebPageConfigRepository',
    );
    return this.webPageConfigModel.findOne(webpageCofigFilterQuery).lean();
  }
  async findOneAndUpdate(
    webpageCofigFilterQuery: FilterQuery<WebPageConfig>,
    webPageConfig: Partial<WebPageConfig>,
  ): Promise<WebPageConfig> {
    Logger.log(
      'findOneAndUpdate() method: starts, update  app data to db',
      'WebPageConfigRepository',
    );

    return this.webPageConfigModel.findOneAndUpdate(
      webpageCofigFilterQuery,
      webPageConfig,
      { new: true },
    );
  }

  async findOneAndDelete(
    appFilterQuery: FilterQuery<WebPageConfig>,
  ): Promise<WebPageConfig> {
    Logger.log(
      'findOneAndDelete() method: starts, delete  app data to db',
      'WebPageConfigRepository',
    );

    return this.webPageConfigModel.findOneAndDelete(appFilterQuery);
  }
}
