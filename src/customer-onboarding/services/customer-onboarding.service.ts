import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { CreateCustomerOnboardingDto } from '../dto/create-customer-onboarding.dto';
import { UpdateCustomerOnboardingDto } from '../dto/update-customer-onboarding.dto';
import { CustomerOnboardingRepository } from '../repositories/customer-onboarding.repositories';
import getCreditRequestNotificationMail from 'src/mail-notification/constants/templates/credit-request.template';
import { UserRepository } from 'src/user/repository/user.repository';
import { UserRole } from 'src/user/schema/user.schema';
import { MailNotificationService } from 'src/mail-notification/services/mail-notification.service';
import { CustomerOnboardingProcessDto } from '../dto/customer-onboarding-process.dto';
import {
  AppAuthService,
  GRANT_TYPES,
} from 'src/app-auth/services/app-auth.service';
import {
  APP_ENVIRONMENT,
  SERVICE_TYPES,
} from 'src/supported-service/services/iServiceList';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { CreditStatus, OnboardingStep, StepStatus } from '../constants/enum';
import {
  CustomerOnboarding,
  LogDetail,
} from '../schemas/customer-onboarding.schema';
import { AppRepository } from 'src/app-auth/repositories/app.repository';

@Injectable()
export class CustomerOnboardingService {
  constructor(
    private readonly customerOnboardingRepository: CustomerOnboardingRepository,
    private readonly userRepository: UserRepository,
    private readonly mailNotificationService: MailNotificationService,
    private readonly appAuthService: AppAuthService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly appAuthRepository: AppRepository,
  ) {}
  async createCustomerOnboardingDetail(
    createCustomerOnboardingDto: CreateCustomerOnboardingDto,
    userId: string,
  ) {
    try {
      let { isKyc, isKyb } = createCustomerOnboardingDto;
      const { isKycAndKyb } = createCustomerOnboardingDto;
      if (isKycAndKyb) {
        isKyc = true;
        isKyb = true;
      }
      const onboardingData =
        await this.customerOnboardingRepository.createCustomerOnboarding({
          ...createCustomerOnboardingDto,
          isKyc,
          isKyb,
          userId,
        });

      const requestedServices = isKycAndKyb
        ? 'KYC and KYB Service'
        : isKyc
        ? 'KYC Service'
        : isKyb
        ? 'KYB Service'
        : 'No service requested';

      const { customerEmail } = createCustomerOnboardingDto;

      const message = getCreditRequestNotificationMail(
        userId,
        customerEmail,
        requestedServices,
        onboardingData['_id'].toString(),
      );
      const superAdminDetails = await this.userRepository.find({
        role: UserRole.SUPER_ADMIN,
      });
      const superAdminEmails = superAdminDetails.map((admin) => admin.email);
      const subject = 'New Customer Onboarding Request Received';
      await this.sendOnboardingRequestMailToSuperAdmin(
        message,
        superAdminEmails,
        subject,
      );

      return onboardingData;
    } catch (e) {
      if (e.code === 11000) {
        const field = Object.keys(e.keyValue || {})[0];
        const value = e.keyValue ? e.keyValue[field] : '';
        throw new ConflictException([`${field} '${value}' already exists`]);
      }
      throw new BadRequestException([e.message]);
    }
  }

  async findOne(id: string, user) {
    try {
      Logger.log(
        'Inside customer onboardig service findOne method',
        'CustomerOnboardingService',
      );
      const customerOnboardingData =
        await this.customerOnboardingRepository.findCustomerOnboardingById({
          _id: id,
        });
      if (!customerOnboardingData) {
        throw new BadRequestException(['Customer Onboarding detail not found']);
      }
      if (
        user.role !== UserRole.SUPER_ADMIN &&
        customerOnboardingData.userId !== user.userId
      ) {
        throw new ForbiddenException([
          'You are not authorized to access this resource',
        ]);
      }
      return customerOnboardingData;
    } catch (e) {
      if (e instanceof HttpException) throw e;
      else throw new BadRequestException([`${e.message}`]);
    }
  }

