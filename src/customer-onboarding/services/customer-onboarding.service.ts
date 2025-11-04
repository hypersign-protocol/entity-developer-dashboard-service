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
import { sanitizeUrl } from 'src/utils/utils';
import { RoleRepository } from 'src/roles/repository/role.repository';
import { ONBORDING_CONSTANT_DATA } from '../constants/en';
import { WebpageConfigService } from 'src/webpage-config/services/webpage-config.service';
import {
  ExpiryType,
  PageType,
} from 'src/webpage-config/dto/create-webpage-config.dto';

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
    private readonly roleRepository: RoleRepository,
    private readonly webPageConfig: WebpageConfigService,
  ) {}
  /**
   * Creates a new customer onboarding record and notifies super admins
   * @param createCustomerOnboardingDto - DTO containing customer onboarding details including KYC/KYB preferences
   * @param userId - ID of the user creating the onboarding request
   * @returns Created customer onboarding record
   * @throws ConflictException if a duplicate record exists
   * @throws BadRequestException for other validation errors
   */
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

  /**
   * Retrieves a specific customer onboarding record with access control
   * @param id - ID of the customer onboarding record to find
   * @param user - User object containing role and userId for access control
   * @returns Customer onboarding record if found and authorized
   * @throws BadRequestException if record not found
   * @throws ForbiddenException if user is not authorized
   */
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

  /**
   * Sends notification emails to super administrators about new onboarding requests
   * @param message - The email body content with onboarding request details
   * @param superAdminEmailList - List of super admin email addresses
   * @param subject - Email subject line
   * @remarks First email in the list is set as 'to' recipient, remaining are CC'd
   */
  private async sendOnboardingRequestMailToSuperAdmin(
    message: string,
    superAdminEmailList: string[],
    subject: string,
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
  /**
   * Makes an external HTTP request with error handling and response validation
   * @param url - The URL to make the request to
   * @param options - Request options including method, headers, body etc.
   * @param errorMessage - Custom error message prefix for better error reporting
   * @returns Promise resolving to the JSON response from the API
   * @throws Error if request fails or response is not OK
   */
  private async makeExternalRequest(
    url: string,
    options: RequestInit,
    errorMessage: string,
  ) {
    Logger.log('Inside makeExternalRequest()', 'CustomerOnboardingService');
    try {
      const response = await fetch(url, options);
      const detail = await response.json();
      if (!response.ok) {
        throw new Error(`${errorMessage}: ${detail.error.details}`);
      }
      return detail;
    } catch (error) {
      throw new Error(`${error.message}`);
    }
  }

  /**
   * Generates a JWT token for credit service authorization
   * @param payload - The payload to be included in the JWT token
   * @param secret - The secret key used for signing the token
   * @returns Promise resolving to the signed JWT token
   */
  private async generateCreditToken(
    payload: any,
    secret: string,
  ): Promise<string> {
    Logger.log('inside generateCreditToken method', 'generateCreditToken');
    return this.jwt.signAsync(payload, { expiresIn: '5m', secret });
  }

  /**
   * Handles the credit service operations for both SSI and KYC services
   * @param creditDetail - Credit details including amount and validity
   * @param serviceInfo - Service information containing appId and subdomain
   * @param grantType - Type of access grant (SSI or KYC)
   * @param tenantUrl - URL of the tenant service
   * @param secret - Secret key for token generation
   * @param whitelistedCors - CORS whitelist array (defaults to ['*'])
   */
  private async handleCreditService(
    creditDetail: any,
    serviceInfo: { appId: string; subdomain: string },
    grantType: string,
    tenantUrl: string,
    secret: string,
    whitelistedCors: string[] = ['*'],
  ) {
    Logger.debug(tenantUrl);
    Logger.log(
      `Inside handleCreditService() to fund credit to the service with tenantUrl ${tenantUrl}`,
      'CustomerOnboardingService',
    );
    const creditPayload = {
      serviceId: serviceInfo.appId,
      purpose: 'CreditRecharge',
      amount: creditDetail.amount,
      validityPeriod: creditDetail.validityPeriod,
      validityPeriodUnit: creditDetail.validityPeriodUnit,
      amountDenom: creditDetail.amountDenom,
      subdomain: serviceInfo.subdomain,
      grantType,
      whitelistedCors,
    };

    const creditToken = await this.generateCreditToken(creditPayload, secret);
    let headers: Record<string, string> = {
      authorization: `Bearer ${creditToken}`,
      'Content-Type': 'application/json',
    };

    if (grantType === GRANT_TYPES.access_service_kyc) {
      headers = {
        'x-kyc-access-token': creditToken,
        'Content-Type': 'application/json',
      };
    }
    await this.makeExternalRequest(
      `${sanitizeUrl(tenantUrl, true)}api/v1/credit`,
      {
        method: 'POST',
        headers,
      },
      'Failed to credit service',
    );
  }
  /**
   * Processes a customer onboarding request through multiple steps
   * Steps include:
   * 1. Creating SSI service
   * 2. Crediting SSI service
   * 3. Creating and registering DID
   * 4. Creating KYC service
   * 5. Granting KYC dashboard access
   * 6. Crediting KYC service
   * @param id - ID of the customer onboarding record to process
   * @param customerOnboardingProcessDto - DTO containing process details including credit information
   * @returns Success message upon completion
   * @throws BadRequestException if any step fails or validation errors occur
   */
  async processCustomerOnboarding(
    id: string,
    customerOnboardingProcessDto: CustomerOnboardingProcessDto,
  ) {
    const onboardingLogs: LogDetail[] = [];
    const onboardingUpdateData: Partial<CustomerOnboarding> = {};
    let ssiService: any,
      kycAccessToken: any,
      ssiAccessToken: any,
      issuerDidData: any,
      kycService: any,
      didDocument: any;

    try {
      const { ssiCreditDetail, kycCreditDetail } = customerOnboardingProcessDto;

      // Validate and fetch customer onboarding details
      const customerOnboardingData =
        await this.customerOnboardingRepository.findCustomerOnboardingById({
          _id: id,
        });

      if (!customerOnboardingData) {
        throw new BadRequestException(
          `Customer onboarding detail not found for id: ${id}`,
        );
      }

      // Initialize configuration
      const { companyName, domain, userId, companyLogo, customerEmail } =
        customerOnboardingData;
      const ssiBaseDomain = this.config.get<string>('SSI_API_DOMAIN');
      const cavachBaseDomain = this.config.get<string>('CAVACH_API_DOMAIN');
      const secret = this.config.get('JWT_SECRET');

      let ssiSubdomain = customerOnboardingData?.ssiSubdomain;
      let kycSubdomain = customerOnboardingData?.kycSubdomain;
      let ssiTenantUrl = this.getTenantUrl(ssiBaseDomain, ssiSubdomain);
      let kycTenantUrl = this.getTenantUrl(cavachBaseDomain, kycSubdomain);

      // Get remaining steps
      const lastStep =
        customerOnboardingData.logs
          ?.filter((log) => log.status === StepStatus.SUCCESS)
          .pop()?.step ?? null;

      const startIndex = lastStep
        ? Object.values(OnboardingStep).indexOf(lastStep) + 1
        : 0;
      const remainingSteps = Object.values(OnboardingStep).slice(startIndex);
      if (remainingSteps.length === 0) {
        throw new BadRequestException(['Customer onboarding is already done']);
      }
      // Process each step
      for (const step of remainingSteps) {
        try {
          switch (step) {
            case OnboardingStep.CREATE_TEAM_ROLE: {
              Logger.log(
                'CREATE_TEAM_ROLE step started',
                'CustomerOnboardingService',
              );
              const existingRole = await this.roleRepository.findOne({
                userId,
              });
              if (!existingRole) {
                await this.roleRepository.create({
                  userId,
                  roleName: ONBORDING_CONSTANT_DATA.TEAM_ROLE_NAME,
                  roleDescription: ONBORDING_CONSTANT_DATA.ROLE_DESCRIPTION,
                  permissions: ONBORDING_CONSTANT_DATA.ROLE_PERMISSIONS,
                });
                Logger.debug(
                  'Team role created successfully',
                  'CustomerOnboardingService',
                );
              } else {
                Logger.debug(
                  `Role '${ONBORDING_CONSTANT_DATA.TEAM_ROLE_NAME}' already exists for user ${userId}`,
                  'CustomerOnboardingService',
                );
              }
              Logger.debug(
                'CREATE_TEAM_ROLE step ends',
                'CustomerOnboardingService',
              );
              break;
            }
            case OnboardingStep.CREATE_SSI_SERVICE: {
              Logger.log(
                'CREATE_SSI_SERVICE step started',
                'CustomerOnboardingService',
              );
              ssiService = await this.appAuthService.createAnApp(
                {
                  appName: `${companyName}`,
                  domain,
                  serviceIds: [SERVICE_TYPES.SSI_API],
                  whitelistedCors: ['*'],
                  env: APP_ENVIRONMENT.dev,
                  hasDomainVerified: false,
                  logoUrl: companyLogo,
                },
                userId,
              );

              ssiSubdomain = ssiService.subdomain;
              onboardingUpdateData.ssiSubdomain = ssiService.subdomain;
              onboardingUpdateData.ssiServiceId = ssiService.appId;
              ssiTenantUrl = this.getTenantUrl(ssiBaseDomain, ssiSubdomain);
              Logger.debug(
                'CREATE_SSI_SERVICE step ends',
                'CustomerOnboardingService',
              );
              break;
            }

            case OnboardingStep.CREDIT_SSI_SERVICE: {
              Logger.log(
                'CREDIT_SSI_SERVICE step started',
                'CustomerOnboardingService',
              );
              await this.handleCreditService(
                ssiCreditDetail,
                {
                  appId:
                    ssiService?.appId || customerOnboardingData.ssiServiceId,
                  subdomain:
                    ssiService?.subdomain ||
                    customerOnboardingData.ssiSubdomain,
                },
                GRANT_TYPES.access_service_ssi,
                ssiTenantUrl,
                secret,
                ssiService?.whitelistedCors,
              );
              Logger.debug(
                'CREDIT_SSI_SERVICE step ends',
                'CustomerOnboardingService',
              );
              break;
            }

            case OnboardingStep.CREATE_DID: {
              Logger.log(
                'CREATE_DID step started',
                'CustomerOnboardingService',
              );
              if (!ssiService && customerOnboardingData.ssiServiceId) {
                ssiService = await this.appAuthRepository.findOne({
                  appId: customerOnboardingData.ssiServiceId,
                });
              }

              ssiAccessToken = await this.appAuthService.getAccessToken(
                GRANT_TYPES.access_service_ssi,
                ssiService,
                4,
              );

              const didData = await this.makeExternalRequest(
                `${sanitizeUrl(ssiTenantUrl, true)}api/v1/did/create`,
                {
                  method: 'POST',
                  headers: {
                    authorization: `Bearer ${ssiAccessToken.access_token}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ namespace: 'testnet' }),
                },
                'Failed to create DID',
              );

              issuerDidData = didData;
              didDocument = didData?.metaData.didDocument;
              onboardingUpdateData.businessId = didData.did;
              Logger.debug('CREATE_DID step ends', 'CustomerOnboardingService');
              break;
            }

            case OnboardingStep.REGISTER_DID: {
              Logger.log(
                'REGISTER_DID step started',
                'CustomerOnboardingService',
              );
              ssiAccessToken =
                ssiAccessToken ||
                (await this.appAuthService.getAccessToken(
                  GRANT_TYPES.access_service_ssi,
                  ssiService,
                  4,
                ));

              const didToRegister =
                issuerDidData?.did || customerOnboardingData.businessId;

              if (!didDocument) {
                const resolvedDidData = await this.makeExternalRequest(
                  `${sanitizeUrl(
                    ssiTenantUrl,
                    true,
                  )}api/v1/did/${didToRegister}`,
                  {
                    method: 'POST',
                    headers: {
                      authorization: `Bearer ${ssiAccessToken.access_token}`,
                      'Content-Type': 'application/json',
                    },
                  },
                  'Failed to resolve DID',
                );
                didDocument = resolvedDidData.didDocument;
              }

              await this.makeExternalRequest(
                `${sanitizeUrl(ssiTenantUrl, true)}api/v1/did/register`,
                {
                  method: 'POST',
                  headers: {
                    authorization: `Bearer ${ssiAccessToken.access_token}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    didDocument,
                    verificationMethodId: `${didToRegister}#key-1`,
                  }),
                },
                'Failed to register DID',
              );
              Logger.debug(
                'REGISTER_DID step ends',
                'CustomerOnboardingService',
              );
              break;
            }

            case OnboardingStep.CREATE_KYC_SERVICE: {
              Logger.log(
                'CREATE_KYC_SERVICE step started',
                'CustomerOnboardingService',
              );
              kycService = await this.appAuthService.createAnApp(
                {
                  appName: `${companyName}`,
                  domain: domain,
                  serviceIds: [SERVICE_TYPES.CAVACH_API],
                  whitelistedCors: ['*'],
                  env: APP_ENVIRONMENT.dev,
                  hasDomainVerified: false,
                  dependentServices: [
                    ssiService?.appId || customerOnboardingData.kycServiceId,
                  ],
                  logoUrl: companyLogo,
                  issuerDid:
                    issuerDidData?.did || customerOnboardingData.businessId,
                  issuerVerificationMethodId: `${
                    issuerDidData?.did || customerOnboardingData.businessId
                  }#key-1`,
                },
                userId,
              );

              kycSubdomain = kycService.subdomain;
              onboardingUpdateData.kycSubdomain = kycService.subdomain;
              onboardingUpdateData.kycServiceId = kycService.appId;
              kycTenantUrl = this.getTenantUrl(cavachBaseDomain, kycSubdomain);
              Logger.debug(
                'CREATE_KYC_SERVICE step ends',
                'CustomerOnboardingService',
              );
              break;
            }

            case OnboardingStep.GIVE_KYC_DASHBOARD_ACCESS: {
              Logger.log(
                'GIVE_KYC_DASHBOARD_ACCESS step started',
                'CustomerOnboardingService',
              );
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
              Logger.debug(
                'GIVE_KYC_DASHBOARD_ACCESS step ends',
                'CustomerOnboardingService',
              );
              break;
            }

            case OnboardingStep.CREDIT_KYC_SERVICE: {
              Logger.log(
                'CREDIT_KYC_SERVICE step started',
                'CustomerOnboardingService',
              );
              await this.handleCreditService(
                kycCreditDetail,
                {
                  appId:
                    kycService?.appId || customerOnboardingData?.kycServiceId,
                  subdomain:
                    kycService?.subdomain ||
                    customerOnboardingData.kycSubdomain,
                },
                GRANT_TYPES.access_service_kyc,
                kycTenantUrl,
                secret,
                kycService?.whitelistedCors,
              );
              Logger.debug(
                'CREDIT_KYC_SERVICE step ends',
                'CustomerOnboardingService',
              );
              break;
            }
            case OnboardingStep.SETUP_KYC_WIDGET: {
              Logger.log(
                'SETUP_KYC_WIDGET step started',
                'CustomerOnboardingService',
              );
              if (!kycService && customerOnboardingData.kycServiceId) {
                kycService = await this.appAuthRepository.findOne({
                  appId: customerOnboardingData.kycServiceId,
                });
              }
              kycAccessToken = await this.appAuthService.getAccessToken(
                GRANT_TYPES.access_service_kyc,
                kycService,
                4,
              );
              const requestBody = {
                faceRecog: true,
                idOcr: {
                  enabled: false,
                  documentType: null,
                },
                issuerDID:
                  issuerDidData?.did || customerOnboardingData.businessId,
                issuerVerificationMethodId: `${
                  issuerDidData?.did || customerOnboardingData.businessId
                }#key-1`,
                onChainId: {
                  enabled: false,
                  selectedOnChainKYCconfiguration: null,
                },
                zkProof: {
                  enabled: false,
                  proofs: [],
                },
                userConsent: {
                  domain,
                  enabled: true,
                  logoUrl: companyLogo,
                  reason:
                    'The app is requesting your KYC data to provide you service',
                },
              };
              await this.makeExternalRequest(
                `${sanitizeUrl(
                  kycTenantUrl,
                  true,
                )}api/v1/e-kyc/verification/widget-config`,
                {
                  method: 'POST',
                  headers: {
                    'x-kyc-access-token': kycAccessToken.access_token,
                    'Content-Type': 'application/json',
                    origin: '*',
                  },
                  body: JSON.stringify(requestBody),
                },
                'Failed to set up widget configuration',
              );
              Logger.debug(
                'SETUP_KYC_WIDGET step ends',
                'CustomerOnboardingService',
              );
              break;
            }
            case OnboardingStep.CONFIGURE_KYC_VERIFIER_PAGE: {
              Logger.log(
                'CONFIGURE_KYC_VERIFIER_PAGE step started',
                'CustomerOnboardingService',
              );

              const user = await this.userRepository.findOne({
                userId: userId,
              });
              const serviceId =
                kycService?.appId || customerOnboardingData.kycServiceId;
              await this.webPageConfig.storeWebPageConfigDetial(
                serviceId,
                {
                  pageTitle: 'KYC Verification',
                  pageDescription: 'Complete your KYC verification to proceed',
                  expiryType: ExpiryType.ONE_MONTH,
                  pageType: PageType.KYC,
                  contactEmail: customerEmail,
                  themeColor: 'vibrant',
                },
                user,
              );
              Logger.debug(
                'CONFIGURE_KYC_VERIFIER_PAGE step ends',
                'CustomerOnboardingService',
              );
              break;
            }

            case OnboardingStep.COMPLETED: {
              Logger.log('COMPLETED', 'CustomerOnboardingService');
              onboardingUpdateData.onboardingStatus = CreditStatus.APPROVED;
              break;
            }
          }
          this.logStepSuccess(onboardingLogs, step as OnboardingStep);
        } catch (error) {
          this.logStepFailure(onboardingLogs, step as OnboardingStep, error);
          break;
        }
      }

      // Update onboarding details
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
      // Check for failures
      const failed = onboardingLogs.find((l) => l.status === StepStatus.FAILED);
      if (failed) {
        throw new BadRequestException(
          `Step ${failed.step} failed: ${failed.failureReason}`,
        );
      }

      return { message: 'Customer onboarding completed successfully' };
    } catch (e) {
      if (e instanceof HttpException) throw e;
      throw new BadRequestException([e.message]);
    }
  }

  /**
   * Merges existing logs with new logs, maintaining chronological order and deduplication
   * @param existing - Array of existing log details
   * @param newOnes - Array of new log details to be merged
   * @returns Combined and sorted array of unique log details
   */
  private mergeLogs(existing: LogDetail[], newOnes: LogDetail[]): LogDetail[] {
    const map = new Map<string, LogDetail>();
    for (const log of existing) map.set(log.step, log);
    for (const log of newOnes) map.set(log.step, log);
    return Array.from(map.values()).sort(
      (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime(),
    );
  }

  /**
   * Logs a successful step completion in the onboarding process
   * @param logs - Array of log details to append to
   * @param step - The onboarding step that was completed successfully
   */
  private logStepSuccess(logs: LogDetail[], step: OnboardingStep) {
    logs.push({ step, status: StepStatus.SUCCESS, time: new Date() });
  }

  /**
   * Logs a failed step in the onboarding process with error details
   * @param logs - Array of log details to append to
   * @param step - The onboarding step that failed
   * @param error - The error object containing failure details
   */
  private logStepFailure(logs: LogDetail[], step: OnboardingStep, error: any) {
    logs.push({
      step,
      status: StepStatus.FAILED,
      time: new Date(),
      failureReason: error.message,
    });
  }

  /**
   * Constructs the tenant URL based on the base URL and subdomain
   * @param baseUrl - The base URL of the service
   * @param subdomain - Optional subdomain to be prepended
   * @returns Formatted tenant URL with proper subdomain handling
   */
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
