import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  CreateWebpageConfigDto,
  CreateWebpageConfigResponseDto,
  ExpiryType,
} from '../dto/create-webpage-config.dto';
import { UpdateWebpageConfigDto } from '../dto/update-webpage-config.dto';
import { AppRepository } from 'src/app-auth/repositories/app.repository';
import {
  AppAuthService,
  GRANT_TYPES,
} from 'src/app-auth/services/app-auth.service';
import { WebPageConfigRepository } from '../repositories/webpage-config.repository';
import { SERVICE_TYPES } from 'src/supported-service/services/iServiceList';
import { ConfigService } from '@nestjs/config';
import { urlSanitizer } from 'src/utils/sanitizeUrl.validator';
import { Types } from 'mongoose';
import { WEBPAGE_CONFIG_ERRORS } from '../constant/en';
import { redisClient } from 'src/utils/redis.provider';
import { TOKEN } from 'src/utils/time-constant';
import { getAccessListForModule, REDIS_KEYS } from 'src/utils/utils';
import { TokenModule } from 'src/config/access-matrix';

@Injectable()
export class WebpageConfigService {
  constructor(
    private readonly appRepository: AppRepository,
    private readonly appAuthService: AppAuthService,
    private readonly webPageConfigRepo: WebPageConfigRepository,
    private readonly config: ConfigService,
  ) {}
  async storeWebPageConfigDetial(
    serviceId: string,
    createWebpageConfigDto: CreateWebpageConfigDto,
  ): Promise<CreateWebpageConfigResponseDto> {
    Logger.log(
      'Inside storeWebPageConfigDetial to store webpage configuration',
      'WebpageConfigService',
    );
    const {
      expiryType,
      customExpiryDate,
      themeColor,
      pageDescription,
      pageTitle,
      pageType = 'kyc',
      contactEmail,
    } = createWebpageConfigDto;
    const serviceDetail = await this.appRepository.findOne({
      appId: serviceId,
    });

    if (!serviceDetail) {
      throw new BadRequestException([
        `No service found with serviceId: ${serviceId}`,
      ]);
    }
    if (
      !serviceDetail?.dependentServices ||
      serviceDetail.dependentServices.length === 0
    ) {
      throw new BadRequestException([
        'KYC service must have a dependent SSI service linked to it.',
      ]);
    }
    const { appName, logoUrl, env = 'dev' } = serviceDetail;
    const tenantUrl: string = serviceDetail['tenantUrl'];

    const { expiryDate } = await this.generateExpiryDate(
      expiryType,
      customExpiryDate,
    );
    const veriferAppBaseUrl =
      this.config.get('KYC_VERIFIER_APP_BASE_URL') ||
      'https://verifier.hypersign.id';
    const id = new Types.ObjectId();
    const generatedUrl = `${urlSanitizer(
      veriferAppBaseUrl,
      true,
    )}${id.toString()}`;
    const payload = {
      _id: id,
      serviceId,
      themeColor,
      expiryType,
      expiryDate,
      pageDescription,
      pageTitle,
      pageType,
      tenantUrl,
      generatedUrl,
      contactEmail,
    };

    const webpageConfigData = await this.webPageConfigRepo.createwebPageConfig(
      payload,
    );
    const webpageConfigObject = webpageConfigData;
    return {
      ...webpageConfigObject,
      serviceName: appName,
      developmentStage: env,
      logoUrl,
    };
  }

  async fetchWebPageConfigurationList(
    serviceId: string,
  ): Promise<CreateWebpageConfigResponseDto> {
    Logger.log(
      'Inside fetchWebPageConfigurationList(): to fetch webpage configuration of a service',
      'WebpageConfigService',
    );
    const serviceDetail = await this.appRepository.findOne({
      appId: serviceId,
    });

    if (!serviceDetail) {
      throw new BadRequestException([
        [`No service found with serviceId: ${serviceId}`],
      ]);
    }
    const { appName, logoUrl, env = 'dev' } = serviceDetail;
    const webPAgeConfigData = await this.webPageConfigRepo.findAWebpageConfig({
      serviceId,
    });
    if (!webPAgeConfigData) {
      throw new NotFoundException([
        `No webpage configuration found for serviceId: ${serviceId}`,
      ]);
    }
    return {
      ...webPAgeConfigData,
      serviceName: appName,
      developmentStage: env,
      logoUrl,
    };
  }

  async fetchAWebPageConfigurationDetail(
    id: string,
  ): Promise<CreateWebpageConfigDto> {
    const webpageConfiguration =
      await this.webPageConfigRepo.findAWebpageConfig({
        _id: new Types.ObjectId(id),
      });
    if (!webpageConfiguration || webpageConfiguration == null) {
      throw new NotFoundException([
        `No webpage configuration found for id: ${id}`,
      ]);
    }
    return webpageConfiguration;
  }