  private async sendOnboardingRequestMailToSuperAdmin(
    message,
    superAdminEmailList,
    subject,
  ) {
    const to = superAdminEmailList[0];
    const cc = superAdminEmailList.slice(1);
    await this.mailNotificationService.addAJob(
      {
        to,
        subject,
        message,
        cc,
      },
      'send-credit-request-notification-mail',
    );
  }
  async processCustomerOnboarding(
    id: string,
    customerOnboardingProcessDto: CustomerOnboardingProcessDto,
  ) {
    try {
      const { userEmail, ssiCreditDetail, kycCreditDetail } =
        customerOnboardingProcessDto;

      // Fetch customer onboarding details
      const customerOnboardingData =
        await this.customerOnboardingRepository.findCustomerOnboardingById({
          _id: id,
          email: userEmail,
        });

      if (!customerOnboardingData) {
        throw new BadRequestException(
          `Customer onboarding detail not found for id: ${id}`,
        );
      }

      if (userEmail !== customerOnboardingData.customerEmail) {
        throw new BadRequestException(
          "User email doesn't match with onboarding email",
        );
      }
      const onboardingLogs: LogDetail[] = [];
      const onboardingUpdateData: Partial<CustomerOnboarding> = {};
      const ssiBaseDomain = this.config.get<string>('SSI_API_DOMAIN');
      const cavachBaseDomain = this.config.get<string>('CAVACH_API_DOMAIN');
      const secret = this.config.get('JWT_SECRET');
      let ssiSubdomain = customerOnboardingData?.ssiSubdomain;
      let kycSubdomain = customerOnboardingData?.kycSubdomain;
      let ssiTenantUrl = this.getTenantUrl(ssiBaseDomain, ssiSubdomain);
      let kycTenantUrl = this.getTenantUrl(cavachBaseDomain, kycSubdomain);

      let ssiService, ssiAccessToken, issuerDidData, kycService, didDocument;

      // Determine last completed step
      const lastStep =
        customerOnboardingData.logs
          ?.filter((log) => log.status === StepStatus.SUCCESS)
          .pop()?.step ?? null;

      const startIndex = lastStep
        ? Object.values(OnboardingStep).indexOf(lastStep) + 1
        : 0;
      const remainingSteps = Object.values(OnboardingStep).slice(startIndex);
      const { companyName, domain, userId } = customerOnboardingData;

      for (const step of remainingSteps) {
        try {
          switch (step) {
            case OnboardingStep.CREATE_SSI_SERVICE: {
              const createSSIServiceDto = {
                appName: `${companyName}_SSI_Service`,
                domain,
                serviceIds: [SERVICE_TYPES.SSI_API] as [SERVICE_TYPES],
                whitelistedCors: ['*'],
                env: APP_ENVIRONMENT.dev,
                hasDomainVerified: false,
              };
              ssiService = await this.appAuthService.createAnApp(
                createSSIServiceDto,
                userId,
              );
              ssiSubdomain = ssiService.subdomain;
              onboardingUpdateData.ssiSubdomain = ssiService.subdomain;
              onboardingUpdateData.ssiServiceId = ssiService.appId;
              ssiTenantUrl = this.getTenantUrl(ssiBaseDomain, ssiSubdomain);
              break;
            }

            case OnboardingStep.CREDIT_SSI_SERVICE: {
              const ssiCreditPayload = {
                serviceId:
                  ssiService?.appId || customerOnboardingData.ssiServiceId,
                purpose: 'CreditRecharge',
                amount: ssiCreditDetail.amount,
                validityPeriod: ssiCreditDetail.validityPeriod,
                validityPeriodUnit: ssiCreditDetail.validityPeriodUnit,
                amountDenom: ssiCreditDetail.amountDenom,
                subdomain:
                  ssiService?.subdomain || customerOnboardingData.ssiSubdomain,
                grantType: GRANT_TYPES.access_service_ssi,
                whitelistedCors: ssiService?.whitelistedCors || ['*'],
              };

              const creditToken = await this.jwt.signAsync(ssiCreditPayload, {
                expiresIn: '5m',
                secret,
              });
              await fetch(`${ssiTenantUrl}/api/v1/credit`, {
                method: 'POST',
                headers: {
                  authorization: `Bearer ${creditToken}`,
                  'Content-Type': 'application/json',
                },
              });
              break;
            }

            case OnboardingStep.CREATE_DID: {
              if (!ssiService) {
                ssiService = await this.appAuthRepository.findOne({
                  appId: customerOnboardingData.ssiServiceId,
                });
              }

              ssiAccessToken = await this.appAuthService.getAccessToken(
                GRANT_TYPES.access_service_ssi,
                ssiService,
                4,
              );
              const didResponse = await fetch(
                `${ssiTenantUrl}/api/v1/did/create`,
                {
                  method: 'POST',
                  headers: {
                    authorization: `Bearer ${ssiAccessToken.access_token}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ namespace: 'testnet' }),
                },
              );

              issuerDidData = await didResponse.json();
              didDocument = issuerDidData?.metaData.didDocument;
              // Store DID in DB to reuse if next step fails
              onboardingUpdateData.businessId = issuerDidData.did;
              break;
            }
            // resolve the did if already created
            case OnboardingStep.REGISTER_DID: {
              ssiAccessToken =
                ssiAccessToken ||
                (await this.appAuthService.getAccessToken(
                  GRANT_TYPES.access_service_ssi,
                  ssiService,
                  4,
                ));
              const didToRegister =
                issuerDidData?.did || customerOnboardingData.businessId;

              if (!didDocument || didDocument == null) {
                // Resolving did documents if step is failed after did creation
                const resolvedDid = await fetch(
                  `${ssiTenantUrl}/api/v1/did/${
                    issuerDidData?.did || customerOnboardingData?.businessId
                  }`,
                  {
                    method: 'POST',
                    headers: {
                      authorization: `Bearer ${ssiAccessToken.access_token}`,
                      'Content-Type': 'application/json',
                    },
                  },
                );
                const data = await resolvedDid.json();
                didDocument = data.didDocument;
              }
              // Reuse existing DID if already created

              await fetch(`${ssiTenantUrl}/api/v1/did/register`, {
                method: 'POST',
                headers: {
                  authorization: `Bearer ${ssiAccessToken.access_token}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  didDocument,
                  verificationMethodId: `${didToRegister}#key-1`,
                }),
              });
              break;
            }

            case OnboardingStep.CREATE_KYC_SERVICE: {
              const createKYCServiceDto = {
                appName: `${companyName}_KYC_Service`,
                domain,
                serviceIds: [SERVICE_TYPES.CAVACH_API] as [SERVICE_TYPES],
                whitelistedCors: ['*'],
                env: APP_ENVIRONMENT.dev,
                hasDomainVerified: false,
                dependentServices: [
                  ssiService?.appId || customerOnboardingData.kycServiceId,
                ],
                issuerDid:
                  issuerDidData?.did || customerOnboardingData.businessId,
                issuerVerificationMethodId: `${
                  issuerDidData?.did || customerOnboardingData.businessId
                }#key-1`,
              };

              kycService = await this.appAuthService.createAnApp(
                createKYCServiceDto,
                userId,
              );
              kycSubdomain = kycService.subdomain;
              onboardingUpdateData.kycSubdomain = kycService.subdomain;
              onboardingUpdateData.kycServiceId = kycService.appId;
              kycTenantUrl = this.getTenantUrl(cavachBaseDomain, kycSubdomain);
              break;
            }

            case OnboardingStep.GIVE_KYC_DASHBOARD_ACCESS: {
              await this.userRepository.findOneUpdate(
                {
                  userId,
                  accessList: {
                    $not: {
                      $elemMatch: {
                        serviceType: 'CAVACH_API',
                        access: 'ALL',
                      },
                    },
                  },
                },
                {
                  $push: {
                    accessList: {
                      serviceType: 'CAVACH_API',
                      access: 'ALL',
                      expiryDate: null,
                    },
                  },
                },
              );
              break;
            }

            case OnboardingStep.CREDIT_KYC_SERVICE: {
              const kycCreditPayload = {
                serviceId:
                  kycService?.appId || customerOnboardingData?.kycServiceId,
                purpose: 'CreditRecharge',
                amount: kycCreditDetail.amount,
                validityPeriod: kycCreditDetail.validityPeriod,
                validityPeriodUnit: kycCreditDetail.validityPeriodUnit,
                amountDenom: kycCreditDetail.amountDenom,
                subdomain:
                  kycService?.subdomain || customerOnboardingData.kycSubdomain,
                grantType: GRANT_TYPES.access_service_kyc,
                whitelistedCors: kycService?.whitelistedCors || ['*'],
              };

              const kycCreditToken = await this.jwt.signAsync(
                kycCreditPayload,
                { expiresIn: '5m', secret },
              );
              await fetch(`${kycTenantUrl}api/v1/credit`, {
                method: 'POST',
                headers: {
                  authorization: `Bearer ${kycCreditToken}`,
                  'Content-Type': 'application/json',
                },
              });
              break;
            }

            case OnboardingStep.COMPLETED: {
              onboardingUpdateData.creditStatus = CreditStatus.APPROVED;
              break;
            }
          }
          this.logStepSuccess(onboardingLogs, step as OnboardingStep);
        } catch (error) {
          this.logStepFailure(onboardingLogs, step as OnboardingStep, error);
          break;
        }
      }
      await this.customerOnboardingRepository.updateCustomerOnboardingDetails(
        { _id: id },
        {
          ...onboardingUpdateData,
          logs: this.mergeLogs(
            customerOnboardingData.logs || [],
            onboardingLogs,
          ),
        },
      );
      const failed = onboardingLogs.find((l) => l.status === StepStatus.FAILED);
      if (failed) {
        throw new BadRequestException(
          `Step ${failed.step} failed: ${failed.failureReason}`,
        );
      }

      return { message: 'Customer onboarding completed successfully' };
    } catch (e) {
      if (e instanceof HttpException) throw e;
      else throw new BadRequestException([`${e.message}`]);
    }
  }

  private mergeLogs(existing: LogDetail[], newOnes: LogDetail[]): LogDetail[] {
    const map = new Map<string, LogDetail>();
    for (const log of existing) map.set(log.step, log);
    for (const log of newOnes) map.set(log.step, log);
    return Array.from(map.values()).sort(
      (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime(),
    );
  }

  private logStepSuccess(logs: LogDetail[], step: OnboardingStep) {
    logs.push({ step, status: StepStatus.SUCCESS, time: new Date() });
  }

  private logStepFailure(logs: LogDetail[], step: OnboardingStep, error: any) {
    logs.push({
      step,
      status: StepStatus.FAILED,
      time: new Date(),
      failureReason: error.message,
    });
  }

  private getTenantUrl(baseUrl: string, subdomain?: string): string {
    const url = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    if (!subdomain) return url.origin + '/';
    const parts = url.hostname.split('.');
    const idx = parts.indexOf('api');
    if (idx === 0) parts.unshift(subdomain);
    else parts[0] = `${subdomain}.${parts[0]}`;
    url.hostname = parts.join('.');
    return url.origin + '/';
  }
}
