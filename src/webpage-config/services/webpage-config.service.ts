import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import {
  CreateWebpageConfigDto,
  CreateWebpageConfigResponseDto,
  ExpiryType,
  PageType,
  VerifierPageTokenResponse,
} from '../dto/create-webpage-config.dto';
import { UpdateWebpageConfigDto } from '../dto/update-webpage-config.dto';
import { AppRepository } from 'src/app-auth/repositories/app.repository';
import {
  AppAuthService,
  GRANT_TYPES,
} from 'src/app-auth/services/app-auth.service';
import { WebPageConfigRepository } from '../repositories/webpage-config.repository';
import {
  APP_ENVIRONMENT,
  SERVICE_TYPES,
} from 'src/supported-service/services/iServiceList';
import { ConfigService } from '@nestjs/config';
import { urlSanitizer } from 'src/utils/sanitizeUrl.validator';
import { isValidObjectId, Types } from 'mongoose';
import { WEBPAGE_CONFIG_ERRORS } from '../constant/en';
import { EXPIRY_CONFIG, TIME, TIME_UNIT } from 'src/utils/time-constant';
import { evaluateAccessPolicy, getAccessListForModule } from 'src/utils/utils';
import { TokenModule } from 'src/config/access-matrix';
import {
  hitCounter,
  newVerifierSessionId,
  pageDailyKey,
  pageIpRateKey,
  pageRateKey,
  revokeVerifierSessions,
  trackVerifierSessions,
  VERIFIER_TOKEN_RATE_LIMIT,
} from '../utils/verifier-session.util';

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
      linkedWidgetConfigIds,
      isActive = true,
      dailyTokenLimit,
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
    const { appName, logoUrl } = serviceDetail;
    const env: APP_ENVIRONMENT = serviceDetail?.env as APP_ENVIRONMENT;
    const tenantUrl: string = serviceDetail['tenantUrl'];

    const { expiryDate } = await this.generateExpiryDate(
      expiryType,
      customExpiryDate,
    );
    const veriferAppBaseUrl = this.config.get('KYC_VERIFIER_APP_BASE_URL');
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
      // tenantUrl,
      generatedUrl,
      contactEmail,
      linkedWidgetConfigIds: linkedWidgetConfigIds?.map(
        (id) => new Types.ObjectId(id),
      ),
      isActive,
      dailyTokenLimit,
    };
    Logger.log('Before inserting webpage detail', 'WebpageConfigService');
    const webpageConfigData = await this.webPageConfigRepo.createwebPageConfig(
      payload,
    );
    const webpageConfigObject = webpageConfigData;
    return {
      ...webpageConfigObject,
      linkedWidgetConfigIds: webpageConfigObject.linkedWidgetConfigIds?.map(
        (id) => id.toString(),
      ),
      serviceName: appName,
      developmentStage: env,
      tenantUrl,
      logoUrl,
    };
  }

  async fetchParticularWebpage(
    serviceId: string,
    pageType: PageType,
  ): Promise<boolean> {
    const existing = await this.webPageConfigRepo.findAWebpageConfig({
      serviceId,
      pageType,
    });
    return Boolean(existing);
  }

  async fetchWebPageConfigurationList(
    serviceId: string,
    pageType: PageType,
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
    const { appName, logoUrl } = serviceDetail;
    const env: APP_ENVIRONMENT = serviceDetail?.env as APP_ENVIRONMENT;
    const webPAgeConfigData = await this.webPageConfigRepo.findAWebpageConfig({
      serviceId,
      pageType,
    });
    if (!webPAgeConfigData) {
      throw new NotFoundException([
        `No webpage configuration found for serviceId: ${serviceId}`,
      ]);
    }
    return {
      ...webPAgeConfigData,
      linkedWidgetConfigIds: webPAgeConfigData.linkedWidgetConfigIds?.map(
        (id) => id.toString(),
      ),
      serviceName: appName,
      developmentStage: env,
      logoUrl,
      tenantUrl: serviceDetail['tenantUrl'],
    };
  }

  async fetchAWebPageConfigurationDetail(
    id: string,
    pageType?: PageType,
  ): Promise<CreateWebpageConfigResponseDto> {
    Logger.log(
      'Inside fetchAWebPageConfigurationDetail() method to fetch webpage detail',
      'WebpageConfigService',
    );
    const isValidId = isValidObjectId(id);
    const query: any = {
      $or: [{ serviceId: id }],
    };
    if (isValidId) {
      query.$or.push({ _id: new Types.ObjectId(id) });
    }
    if (pageType) {
      query.pageType = pageType;
    }
    const webpageConfiguration =
      await this.webPageConfigRepo.findAWebpageConfig(query);
    if (!webpageConfiguration || webpageConfiguration == null) {
      throw new NotFoundException([
        `No webpage configuration found for id: ${id}`,
      ]);
    }
    // Public endpoint used by the verifier page itself.
    this.assertPageUsable(webpageConfiguration);
    Logger.log(
      'Inside serviceDetail(): before making db call',
      'WebpageConfigService',
    );
    const serviceDetail = await this.appRepository.findOne({
      appId: webpageConfiguration.serviceId,
    });
    return {
      ...webpageConfiguration,
      linkedWidgetConfigIds: webpageConfiguration.linkedWidgetConfigIds?.map(
        (id) => id.toString(),
      ),
      developmentStage: serviceDetail?.env as APP_ENVIRONMENT,
      serviceName: serviceDetail.appName,
      logoUrl: serviceDetail.logoUrl,
      tenantUrl: serviceDetail['tenantUrl'],
    };
  }

  async updateWebPageConfiguration(
    id: string,
    updateWebpageConfigDto: UpdateWebpageConfigDto,
    serviceId,
  ): Promise<CreateWebpageConfigResponseDto> {
    Logger.log(
      'Inside updateWebPageConfiguration() to update webpage configuration detail',
      'WebpageConfigService',
    );
    const serviceDetail = await this.appRepository.findOne({
      appId: serviceId,
    });
    Logger.debug(
      'Inside updateWebPageConfiguration() after fetchich service detail from db',
      'WebpageConfigService',
    );
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
    const dataToUpdate = {
      ...updateWebpageConfigDto,
      linkedWidgetConfigIds: updateWebpageConfigDto.linkedWidgetConfigIds?.map(
        (id) => new Types.ObjectId(id),
      ),
    };
    delete dataToUpdate['_id'];
    if (updateWebpageConfigDto.expiryType) {
      const { expiryDate } = await this.generateExpiryDate(
        updateWebpageConfigDto.expiryType,
        updateWebpageConfigDto.customExpiryDate,
      );
      dataToUpdate['expiryDate'] = expiryDate;
    }
    Logger.debug(
      'before updating webpage config detail....',
      'WebpageConfigService',
    );
    // Scope by serviceId too, so a caller can only edit pages of the app
    // they were authorised for.
    const webpageConfiguration = await this.webPageConfigRepo.findOneAndUpdate(
      { _id: new Types.ObjectId(id), serviceId },
      dataToUpdate,
    );
    if (!webpageConfiguration || webpageConfiguration == null) {
      throw new NotFoundException([
        `No webpage configuration found for serviceId: ${serviceId} and docId: ${id}`,
      ]);
    }
    if (webpageConfiguration.isActive === false) {
      await revokeVerifierSessions(id);
    }
    const { appName, logoUrl } = serviceDetail;
    const env: APP_ENVIRONMENT = serviceDetail?.env as APP_ENVIRONMENT;
    return {
      ...webpageConfiguration,
      linkedWidgetConfigIds: webpageConfiguration.linkedWidgetConfigIds?.map(
        (id) => id.toString(),
      ),
      serviceName: appName,
      developmentStage: env,
      logoUrl,
      tenantUrl: serviceDetail['tenantUrl'],
    };
  }

  async removeWebPageConfiguration(id: string, serviceId: string) {
    Logger.log(
      'Inside removeWebPageConfiguration() to delete webpage configuration',
      'WebpageConfigService',
    );
    const deletedConfig = await this.webPageConfigRepo.findOneAndDelete({
      _id: new Types.ObjectId(id),
      serviceId,
    });
    if (!deletedConfig) {
      throw new NotFoundException([
        `No webpage configuration found for serviceId: ${serviceId} and docId: ${id}`,
      ]);
    }
    await revokeVerifierSessions(id);

    return deletedConfig;
  }
  private async generateExpiryDate(expiryType, customExpiryDate) {
    Logger.debug(
      'Inside generateExpiryDate() to calculate expiry of configured webpage',
      'WebpageConfigService',
    );
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
        '12months': 365,
      };
      const days = monthsMap[expiryType] || 30;
      expiresIn = days * 24;
      expiryDate = new Date(Date.now() + expiresIn * 60 * 60 * 1000);
    }
    return { expiryDate };
  }
  // Throws when the page is switched off or past its expiry date.
  private assertPageUsable(config: {
    isActive?: boolean;
    expiryDate?: Date;
  }): void {
    if (config.isActive === false) {
      throw new ForbiddenException([
        WEBPAGE_CONFIG_ERRORS.WEBPAGE_CONFIG_DISABLED,
      ]);
    }
    if (
      config.expiryDate &&
      new Date(config.expiryDate).getTime() <= Date.now()
    ) {
      throw new ForbiddenException([
        WEBPAGE_CONFIG_ERRORS.WEBPAGE_CONFIG_EXPIRED,
      ]);
    }
  }

  private async enforceTokenLimits(
    pageId: string,
    clientIp: string | undefined,
    dailyTokenLimit?: number,
  ): Promise<void> {
    const { PER_IP_PER_MINUTE, PER_PAGE_PER_MINUTE, WINDOW } =
      VERIFIER_TOKEN_RATE_LIMIT;
    const [ipCount, pageCount] = await Promise.all([
      hitCounter(pageIpRateKey(pageId, clientIp || 'unknown'), WINDOW),
      hitCounter(pageRateKey(pageId), WINDOW),
    ]);
    if (ipCount > PER_IP_PER_MINUTE || pageCount > PER_PAGE_PER_MINUTE) {
      throw new ThrottlerException(
        WEBPAGE_CONFIG_ERRORS.WEBPAGE_CONFIG_RATE_LIMITED,
      );
    }
    if (dailyTokenLimit) {
      const day = new Date().toISOString().slice(0, 10);
      const dailyCount = await hitCounter(pageDailyKey(pageId, day), TIME.DAY);
      if (dailyCount > dailyTokenLimit) {
        throw new ThrottlerException(
          WEBPAGE_CONFIG_ERRORS.WEBPAGE_CONFIG_DAILY_LIMIT_REACHED,
        );
      }
    }
  }

  // Issues the KYC/KYB + SSI tokens a verifier page needs.
  // The app is always the one the page belongs to; the caller cannot pick it.
  public async generateWebpageConfigTokens(
    id: string,
    requestedAppId?: string,
    businessId?: string,
    clientIp?: string,
  ) {
    Logger.log(
      'Inside generateWebpageConfigTokens() to generate webpage config token',
      'WebpageConfigService',
    );
    if (businessId && !Types.ObjectId.isValid(businessId)) {
      throw new BadRequestException(['Invalid business ID']);
    }
    const verifierConfig = await this.webPageConfigRepo.findAWebpageConfig({
      _id: new Types.ObjectId(id),
    });
    if (!verifierConfig) {
      throw new BadRequestException([
        WEBPAGE_CONFIG_ERRORS.WEBPAGE_CONFIG_NOT_FOUND,
      ]);
    }
    this.assertPageUsable(verifierConfig);

    const appId = verifierConfig.serviceId;
    // appId is kept on the API for older verifier page builds; it must match.
    if (requestedAppId && requestedAppId !== appId) {
      throw new BadRequestException([
        WEBPAGE_CONFIG_ERRORS.WEBPAGE_CONFIG_APP_MISMATCH,
      ]);
    }
    const isKyb = verifierConfig.pageType === PageType.KYB;
    // businessId comes from executive invite links on KYC pages. It is not
    // verified here (the links are not signed yet), so it must never be used
    // for access decisions downstream.
    if (businessId && isKyb) {
      throw new BadRequestException([
        WEBPAGE_CONFIG_ERRORS.WEBPAGE_CONFIG_BUSINESS_ID_NOT_ALLOWED,
      ]);
    }
    await this.enforceTokenLimits(id, clientIp, verifierConfig.dailyTokenLimit);

    const grantType = isKyb
      ? GRANT_TYPES.access_service_kyb
      : GRANT_TYPES.access_service_kyc;
    const kycServiceDetail = await this.findLinkedApp(
      appId,
      SERVICE_TYPES.CAVACH_API,
      WEBPAGE_CONFIG_ERRORS.WEBPAGE_CONFIG_INVALID_SERVICE_TYPE,
    );
    if (
      !kycServiceDetail.dependentServices ||
      kycServiceDetail.dependentServices.length === 0
    ) {
      throw new BadRequestException([
        WEBPAGE_CONFIG_ERRORS.WEBPAGE_CONFIG_SSI_SERVICE_NOT_FOUND,
      ]);
    }
    const ssiServiceId = kycServiceDetail.dependentServices[0];
    const ssiServiceDetail = await this.findLinkedApp(
      ssiServiceId,
      SERVICE_TYPES.SSI_API,
      WEBPAGE_CONFIG_ERRORS.WEBPAGE_CONFIG_INVALID_SSI_SERVICE_TYPE,
    );

    // Session and JWT end at the verifier TTL or the page expiry, whichever
    // comes first.
    const expiryConfig = isKyb
      ? EXPIRY_CONFIG.VERIFIER_CUSTOMER_KYB_APP_ACCESS
      : EXPIRY_CONFIG.VERIFIER_CUSTOMER_APP_ACCESS;
    const secondsToPageExpiry = verifierConfig.expiryDate
      ? Math.floor(
          (new Date(verifierConfig.expiryDate).getTime() - Date.now()) / 1000,
        )
      : Infinity;
    const ttlSeconds = Math.max(
      1,
      Math.min(expiryConfig.redisExpiryTime, secondsToPageExpiry),
    );

    // One fresh session per token request (per visitor), never shared.
    const pageSessionId = newVerifierSessionId();
    const ssiSessionId = newVerifierSessionId();
    await Promise.all([
      this.appAuthService.storeDataInRedis(
        grantType,
        kycServiceDetail,
        this.verifierAccessList(SERVICE_TYPES.CAVACH_API, grantType),
        pageSessionId,
        undefined,
        false,
        ttlSeconds,
      ),
      this.appAuthService.storeDataInRedis(
        GRANT_TYPES.access_service_ssi,
        ssiServiceDetail,
        this.verifierAccessList(
          SERVICE_TYPES.SSI_API,
          GRANT_TYPES.access_service_ssi,
          TokenModule.ID_SERVICE,
        ),
        ssiSessionId,
        undefined,
        false,
        ttlSeconds,
      ),
    ]);
    await trackVerifierSessions(id, [pageSessionId, ssiSessionId]);

    const pageTokenPayload = {
      appId,
      appName: kycServiceDetail.appName,
      grantType,
      sessionId: pageSessionId,
      subdomain: kycServiceDetail.subdomain,
      ...(businessId && { businessId }),
    };
    const [ssiAccessTokenDetail, pageAccessTokenDetail] = await Promise.all([
      this.appAuthService.getAccessToken(
        {
          appId: ssiServiceId,
          appName: ssiServiceDetail.appName,
          grantType: GRANT_TYPES.access_service_ssi,
          sessionId: ssiSessionId,
          subdomain: ssiServiceDetail.subdomain,
        },
        ttlSeconds,
        TIME_UNIT.SECOND,
      ),
      this.appAuthService.getAccessToken(
        pageTokenPayload,
        ttlSeconds,
        TIME_UNIT.SECOND,
      ),
    ]);
    const response: VerifierPageTokenResponse = {
      ssiAccessToken: ssiAccessTokenDetail.access_token,
    };
    if (isKyb) {
      response.kybAccessToken = pageAccessTokenDetail.access_token;
    } else {
      response.kycAccessToken = pageAccessTokenDetail.access_token;
    }
    return response;
  }

  private verifierAccessList(
    serviceType: SERVICE_TYPES,
    grantType: GRANT_TYPES,
    tokenModule: TokenModule = TokenModule.VERIFIER,
  ) {
    return evaluateAccessPolicy(
      getAccessListForModule(tokenModule, serviceType, grantType),
      serviceType,
      [],
    );
  }

  private async findLinkedApp(
    appId: string,
    expectedServiceType: SERVICE_TYPES,
    wrongTypeError: string,
  ) {
    const serviceDetail = await this.appRepository.findOne({ appId });
    if (!serviceDetail) {
      throw new BadRequestException([
        WEBPAGE_CONFIG_ERRORS.WEBPAGE_CONFIG_LINKED_APP_NOT_FOUND,
      ]);
    }
    if (serviceDetail.services?.[0]?.id !== expectedServiceType) {
      throw new BadRequestException([wrongTypeError]);
    }
    return serviceDetail;
  }
}
