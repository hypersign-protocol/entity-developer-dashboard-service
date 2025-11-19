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

@Injectable()
export class WebpageConfigService {
  constructor(
    private readonly appRepository: AppRepository,
    private readonly appAuthService: AppAuthService,
    private readonly webPageConfigRepo: WebPageConfigRepository,
    private readonly config: ConfigService,
  ) { }
  async storeWebPageConfigDetial(
    serviceId: string,
    createWebpageConfigDto: CreateWebpageConfigDto,
    userDetail,
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
      throw new BadRequestException(
        'KYC service must have a dependent SSI service linked to it.',
      );
    }
    const { appName, logoUrl, env = 'dev' } = serviceDetail;
    const tenantUrl: string = serviceDetail['tenantUrl'];

    const tokenAndExpiryDetail = await this.generateTokenBasedOnExpiry(
      serviceDetail,
      userDetail.accessList,
      expiryType,
      customExpiryDate,
      serviceDetail.dependentServices[0],
    );
    const veriferAppBaseUrl =
      this.config.get('KYC_VERIFIER_APP_BASE_URL') ||
      'https://verifier.hypersign.id';
    const generatedUrl = `${urlSanitizer(veriferAppBaseUrl, true)}${serviceId}`;
    const payload = {
      serviceId,
      themeColor,
      ssiAccessToken: tokenAndExpiryDetail.ssiAccessToken,
      kycAccessToken: tokenAndExpiryDetail.kycAccessToken,
      expiryType,
      expiryDate: tokenAndExpiryDetail.expiryDate,
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
    const { ssiAccessToken, kycAccessToken, ...responseData } =
      webpageConfigObject;
    return {
      ...responseData,
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
        `No service found with serviceId: ${serviceId}`,
      ]);
    }
    const { appName, logoUrl, env = 'dev' } = serviceDetail;
    const webPAgeConfigData = await this.webPageConfigRepo.findAWebpageConfig({
      serviceId,
    });
    if (!webPAgeConfigData) {
      throw new NotFoundException(
        `No webpage configuration found for serviceId: ${serviceId}`,
      );
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
    serviceId: string,
  ): Promise<CreateWebpageConfigDto> {
    const webpageConfiguration =
      await this.webPageConfigRepo.findAWebpageConfig({
        _id: id,
        serviceId,
      });
    if (!webpageConfiguration || webpageConfiguration == null) {
      throw new NotFoundException(
        `No webpage configuration found for serviceId: ${serviceId} and docId: ${id}`,
      );
    }
    return webpageConfiguration;
  }

  async updateWebPageConfiguration(
    id: string,
    updateWebpageConfigDto: UpdateWebpageConfigDto,
    userDetail,
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
      throw new BadRequestException(
        'KYC service must have a dependent SSI service linked to it.',
      );
    }
    let tokenDetail;
    const dataToUpdate = { ...updateWebpageConfigDto };
    if (updateWebpageConfigDto.expiryType) {
      tokenDetail = await this.generateTokenBasedOnExpiry(
        serviceDetail,
        userDetail.accessList,
        updateWebpageConfigDto.expiryType,
        updateWebpageConfigDto.customExpiryDate,
        serviceDetail.dependentServices[0],
      );
      dataToUpdate['expiryDate'] = tokenDetail.expiryDate;
      dataToUpdate['ssiAccessToken'] = tokenDetail.ssiAccessToken;
      dataToUpdate['kycAccessToken'] = tokenDetail.kycAccessToken;
    }
    const webpageConfiguration = await this.webPageConfigRepo.findOneAndUpdate(
      { _id: id },
      dataToUpdate,
    );
    if (!webpageConfiguration || webpageConfiguration == null) {
      throw new NotFoundException(
        `No webpage configuration found for serviceId: ${serviceId} and docId: ${id}`,
      );
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
      _id: id,
      serviceId,
    });
    if (!deletedConfig) {
      throw new NotFoundException(
        `No webpage configuration found for serviceId: ${serviceId} and docId: ${id}`,
      );
    }

    return deletedConfig;
  }
  private async generateTokenBasedOnExpiry(
    serviceDetail,
    userAccessList,
    expiryType,
    customExpiryDate,
    ssiServiceId,
  ) {
    // Get both SSI & KYC access lists
    Logger.log(
      'Inside generateTokenBasedOnExpiry(): Method to generate ssi and kyc token',
      'removeWebPageConfiguration',
    );
    const ssiAccessList = (userAccessList || [])
      .filter(
        (x) =>
          x.serviceType === SERVICE_TYPES.SSI_API &&
          !this.appAuthService.checkIfDateExpired(x.expiryDate),
      )
      .map((x) => x.access);

    const kycAccessList = (userAccessList || [])
      .filter(
        (x) =>
          x.serviceType === SERVICE_TYPES.CAVACH_API &&
          !this.appAuthService.checkIfDateExpired(x.expiryDate),
      )
      .map((x) => x.access);

    if (ssiAccessList.length <= 0 || kycAccessList.length <= 0) {
      throw new UnauthorizedException(
        `You are not authorized for both SSI and KYC services.`,
      );
    }

    // Calculate expiresIn
    let expiresIn: number;
    let expiryDate: Date;
    if (expiryType === 'custom') {
      if (!customExpiryDate) {
        throw new BadRequestException(
          'Custom expiry date is required when expiryType is "custom".',
        );
      }
      expiryDate = new Date(customExpiryDate);

      if (isNaN(expiryDate.getTime())) {
        throw new BadRequestException('Invalid custom expiry date format.');
      }
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (expiryDate < today) {
        throw new BadRequestException(
          'Custom expiry date cannot be earlier than today.',
        );
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
    const ssiServiceDetail = await this.appRepository.findOne({
      appId: ssiServiceId,
    });
    if (!ssiServiceDetail) {
      throw new BadRequestException([
        `No service found with dependentServiceId: ${ssiServiceId}`,
      ]);
    }
    // Get access tokens
    const ssiAccessTokenDetail = await this.appAuthService.getAccessToken(
      GRANT_TYPES.access_service_ssi,
      ssiServiceDetail,
      expiresIn,
    );
    const kycAccessTokenDetail = await this.appAuthService.getAccessToken(
      GRANT_TYPES.access_service_kyc,
      serviceDetail,
      expiresIn,
    );
    return {
      ssiAccessToken: ssiAccessTokenDetail.access_token,
      kycAccessToken: kycAccessTokenDetail.access_token,
      expiryDate,
    };
  }
}
