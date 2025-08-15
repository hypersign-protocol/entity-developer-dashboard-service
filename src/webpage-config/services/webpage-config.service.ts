import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { CreateWebpageConfigDto } from '../dto/create-webpage-config.dto';
import { UpdateWebpageConfigDto } from '../dto/update-webpage-config.dto';
import { AppRepository } from 'src/app-auth/repositories/app.repository';
import { AppAuthApiKeyService } from 'src/app-auth/services/app-auth-apikey.service';
import {
  AppAuthService,
  GRANT_TYPES,
} from 'src/app-auth/services/app-auth.service';
import { WebPageConfigRepository } from '../repositories/webpage-config.repository';
import { SERVICE_TYPES } from 'src/supported-service/services/iServiceList';

@Injectable()
export class WebpageConfigService {
  constructor(
    private readonly appRepository: AppRepository,
    private readonly appAuthService: AppAuthService,
    private readonly appAuthKeyService: AppAuthApiKeyService,
    private readonly webPageConfigRepo: WebPageConfigRepository,
  ) {}
  async storeWebPageConfigDetial(
    serviceId: string,
    createWebpageConfigDto: CreateWebpageConfigDto,
    userDetail,
  ) {
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
    } = createWebpageConfigDto;
    const serviceDetail = await this.appRepository.findOne({
      appId: serviceId,
    });

    if (!serviceDetail) {
      throw new BadRequestException([
        `No service found with serviceId: ${serviceId}`,
      ]);
    }
    const { appName, logoUrl } = serviceDetail;
    const tenantUrl: string = serviceDetail['tenantUrl'];

    const tokenAndExpiryDetail = await this.generateTokenBasedOnExpiry(
      serviceDetail,
      userDetail.accessList,
      expiryType,
      customExpiryDate,
    );
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
    };

    const webpageConfigData = await this.webPageConfigRepo.createwebPageConfig(
      payload,
    );
    const id = webpageConfigData['_id'].toString();
    const generatedUrl = `https://kyc.hypersign.id/${id}`;
    this.webPageConfigRepo.findOneAndUpdate({ _id: id }, { generatedUrl });
    const webpageConfigObject = webpageConfigData;
    const { ssiAccessToken, kycAccessToken, ...responseData } =
      webpageConfigObject;
    return {
      ...responseData,
      serviceName: appName,
      logoUrl,
      generatedUrl,
    };
  }

  fetchWebPageConfigurationList(serviceId: string) {
    return this.webPageConfigRepo.findAWebpageConfig({ serviceId });
  }

  fetchAWebPageConfigurationDetail(id: string, serviceId: string) {
    return this.webPageConfigRepo.findAWebpageConfig({
      _id: id,
      serviceId,
    });
  }

  async updateWebPageConfiguration(
    id: string,
    updateWebpageConfigDto: UpdateWebpageConfigDto,
    userDetail,
    serviceId,
  ) {
    const serviceDetail = await this.appRepository.findOne({
      appId: serviceId,
    });
    if (!serviceDetail) {
      throw new BadRequestException([
        `No service found with serviceId: ${serviceId}`,
      ]);
    }
    let tokenDetail;
    const dataToUpdate = { ...updateWebpageConfigDto };
    if (updateWebpageConfigDto.expiryType) {
      tokenDetail = await this.generateTokenBasedOnExpiry(
        serviceDetail,
        userDetail.accessList,
        updateWebpageConfigDto.expiryType,
        updateWebpageConfigDto.customExpiryDate,
      );
      dataToUpdate['expiryDate'] = tokenDetail.expiryDate;
      dataToUpdate['ssiAccessToken'] = tokenDetail.ssiAccessToken;
      dataToUpdate['kycAccessToken'] = tokenDetail.kycAccessToken;
    }
    return this.webPageConfigRepo.findOneAndUpdate({ _id: id }, dataToUpdate);
  }

  removeWebPageConfiguration(id: string, serviceId: string) {
    return this.webPageConfigRepo.findOneAndDelete({ _id: id, serviceId });
  }
  private async generateTokenBasedOnExpiry(
    serviceDetail,
    userAccessList,
    expiryType,
    customExpiryDate,
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

    // Get access tokens
    const ssiAccessTokenDetail = await this.appAuthService.getAccessToken(
      GRANT_TYPES.access_service_ssi,
      serviceDetail,
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