  async updateWebPageConfiguration(
    id: string,
    updateWebpageConfigDto: UpdateWebpageConfigDto,
    serviceId,
  ): Promise<CreateWebpageConfigResponseDto> {
    const serviceDetail = await this.appRepository.findOne({
      appId: serviceId,
    });
    if (!serviceDetail) {
      throw new BadRequestException([
        `No service found with serviceId: ${serviceId}`,
      ]);
    }
    if (
      !serviceDetail?.dependentServices ||
      serviceDetail.dependentServices.length === 0
    ) {
      throw new BadRequestException([
        'KYC service must have a dependent SSI service linked to it.',
      ]);
    }
    const dataToUpdate = { ...updateWebpageConfigDto };
    if (updateWebpageConfigDto.expiryType) {
      const { expiryDate } = await this.generateExpiryDate(
        updateWebpageConfigDto.expiryType,
        updateWebpageConfigDto.customExpiryDate,
      );
      dataToUpdate['expiryDate'] = expiryDate;
    }
    const webpageConfiguration = await this.webPageConfigRepo.findOneAndUpdate(
      { _id: new Types.ObjectId(id) },
      dataToUpdate,
    );
    if (!webpageConfiguration || webpageConfiguration == null) {
      throw new NotFoundException([
        `No webpage configuration found for serviceId: ${serviceId} and docId: ${id}`,
      ]);
    }
    const { appName, logoUrl, env = 'dev' } = serviceDetail;

    return {
      ...webpageConfiguration,
      serviceName: appName,
      developmentStage: env,
      logoUrl,
    };
  }

  async removeWebPageConfiguration(id: string, serviceId: string) {
    const deletedConfig = await this.webPageConfigRepo.findOneAndDelete({
      _id: new Types.ObjectId(id),
      serviceId,
    });
    if (!deletedConfig) {
      throw new NotFoundException([
        `No webpage configuration found for serviceId: ${serviceId} and docId: ${id}`,
      ]);
    }

    return deletedConfig;
  }
  private async generateExpiryDate(expiryType, customExpiryDate) {
    let expiresIn: number;
    let expiryDate: Date;
    if (expiryType === ExpiryType.CUSTOM) {
      if (!customExpiryDate) {
        throw new BadRequestException([
          'Custom expiry date is required when expiryType is "custom".',
        ]);
      }
      expiryDate = new Date(customExpiryDate);

      if (isNaN(expiryDate.getTime())) {
        throw new BadRequestException(['Invalid custom expiry date format.']);
      }
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (expiryDate < today) {
        throw new BadRequestException([
          'Custom expiry date cannot be earlier than today.',
        ]);
      }
      expiresIn = Math.floor(
        (expiryDate.getTime() - Date.now()) / (1000 * 60 * 60),
      );
    } else {
      const monthsMap = {
        '1month': 30,
        '3months': 90,
        '6months': 180,
      };
      const days = monthsMap[expiryType] || 30;
      expiresIn = days * 24;
      expiryDate = new Date(Date.now() + expiresIn * 60 * 60 * 1000);
    }
    return { expiryDate };
  }
  public async generateWebpageConfigTokens(id, appId, userDetail) {
    const redisKey = `${REDIS_KEYS.VERIFIER_PAGE_TOKEN}${id}`;
    const cachedData = await redisClient.get(redisKey);
    if (cachedData) return JSON.parse(cachedData);
    const [verifierConfig, kycServiceDetail] = await Promise.all([
      this.webPageConfigRepo.findAWebpageConfig({
        _id: new Types.ObjectId(id),
      }),
      this.appRepository.findOne({ appId }),
    ]);
    if (!verifierConfig || verifierConfig == null) {
      throw new BadRequestException([
        WEBPAGE_CONFIG_ERRORS.WEBPAGE_CONFIG_NOT_FOUND,
      ]);
    }
    if (!kycServiceDetail) {
      throw new BadRequestException([
        WEBPAGE_CONFIG_ERRORS.WEBPAGE_CONFIG_LINKED_APP_NOT_FOUND,
      ]);
    }
    if (
      !kycServiceDetail.dependentServices ||
      kycServiceDetail.dependentServices.length === 0
    ) {
      throw new BadRequestException([
        WEBPAGE_CONFIG_ERRORS.WEBPAGE_CONFIG_SSI_SERVICE_NOT_FOUND,
      ]);
    }
    const ssiServiceId = kycServiceDetail.dependentServices[0];
    const ssiServiceDetail = await this.appRepository.findOne({
      appId: ssiServiceId,
    });
    if (!ssiServiceDetail) {
      throw new BadRequestException([
        WEBPAGE_CONFIG_ERRORS.WEBPAGE_CONFIG_SSI_SERVICE_DOES_NOT_EXIST,
      ]);
    }

    // generate access tokens
    const [ssiAccessTokenDetail, kycAccessTokenDetail] = await Promise.all([
      this.appAuthService.getAccessToken(
        GRANT_TYPES.access_service_ssi,
        ssiServiceDetail,
         TOKEN.VERIFIER_TOKEN.jwtExpiry,
        getAccessListForModule(TokenModule.VERIFIER, SERVICE_TYPES.SSI_API),
      ),
      this.appAuthService.getAccessToken(
        GRANT_TYPES.access_service_kyc,
        kycServiceDetail,
        TOKEN.VERIFIER_TOKEN.jwtExpiry,
        getAccessListForModule(TokenModule.VERIFIER, SERVICE_TYPES.CAVACH_API),
      ),
    ]);
    const redisPayload = {
      ssiAccessToken: ssiAccessTokenDetail.access_token,
      kycAccessToken: kycAccessTokenDetail.access_token,
    };
    redisClient.set(
      redisKey,
      JSON.stringify(redisPayload),
      'EX',
      TOKEN.VERIFIER_TOKEN.expiry,
    );
    return {
      ...redisPayload,
    };
  }
}
