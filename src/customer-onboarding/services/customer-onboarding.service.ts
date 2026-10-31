import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { CreateCustomerOnboardingDto } from '../dto/create-customer-onboarding.dto';
import { CustomerOnboardingRepository } from '../repositories/customer-onboarding.repositories';
import getCreditRequestNotificationMail from 'src/mail-notification/constants/templates/credit-request.template';
import getOnboardingApprovedNotificationMail from 'src/mail-notification/constants/templates/onboarding-approve.template';
import getOnboardingRejectedNotificationMail from 'src/mail-notification/constants/templates/onboarding-rejected.template';
import { UserRepository } from 'src/user/repository/user.repository';
import { UserRole } from 'src/user/schema/user.schema';
import { MailNotificationService } from 'src/mail-notification/services/mail-notification.service';
import { CreditDetail } from '../dto/customer-onboarding-process.dto';
import {
  AppAuthService,
  GRANT_TYPES,
} from 'src/app-auth/services/app-auth.service';
import {
  APP_ENVIRONMENT,
  Context,
  SERVICE_TYPES,
  SERVICES,
} from 'src/supported-service/services/iServiceList';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
  CreditStatus,
  InterestedService,
  OnboardingStep,
  StepStatus,
  SupportedKybDocument,
  SupportedDocument,
  TimeUnit,
} from '../constants/enum';
import {
  CustomerOnboarding,
  LogDetail,
} from '../schemas/customer-onboarding.schema';
import { AppRepository } from 'src/app-auth/repositories/app.repository';
import {
  evaluateAccessPolicy,
  generateHash,
  getAccessListForModule,
  ONBOARDING_EXTERNAL_REQUEST_TIMEOUT_MS,
  SERVICE_ENDPOINTS,
  REDIS_KEYS,
  sanitizeUrl,
} from 'src/utils/utils';
import { RoleRepository } from 'src/roles/repository/role.repository';
import { ONBORDING_CONSTANT_DATA } from '../constants/en';
import { WebpageConfigService } from 'src/webpage-config/services/webpage-config.service';
import {
  ExpiryType,
  PageType,
} from 'src/webpage-config/dto/create-webpage-config.dto';
import getOnboardingRetryNotificationMail from 'src/mail-notification/constants/templates/request-retry-onboarding';
import getOnboardingFailureNotificationMail from 'src/mail-notification/constants/templates/onboarding-failure.template';
import { redisClient } from 'src/utils/redis.provider';
import { EXPIRY_CONFIG } from 'src/utils/time-constant';
import { TokenModule } from 'src/config/access-matrix';
import { CreditService } from 'src/credits/services/credits.service';
import { urlSanitizer } from 'src/utils/sanitizeUrl.validator';
import { VerificationMethodTypes } from 'src/utils/generated/client/enums';
import { Types } from 'mongoose';
import { CreditSourceEnum } from 'src/credits/schemas/credit.schema';
import { calculateDidOnboardingCreditAmounts } from 'src/credits/utils/credit-amounts';
import { v4 as uuidv4 } from 'uuid';
import { validate, ValidationError } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { KybCompanyFieldsDto } from '../dto/submit-kyb-company.dto';
import { KybVerificationEnum } from '../constants/identifier-types';
import { CompanyVerificationWebhookDto } from '../dto/company-verification-webhook.dto';

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
    private readonly creditService: CreditService,
  ) {}

  async updateCompanyVerificationStatus(
    payload: CompanyVerificationWebhookDto,
    secret: string,
  ) {
    const expectedSecret = this.config.get<string>(
      'CUSTOMER_ONBOARDING_WEBHOOK_SECRET',
    );
    if (!expectedSecret || secret !== expectedSecret) {
      throw new UnauthorizedException(['Invalid webhook secret']);
    }

    const { companyId, status, statusReason } = payload.data;
    const onboarding =
      await this.customerOnboardingRepository.findCustomerOnboardingById({
        companyId,
      });
    if (!onboarding) {
      throw new BadRequestException(['Company onboarding detail not found']);
    }

    const isCompleted = status === KybVerificationEnum.Completed;
    const reason = statusReason?.join(', ') || '';
    const isUnchanged =
      onboarding.companyVerificationStatus === status &&
      (isCompleted || (onboarding.companyStatusReason || '') === reason);
    if (isUnchanged) return onboarding;

    const updated =
      await this.customerOnboardingRepository.updateCustomerOnboardingDetails(
        { companyId },
        {
          $set: {
            companyVerificationStatus: status,
            ...(!isCompleted && { companyStatusReason: reason }),
          },
        },
      );

    if (status === KybVerificationEnum.Rejected) {
      const user = await this.userRepository.findOne({
        userId: onboarding.userId,
      });
      if (user?.email) {
        await this.sendCustomerCreditRequestNotification({
          to: user.email,
          message: getOnboardingRejectedNotificationMail(user.name, reason),
          subject: 'Business Verification Rejected',
          cc: [],
          mailType: 'send-company-verification-rejected-notification-mail',
        });
      } else {
        Logger.warn(
          `Could not send business verification rejection email: no email found for user ${onboarding.userId}`,
          'CustomerOnboardingService',
        );
      }
    }

    return updated;
  }

  async submitKybCompany(
    onboardingId: string,
    body: Record<string, any>,
    files: any[],
    user: any,
  ) {
    if (!Types.ObjectId.isValid(onboardingId)) {
      throw new BadRequestException(['Invalid customer onboarding ID']);
    }

    const kybAppId = this.config.get<string>('KYB_APP_ID')?.trim();
    const idServiceUrl = this.config.get<string>('CAVACH_API_DOMAIN');
    const ssiServiceUrl = this.config.get<string>('SSI_API_DOMAIN');
    if (!kybAppId || !idServiceUrl || !ssiServiceUrl) {
      throw new InternalServerErrorException(
        'KYB_APP_ID, CAVACH_API_DOMAIN, and SSI_API_DOMAIN must be configured',
      );
    }

    const [onboarding, kybApp] = await Promise.all([
      this.customerOnboardingRepository.findCustomerOnboardingById({
        _id: onboardingId,
        userId: user.userId,
      }),
      this.appAuthRepository.findOne({ appId: kybAppId }),
    ]);
    if (!onboarding) {
      throw new BadRequestException(['Customer onboarding detail not found']);
    }
    const existingCompanyId = onboarding.companyId;
    if (
      existingCompanyId &&
      (onboarding.companyVerificationStatus === KybVerificationEnum.Completed ||
        onboarding.companyVerificationStatus === KybVerificationEnum.Approved)
    ) {
      return onboarding;
    }
    const isRejectedRetry = Boolean(
      existingCompanyId &&
        onboarding.companyVerificationStatus === KybVerificationEnum.Rejected,
    );
    const isRetry = Boolean(
      existingCompanyId &&
        (isRejectedRetry ||
          onboarding.companyVerificationStatus ===
            KybVerificationEnum.Submitted),
    );

    const companyPayload = this.parseMultipartJson(body.company, 'company');
    const company = companyPayload?.fields || companyPayload;

    const phoneNumber =
      body.phoneNumber ?? company?.phoneNumber ?? onboarding.phoneNumber;
    const { documents, orderedFiles } = this.parseKybDocumentParts(
      body,
      files,
      isRetry,
    );
    await this.validateKybCompanyRequest(company, documents, orderedFiles);

    if (
      !kybApp ||
      !kybApp.services?.some(
        (service) => service.id === SERVICE_TYPES.CAVACH_API,
      )
    ) {
      throw new BadRequestException(['Configured KYB app was not found']);
    }
    const ssiAppId = kybApp.dependentServices?.[0];
    if (!ssiAppId) {
      throw new BadRequestException([
        'Configured KYB app does not have a dependent SSI app',
      ]);
    }
    const [[kybAccessToken, ssiAccessToken], accountUser] = await Promise.all([
      this.appAuthRepository.findOne({ appId: ssiAppId }).then((ssiApp) => {
        if (!ssiApp) {
          throw new BadRequestException([
            'Configured dependent SSI app was not found',
          ]);
        }
        return Promise.all([
          this.createConfiguredServiceToken(
            kybApp,
            GRANT_TYPES.access_service_kyb,
            SERVICE_TYPES.CAVACH_API,
          ),
          this.createConfiguredServiceToken(
            ssiApp,
            GRANT_TYPES.access_service_ssi,
            SERVICE_TYPES.SSI_API,
          ),
        ]);
      }),
      // Fetching account user details to ensure correct user information in case of tenant login.
      this.userRepository.findOne({ userId: user.userId }),
      // Phone number is owned by the dashboard, so it is saved even if KYB submission fails later.
      this.customerOnboardingRepository.updateCustomerOnboardingDetails(
        { _id: onboardingId, userId: user.userId },
        {
          $set: {
            companyIDPAppId: kybAppId,
            ...(phoneNumber != null &&
              String(phoneNumber).trim() && {
                phoneNumber: String(phoneNumber).trim(),
              }),
          },
        },
      ),
    ]);
    if (!accountUser) {
      throw new BadRequestException(['Account user detail not found']);
    }
    const namespace = this.config.get<string>('HID_NETWORK_NAMESPACE') || '';
    const temporaryDid = `did:hid:${
      namespace ? `${namespace}:` : ''
    }${uuidv4()}`;
    const jwtResult = await this.makeExternalRequest(
      `${sanitizeUrl(ssiServiceUrl, true)}${
        SERVICE_ENDPOINTS.SSI_ISSUE_DID_JWT
      }`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ssiAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          issuer: {
            verificationMethodId: kybApp?.issuerVerificationMethodId,
            did: kybApp?.issuerDid,
          },
          audience: sanitizeUrl(idServiceUrl, false),
          claims: {
            name: accountUser.name,
            email: accountUser.email,
            did: temporaryDid,
          },
          ttlSeconds: 3600,
        }),
      },
      'Failed to issue KYB onboarding DID JWT',
      true,
    );
    const didJwt = jwtResult?.accessToken || jwtResult?.data?.accessToken;
    if (!didJwt) {
      throw new InternalServerErrorException(
        'SSI service did not return a DID JWT',
      );
    }

    const exchangeResult = await this.makeExternalRequest(
      `${sanitizeUrl(idServiceUrl, true)}${SERVICE_ENDPOINTS.ID_AUTH_EXCHANGE}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${didJwt}`,
          'x-kyb-access-token': kybAccessToken,
          'x-ssi-access-token': ssiAccessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ provider: 'client_auth' }),
      },
      'Failed to exchange the KYB onboarding identity',
      true,
    );
    const userAccessToken =
      exchangeResult?.data?.kycServiceUserAccessToken ||
      exchangeResult?.kycServiceUserAccessToken;
    if (!userAccessToken) {
      throw new InternalServerErrorException(
        'ID-Service did not return a KYB user access token',
      );
    }
    const idServiceHeaders = {
      Authorization: `Bearer ${userAccessToken}`,
      'x-kyb-access-token': kybAccessToken,
      'x-ssi-access-token': ssiAccessToken,
    };
    // Fetching the existing company and uploading new documents only depend on
    // the user access token, so they run concurrently.
    const [existingCompanyDocuments, documentIds] = await Promise.all([
      isRetry
        ? this.makeExternalRequest(
            `${sanitizeUrl(idServiceUrl, true)}${
              SERVICE_ENDPOINTS.ID_KYB_COMPANY_VERIFICATION
            }/${encodeURIComponent(existingCompanyId)}`,
            { method: 'GET', headers: idServiceHeaders },
            'Failed to fetch the existing KYB company',
            true,
          ).then((companyResult) => {
            const existingCompany = companyResult?.data || companyResult;
            return Array.isArray(existingCompany?.documents)
              ? existingCompany.documents
              : [];
          })
        : Promise.resolve([] as any[]),
      Promise.all(
        orderedFiles.map(async (file, index) => {
          const formData = new FormData();
          formData.append(
            'file',
            new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }),
            file.originalname,
          );
          formData.append('entityType', 'Company');
          formData.append('documentType', documents[index].type);
          const uploadResult = await this.makeExternalRequest(
            `${sanitizeUrl(idServiceUrl, true)}${
              SERVICE_ENDPOINTS.ID_DOCUMENT_UPLOAD
            }`,
            { method: 'POST', headers: idServiceHeaders, body: formData },
            `Failed to upload KYB document ${index + 1}`,
            true,
          );
          const documentId = uploadResult?.data?.id || uploadResult?.id;
          if (!documentId) {
            throw new InternalServerErrorException(
              `ID-Service did not return an ID for KYB document ${index + 1}`,
            );
          }
          return documentId as string;
        }),
      ),
    ]);
    const replacementTypes = new Set(documents.map(({ type }) => type));
    const documentsToReplace = existingCompanyDocuments.filter((document) =>
      replacementTypes.has(document.documentType),
    );
    for (const document of documentsToReplace) {
      if (!document?.id) {
        throw new InternalServerErrorException(
          `Existing ${
            document?.documentType || 'KYB'
          } document is missing its ID`,
        );
      }
    }

    const companyResult = await this.makeExternalRequest(
      `${sanitizeUrl(idServiceUrl, true)}${
        SERVICE_ENDPOINTS.ID_KYB_COMPANY_VERIFICATION
      }${isRetry ? `/${encodeURIComponent(existingCompanyId)}` : ''}`,
      {
        method: isRetry ? 'PATCH' : 'POST',
        headers: { ...idServiceHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...company,
          documentIds: isRetry
            ? [
                ...existingCompanyDocuments
                  .filter(
                    (document) =>
                      !documents.some(
                        ({ type }) => type === document.documentType,
                      ),
                  )
                  .map((document) => document.id)
                  .filter(Boolean),
                ...documentIds,
              ]
            : documentIds,
        }),
      },
      'Failed to create the KYB company',
      true,
    );
    const companyData = companyResult?.data || companyResult || {};
    const companyId = companyData._id || companyData.id || existingCompanyId;
    if (!companyId) {
      throw new InternalServerErrorException(
        'ID-Service did not return a company ID',
      );
    }
    // Replaced documents are deleted only after the company points to the new
    // ones, and in the background so a failed delete cannot fail the submission.
    for (const document of documentsToReplace) {
      this.makeExternalRequest(
        `${sanitizeUrl(idServiceUrl, true)}${
          SERVICE_ENDPOINTS.ID_DOCUMENT
        }/${encodeURIComponent(document.id)}`,
        {
          method: 'DELETE',
          headers: idServiceHeaders,
        },
        `Failed to delete replaced KYB document ${document.id}`,
        true,
      ).catch((error) =>
        Logger.error(
          `Failed to delete replaced KYB document ${document.id} of company ${companyId}: ${error?.message}`,
          error?.stack,
          'CustomerOnboardingService',
        ),
      );
    }
    const statusReason = companyData.statusReason;
    const isCompleted = companyData.status === KybVerificationEnum.Completed;
    const updatedOnboarding =
      await this.customerOnboardingRepository.updateCustomerOnboardingDetails(
        { _id: onboardingId, userId: user.userId },
        {
          $set: {
            companyId,
            ...(companyData.status !== undefined && {
              companyVerificationStatus: companyData.status,
            }),
            ...(company.registrationNumber !== undefined && {
              registrationNumber: company.registrationNumber,
            }),
            ...(!isCompleted &&
              statusReason !== undefined && {
                companyStatusReason: Array.isArray(statusReason)
                  ? statusReason.map(String).join(', ')
                  : String(statusReason),
              }),
            ...(isRejectedRetry &&
              !isCompleted &&
              statusReason === undefined && {
                companyStatusReason: '',
              }),
          },
        },
      );
    return updatedOnboarding;
  }

  private parseMultipartJson(value: any, fieldName: string): any {
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch {
      throw new BadRequestException([`${fieldName} must contain valid JSON`]);
    }
  }

  private parseKybDocumentParts(
    body: Record<string, any>,
    files: any[],
    allowNoDocuments = false,
  ) {
    if (!Array.isArray(files)) {
      throw new BadRequestException(['Document uploads must be files']);
    }
    const documentTypes = new Map<number, string>();
    if (body.documents !== undefined) {
      let documentsPayload = body.documents;
      if (typeof documentsPayload === 'string') {
        documentsPayload = this.parseMultipartJson(
          documentsPayload,
          'documents',
        );
      }
      let parsedDocuments: any[];
      if (Array.isArray(documentsPayload)) {
        parsedDocuments = documentsPayload;
      } else if (
        documentsPayload &&
        typeof documentsPayload === 'object' &&
        Object.keys(documentsPayload).every((key) => /^\d+$/.test(key))
      ) {
        const indexes = Object.keys(documentsPayload).sort(
          (left, right) => Number(left) - Number(right),
        );
        if (indexes.some((key, index) => Number(key) !== index)) {
          throw new BadRequestException([
            'Document indexes must start at 0 and be consecutive',
          ]);
        }
        parsedDocuments = indexes.map((key) => documentsPayload[key]);
      } else {
        throw new BadRequestException([
          'documents must be an array of { type, file } items',
        ]);
      }
      parsedDocuments.forEach((document, index) => {
        if (!document || typeof document.type !== 'string') {
          throw new BadRequestException([
            `documents[${index}].type must be a string`,
          ]);
        }
        documentTypes.set(index, document.type);
      });
    } else {
      for (const [fieldName, value] of Object.entries(body)) {
        if (!fieldName.startsWith('documents')) continue;
        const match = /^documents\[(\d+)\](?:\[type\]|\.type)$/.exec(fieldName);
        if (!match || typeof value !== 'string') {
          throw new BadRequestException([
            'Document types must use documents[index][type] fields',
          ]);
        }
        const index = Number(match[1]);
        if (documentTypes.has(index)) {
          throw new BadRequestException([
            `Duplicate document type at index ${index}`,
          ]);
        }
        documentTypes.set(index, value);
      }
    }

    if (documentTypes.size === 0 && !allowNoDocuments) {
      throw new BadRequestException(['At least one document is required']);
    }

    if (documentTypes.size === 0 && files.length === 0) {
      return { documents: [], orderedFiles: [] };
    }

    const indexedFiles = files.map((file) => {
      const match = /^documents\[(\d+)\](?:\[file\]|\.file)$/.exec(
        file.fieldname || '',
      );
      if (!match) {
        throw new BadRequestException([
          'Document files must use documents[index][file] fields',
        ]);
      }
      return { file, index: Number(match[1]) };
    });
    indexedFiles.sort((left, right) => left.index - right.index);
    if (indexedFiles.some((entry, index) => entry.index !== index)) {
      throw new BadRequestException([
        'Document indexes must start at 0 and be consecutive',
      ]);
    }
    if (
      documentTypes.size !== indexedFiles.length ||
      indexedFiles.some(({ index }) => !documentTypes.has(index)) ||
      [...documentTypes.keys()].some((index) => index >= indexedFiles.length)
    ) {
      throw new BadRequestException([
        'Each document type must have a matching file at the same index',
      ]);
    }
    const documents = indexedFiles.map(({ index }) => ({
      type: documentTypes.get(index),
    }));
    return {
      documents,
      orderedFiles: indexedFiles.map(({ file }) => file),
    };
  }

  private async validateKybCompanyRequest(
    company: any,
    documents: any,
    files: any[],
  ): Promise<void> {
    if (!company || typeof company !== 'object' || Array.isArray(company)) {
      throw new BadRequestException(['company must be a JSON object']);
    }
    const companyErrors = await validate(
      plainToInstance(KybCompanyFieldsDto, company),
    );
    if (companyErrors.length) {
      const getValidationMessages = (errors: ValidationError[]): string[] =>
        errors.flatMap((error) => [
          ...Object.values(error.constraints || {}),
          ...getValidationMessages(error.children || []),
        ]);
      throw new BadRequestException(getValidationMessages(companyErrors));
    }
    if (!Array.isArray(documents) || !Array.isArray(files)) {
      throw new BadRequestException(['documents and files must be arrays']);
    }
    if (documents.length !== files.length) {
      throw new BadRequestException([
        'Each document metadata item must have a matching uploaded file',
      ]);
    }
    const supportedTypes = new Set(Object.values(SupportedKybDocument));
    if (
      documents.some(
        (document) =>
          !document ||
          typeof document.type !== 'string' ||
          !supportedTypes.has(document.type),
      )
    ) {
      throw new BadRequestException(['documents contains an unsupported type']);
    }
    const allowedCompanyFields = [
      'name',
      'domain',
      'region',
      'countryOfRegistration',
      'registrationNumber',
      'registrationNumberType',
      'taxIdType',
      'taxIdNumber',
      'address',
    ];
    for (const field of Object.keys(company)) {
      if (!allowedCompanyFields.includes(field)) delete company[field];
    }
  }

  private async createConfiguredServiceToken(
    app: any,
    grantType: GRANT_TYPES,
    serviceType: SERVICE_TYPES,
  ): Promise<string> {
    const accessList = getAccessListForModule(
      TokenModule.APP_AUTH,
      serviceType,
      grantType,
    );
    const key =
      grantType === GRANT_TYPES.access_service_kyb
        ? `${app.appId}_${grantType}`
        : app.appId;
    const sessionId = generateHash(key);
    await this.appAuthService.storeDataInRedis(
      grantType,
      app,
      accessList,
      sessionId,
      generateHash(JSON.stringify(accessList)),
    );
    const token = await this.appAuthService.getAccessToken(
      {
        appId: app.appId,
        appName: app.appName,
        grantType,
        subdomain: app.subdomain,
        sessionId,
      },
      EXPIRY_CONFIG.ONBOARDING_ACCESS.jwtTime,
      EXPIRY_CONFIG.ONBOARDING_ACCESS.jwtUnit,
    );
    return token.access_token;
  }

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
    user,
    loggedInUserEmail,
  ) {
    try {
      Logger.log(
        'Inside createCustomerOnboardingDetail() to store new onbparding request detail',
        'CustomerOnboardingService',
      );
      if (user.role === UserRole.ADMIN) {
        const existingOnboarding =
          await this.customerOnboardingRepository.findCustomerOnboardingById({
            userId: user.userId,
          });
        if (existingOnboarding) {
          throw new ConflictException['You can only create onboarding once']();
        }
      }
      const {
        interestedService,
        companyName,
        domain,
        registrationNumber,
        linkedinUrl,
        twitterUrl,
        telegramUrl,
        country,
        phoneNumber,
        yearlyVolume,
        businessField,
        type,
        customerEmail,
      } = createCustomerOnboardingDto;
      Logger.log('Before storing data in db', 'CustomerOnboardingService');
      const onboardingData =
        await this.customerOnboardingRepository.createCustomerOnboarding({
          ...createCustomerOnboardingDto,
          userId: user.userId,
        });

      void this.processCustomerOnboarding(
        onboardingData['_id'].toString(),
        user.userId,
      ).catch((processingError: any) => {
        Logger.error(
          `Automatic onboarding processing failed for ${onboardingData['_id']}: ${processingError.message}`,
          processingError.stack,
          'CustomerOnboardingService',
        );
      });

      const customerName =
        user?.name || loggedInUserEmail?.split('@')[0] || 'User';
      const message = getCreditRequestNotificationMail({
        customerId: user.userId,
        customerName,
        customerEmail: customerEmail,
        onboardingId: onboardingData['_id'].toString(),
        companyName,
        companyDomain: domain,
        billingAddress: createCustomerOnboardingDto.billingAddress || '',
        companyRegistrationNumber: registrationNumber,
        companyType: String(type),
        linkedinUrl,
        twitterUrl,
        telegramUrl,
        country,
        phoneNumber,
        interestedService,
        yearlyVolume,
        businessField,
        loggedInEmail: loggedInUserEmail,
        referralSource: createCustomerOnboardingDto.referralSource || '',
      });
      const superAdminDetails = await this.userRepository.find({
        role: UserRole.SUPER_ADMIN,
      });
      const superAdminEmails = superAdminDetails.map((admin) => admin.email);
      const subject = 'New Customer Onboarding Request Received';
      Logger.log(
        'Before sending mail to super admin',
        'CustomerOnboardingService',
      );
      await this.sendOnboardingRequestMailToSuperAdmin(
        message,
        superAdminEmails,
        subject,
      );

      return onboardingData;
    } catch (e: any) {
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
      return this.withLiveOnboardingProgress(customerOnboardingData);
    } catch (e: any) {
      Logger.error(
        'Error occured while fetching onboarding detail',
        'CustomerOnboardingService',
      );
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
    Logger.log(
      'Inside sendOnboardingRequestMailToSuperAdmin() to notify admin for new onboarding',
      'CustomerOnboardingService',
    );
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
   * Makes an external HTTP request. KYB calls opt in to the tailored HTTP error
   * response; other onboarding calls keep the existing error behavior.
   */
  private async makeExternalRequest(
    url: string,
    options: RequestInit,
    errorMessage: string,
    handleKybErrors = false,
  ) {
    Logger.log('Inside makeExternalRequest()', 'CustomerOnboardingService');
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      ONBOARDING_EXTERNAL_REQUEST_TIMEOUT_MS,
    );
    try {
      Logger.log(`Making request to ${url}`, 'CustomerOnboardingService');
      // Keep the deadline active through response body parsing as well as fetch.
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      Logger.log(
        `Received response with status ${response.status}`,
        'CustomerOnboardingService',
      );
      const text = await response.text();
      let detail: any = null;
      if (text) {
        if (handleKybErrors) {
          try {
            detail = JSON.parse(text);
          } catch {
            detail = { message: text };
          }
        } else {
          detail = JSON.parse(text);
        }
      }
      if (!response.ok) {
        if (handleKybErrors) {
          Logger.error(
            `KYB upstream request failed: ${JSON.stringify({
              request: errorMessage,
              method: options.method || 'GET',
              url,
              status: response.status,
              responseBody: text.slice(0, 4000),
            })}`,
            undefined,
            'CustomerOnboardingService',
          );
          const upstreamDetails =
            detail?.error?.details || detail?.message || detail?.error;
          const messages = Array.isArray(upstreamDetails)
            ? upstreamDetails.map(String)
            : typeof upstreamDetails === 'string'
            ? [upstreamDetails]
            : upstreamDetails
            ? [JSON.stringify(upstreamDetails)]
            : [];
          const usefulMessages = messages.filter(
            (message) =>
              !['error', 'internal server error'].includes(
                message.trim().toLowerCase(),
              ),
          );
          const readableMessage =
            usefulMessages.join(', ') ||
            `Upstream service returned ${response.status}`;

          if (
            response.status >= 500 ||
            response.status === 401 ||
            response.status === 403
          ) {
            throw new InternalServerErrorException([
              `${errorMessage}: ${readableMessage}`,
            ]);
          }
          throw new HttpException(
            {
              statusCode: response.status,
              message: usefulMessages.length ? usefulMessages : messages,
              error:
                typeof detail?.message === 'string'
                  ? detail.message
                  : 'Upstream request rejected',
            },
            response.status,
          );
        }
        const serverError =
          detail?.error?.details ||
          (Array.isArray(detail?.message)
            ? detail.message.join(', ')
            : detail?.message) ||
          JSON.stringify(detail) ||
          'Unknown error from external service';
        throw new Error(`${errorMessage}: ${serverError}`);
      }
      return detail;
    } catch (error: any) {
      if (controller.signal.aborted) {
        const timeoutError = new Error(
          `External request timed out after ${ONBOARDING_EXTERNAL_REQUEST_TIMEOUT_MS}ms: ${errorMessage}`,
        );
        Logger.error(
          timeoutError,
          timeoutError.stack,
          'CustomerOnboardingService',
        );
        if (handleKybErrors) {
          throw new InternalServerErrorException([
            `${errorMessage}: upstream service timed out`,
          ]);
        }
        throw timeoutError;
      }
      if (handleKybErrors && error instanceof HttpException) {
        throw error;
      }
      if (handleKybErrors) {
        Logger.error(
          `KYB upstream request error: ${error?.message || String(error)}`,
          error?.stack,
          'CustomerOnboardingService',
        );
        throw new InternalServerErrorException([
          `${errorMessage}: upstream service request failed`,
        ]);
      }
      Logger.error(error, error?.stack, 'CustomerOnboardingService');
      throw error;
    } finally {
      clearTimeout(timeout);
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
    Logger.log('Inside generateCreditToken()', 'CustomerOnboardingService');
    const config = EXPIRY_CONFIG.CREDIT_TOKEN;
    const expiresIn = `${config.jwtTime}${config.jwtUnit}`; // e.g. "5m"
    return this.jwt.signAsync(payload, { expiresIn, secret });
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
    creditDetail: CreditDetail,
    serviceInfo: { appId: string; subdomain: string },
    superAdminUserId: string,
    referenceId: string,
    onChainAllowanceAmount?: number,
  ) {
    Logger.log(
      `Inside handleCreditService() to fund credit to the service with appId ${serviceInfo.appId}`,
      'CustomerOnboardingService',
    );
    await this.creditService.grantCredit(
      serviceInfo.appId,
      {
        amount: creditDetail.amount.toString(),
        validityPeriod: creditDetail.validityPeriod,
        validityPeriodUnit: creditDetail.validityPeriodUnit,
        amountDenom: creditDetail.amountDenom,
      },
      superAdminUserId,
      CreditSourceEnum.CUSTOMER_ONBOARDING,
      referenceId,
      onChainAllowanceAmount?.toString(),
    );
  }

  private shouldUseBabyJubJubIssuer(interestedService?: InterestedService[]) {
    return [
      InterestedService.PROOF_OF_PERSONHOOD,
      InterestedService.AGE_VERIFICATION,
    ].some((service) => interestedService?.includes(service));
  }

  private shouldEnableProofOfAge(interestedService?: InterestedService[]) {
    return (
      interestedService?.includes(InterestedService.AGE_VERIFICATION) ?? false
    );
  }

  private getIssuerDetails(
    did: string,
    useBabyJubJubIssuer: boolean,
  ): { issuerDid: string; issuerVerificationMethodId: string } {
    return {
      issuerDid: did,
      issuerVerificationMethodId: `${did}#${
        useBabyJubJubIssuer ? 'key-2' : 'key-1'
      }`,
    };
  }

  private getDidRegisterSignInfos(did: string, useBabyJubJubIssuer: boolean) {
    const signInfos = [
      {
        verification_method_id: `${did}#key-1`,
      },
    ];

    if (useBabyJubJubIssuer) {
      signInfos.push({
        verification_method_id: `${did}#key-2`,
      });
    }

    return signInfos;
  }

  /**
   * Processes a customer onboarding request through multiple steps
   * Steps include:
   * 1. Creating SSI service
   * 2. Crediting SSI service
   * 3. Creating and registering DID
   * 4. Creating KYC service
   * 5. Granting KYC dashboard access
   * @param id - ID of the customer onboarding record to process
   * @param customerOnboardingProcessDto - DTO containing process details including credit information
   * @returns Success message upon completion
   * @throws BadRequestException if any step fails or validation errors occur
   */
  async processCustomerOnboarding(id: string, superAdminUserId: string) {
    Logger.log(
      'Inside processCustomerOnboarding() to approve customer onboarding request',
      'CustomerOnboardingService',
    );
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException(['Invalid customer onboarding ID']);
    }
    const retryableOptionalSteps: OnboardingStep[] = [
      OnboardingStep.CREDIT_SSI_SERVICE,
      OnboardingStep.REGISTER_DID,
    ];
    const onboardingLogs: LogDetail[] = [];
    const onboardingUpdateData: Partial<CustomerOnboarding> = {};
    const processingExecutionId = uuidv4();
    const processingLockKey = `${REDIS_KEYS.CUSTOMER_ONBOARDING_LOCK}${id}`;
    const processingLeaseMs = 2 * 60 * 1000;
    const processingHeartbeatMs = 30 * 1000;
    let processingClaimed = false;
    let processingLeaseLost = false;
    let processingVersion: number | undefined;
    let processingHeartbeat: ReturnType<typeof setInterval> | undefined;
    let heartbeatInFlight = false;
    let retryingOptionalSteps = false;
    let failedOptionalStepsToRetry: OnboardingStep[] = [];
    let ssiService: any,
      widgetConfigDetail: any,
      kycAccessToken: any,
      ssiAccessToken: any,
      issuerDidData: any,
      kycService: any,
      didDocument: any;

    try {
      // A dedicated Redis key serializes processing across service instances.
      // Keep it separate from the progress snapshot, which has its own TTL.
      processingClaimed = await this.acquireOnboardingProcessingLock(
        processingLockKey,
        processingExecutionId,
        processingLeaseMs,
      );
      if (!processingClaimed) {
        throw new ConflictException([
          'Customer onboarding is already being processed. Retry after the active attempt finishes.',
        ]);
      }

      const currentOnboarding =
        await this.customerOnboardingRepository.findCustomerOnboardingById({
          _id: id,
        });
      if (!currentOnboarding) {
        throw new BadRequestException([
          `Customer onboarding detail not found for id: ${id}`,
        ]);
      }
      const alreadyApproved =
        currentOnboarding.onboardingStatus === CreditStatus.APPROVED;
      if (alreadyApproved) {
        failedOptionalStepsToRetry = retryableOptionalSteps.filter((step) =>
          this.isLatestStepFailure(currentOnboarding.logs || [], step),
        );
        if (failedOptionalStepsToRetry.length === 0) {
          processingClaimed = false;
          await this.releaseOnboardingProcessingLock(
            processingLockKey,
            processingExecutionId,
          );
          return { message: 'Customer onboarding completed successfully' };
        }
      }
      retryingOptionalSteps = alreadyApproved;
      const customerOnboardingData =
        await this.customerOnboardingRepository.updateCustomerOnboardingDetails(
          alreadyApproved
            ? {
                _id: id,
                __v: Number((currentOnboarding as any).__v || 0),
                onboardingStatus: CreditStatus.APPROVED,
              }
            : { _id: id, onboardingStatus: { $ne: CreditStatus.APPROVED } },
          {
            ...(alreadyApproved
              ? {}
              : { $set: { onboardingStatus: CreditStatus.PROCESSING } }),
            // Use Mongoose's existing version key as a final-write fencing token.
            $inc: { __v: 1 },
          } as any,
        );
      if (!customerOnboardingData) {
        const currentOnboarding =
          await this.customerOnboardingRepository.findCustomerOnboardingById({
            _id: id,
          });
        if (
          !retryingOptionalSteps &&
          currentOnboarding?.onboardingStatus === CreditStatus.APPROVED
        ) {
          processingClaimed = false;
          await this.releaseOnboardingProcessingLock(
            processingLockKey,
            processingExecutionId,
          );
          return { message: 'Customer onboarding completed successfully' };
        }
        if (!currentOnboarding) {
          throw new BadRequestException([
            `Customer onboarding detail not found for id: ${id}`,
          ]);
        }
        throw new ConflictException([
          'Customer onboarding changed while processing was being claimed. Retry the request.',
        ]);
      }
      processingVersion = Number((customerOnboardingData as any).__v || 0);

      processingHeartbeat = setInterval(async () => {
        if (heartbeatInFlight || !processingClaimed) return;
        heartbeatInFlight = true;
        try {
          const renewed = await this.renewOnboardingProcessingLock(
            processingLockKey,
            processingExecutionId,
            processingLeaseMs,
          );
          if (!renewed) {
            processingLeaseLost = true;
            clearInterval(processingHeartbeat);
            Logger.error(
              `Lost processing lease for onboarding ${id}`,
              'CustomerOnboardingService',
            );
          }
        } catch (error: any) {
          processingLeaseLost = true;
          clearInterval(processingHeartbeat);
          Logger.error(
            `Could not renew processing lease for onboarding ${id}: ${
              error?.message || error
            }`,
            error?.stack,
            'CustomerOnboardingService',
          );
        } finally {
          heartbeatInFlight = false;
        }
      }, processingHeartbeatMs);
      (processingHeartbeat as any).unref?.();

      const { ssiCreditAmount, ssiHidAllowanceAmount, validityPeriod } =
        calculateDidOnboardingCreditAmounts(1);
      const ssiCreditDetail = {
        amount: ssiCreditAmount,
        validityPeriod,
        validityPeriodUnit: TimeUnit.Days,
        amountDenom: 'uhid',
      };

      // Initialize configuration
      const { companyName, domain, userId, companyLogo, customerEmail } =
        customerOnboardingData;
      const useBabyJubJubIssuer = this.shouldUseBabyJubJubIssuer(
        customerOnboardingData.interestedService,
      );
      const ssiBaseDomain = this.config.get<string>('SSI_API_DOMAIN');
      const cavachBaseDomain = this.config.get<string>('CAVACH_API_DOMAIN');
      const secret = this.config.get('JWT_SECRET');
      let ssiTenantUrl = ssiBaseDomain;
      let kycTenantUrl = cavachBaseDomain;
      let ssiRedisKey = generateHash(
        `${customerOnboardingData?.ssiServiceId}_${Context.idDashboard}`,
      );
      let kycRedisKey = generateHash(
        `${customerOnboardingData?.kycServiceId}_${Context.idDashboard}`,
      );

      const progressKey = `${REDIS_KEYS.CUSTOMER_ONBOARDING_PROGRESS}${id}`;
      const redisProgress = await this.loadOnboardingProgress(progressKey);
      const existingProgressTtlMs = await redisClient.pttl(progressKey);
      const progressExpiresAt =
        Date.now() +
        (existingProgressTtlMs > 0
          ? existingProgressTtlMs
          : EXPIRY_CONFIG.ONBOARDING_PROGRESS.redisExpiryTime * 1000);
      const persistedOutputs = {
        ssiSubdomain: customerOnboardingData.ssiSubdomain,
        ssiServiceId: customerOnboardingData.ssiServiceId,
        kycSubdomain: customerOnboardingData.kycSubdomain,
        kycServiceId: customerOnboardingData.kycServiceId,
        businessId: customerOnboardingData.businessId,
        ...(redisProgress?.outputs || {}),
      };
      Object.assign(onboardingUpdateData, persistedOutputs);
      const resumeLogs =
        redisProgress?.logs || customerOnboardingData.logs || [];
      onboardingLogs.splice(0, onboardingLogs.length, ...resumeLogs);

      // Resume from the latest successful step in Redis, falling back to MongoDB.
      const allSteps = Object.values(OnboardingStep);
      const filteredSteps = retryingOptionalSteps
        ? failedOptionalStepsToRetry
        : allSteps.filter((step) => {
            if (
              step === OnboardingStep.CONFIGURE_KYB_VERIFIER_PAGE ||
              step === OnboardingStep.SETUP_KYB_WIDGET
            ) {
              return customerOnboardingData.interestedService?.includes(
                InterestedService.KYB,
              );
            }
            return true;
          });
      const lastSuccessfulStep = [...resumeLogs]
        .reverse()
        .find(
          (log) =>
            log.status === StepStatus.SUCCESS &&
            filteredSteps.includes(log.step),
        )?.step;
      const lastStepIndex = lastSuccessfulStep
        ? filteredSteps.indexOf(lastSuccessfulStep)
        : -1;
      const remainingSteps = retryingOptionalSteps
        ? filteredSteps
        : filteredSteps.slice(lastStepIndex + 1);
      if (redisProgress?.completed === true && remainingSteps.length === 0) {
        await this.assertOnboardingProcessingLock(
          processingLockKey,
          processingExecutionId,
        );
        const completed =
          await this.customerOnboardingRepository.updateCustomerOnboardingDetails(
            { _id: id, __v: processingVersion } as any,
            {
              $set: {
                ...persistedOutputs,
                onboardingStatus: CreditStatus.APPROVED,
                logs: resumeLogs,
              },
              $inc: { __v: 1 },
            } as any,
          );
        if (!completed) {
          throw new ConflictException([
            'Onboarding state changed before completion could be committed.',
          ]);
        }
        processingVersion = undefined;
        processingClaimed = false;
        clearInterval(processingHeartbeat);
        await this.releaseOnboardingProcessingLock(
          processingLockKey,
          processingExecutionId,
        );
        await redisClient.del(progressKey);
        return { message: 'Customer onboarding completed successfully' };
      }
      if (remainingSteps.length === 0) {
        throw new BadRequestException(['Customer onboarding is already done']);
      }
      let onboardingStatus = retryingOptionalSteps
        ? CreditStatus.APPROVED
        : undefined;
      let userDetail = await this.userRepository.findOne({ userId });
      await this.assertOnboardingProcessingLock(
        processingLockKey,
        processingExecutionId,
      );
      await this.storeOnboardingProgress(
        progressKey,
        customerOnboardingData,
        resumeLogs,
        CreditStatus.PROCESSING,
        onboardingUpdateData,
        progressExpiresAt,
        { lockKey: processingLockKey, executionId: processingExecutionId },
      );
      // Process each step
      for (const step of remainingSteps) {
        if (
          processingLeaseLost ||
          !(await this.ownsOnboardingProcessingLock(
            processingLockKey,
            processingExecutionId,
          ))
        ) {
          processingLeaseLost = true;
          throw new ConflictException([
            'Onboarding processing lease was lost. Retry the onboarding.',
          ]);
        }
        try {
          switch (step) {
            case OnboardingStep.GIVE_DASHBOARD_ACCESS: {
              Logger.log(
                'GIVE_DASHBOARD_ACCESS step started',
                'CustomerOnboardingService',
              );
              const requiredAccess = [
                {
                  serviceType: SERVICE_TYPES.CAVACH_API,
                  access: SERVICES.CAVACH_API.ACCESS_TYPES.ALL,
                  expiryDate: null,
                },
                {
                  serviceType: SERVICE_TYPES.SSI_API,
                  access: SERVICES.SSI_API.ACCESS_TYPES.ALL,
                  expiryDate: null,
                },
                {
                  serviceType: SERVICE_TYPES.DASHBOARD,
                  access: SERVICES.DASHBOARD.ACCESS_TYPES.ALL,
                  expiryDate: null,
                },
              ];
              userDetail = await this.userRepository.findOneUpdate({ userId }, [
                {
                  $set: {
                    accessList: {
                      $concatArrays: [
                        { $ifNull: ['$accessList', []] },
                        {
                          $filter: {
                            input: { $literal: requiredAccess },
                            as: 'required',
                            cond: {
                              $not: [
                                {
                                  $in: [
                                    {
                                      $concat: [
                                        '$$required.serviceType',
                                        ':',
                                        '$$required.access',
                                      ],
                                    },
                                    {
                                      $map: {
                                        input: {
                                          $ifNull: ['$accessList', []],
                                        },
                                        as: 'existing',
                                        in: {
                                          $concat: [
                                            '$$existing.serviceType',
                                            ':',
                                            '$$existing.access',
                                          ],
                                        },
                                      },
                                    },
                                  ],
                                },
                              ],
                            },
                          },
                        },
                      ],
                    },
                  },
                },
              ]);
              Logger.debug(
                'GIVE_DASHBOARD_ACCESS step ends',
                'CustomerOnboardingService',
              );
              break;
            }
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
                  whitelistedCors: [
                    sanitizeUrl(
                      this.config.get<string>('CLIENT_APP_URL'),
                      false,
                    ),
                    sanitizeUrl(
                      this.config.get<string>('CAVACH_API_DOMAIN'),
                      false,
                    ),
                    sanitizeUrl(
                      this.config.get<string>('SSI_API_DOMAIN'),
                      false,
                    ),
                    urlSanitizer(
                      this.config.get<string>('KYC_VERIFIER_APP_BASE_URL'),
                      false,
                    ),
                  ],
                  env: APP_ENVIRONMENT.dev,
                  hasDomainVerified: false,
                  logoUrl: companyLogo,
                },
                userId,
              );
              onboardingUpdateData.ssiSubdomain = ssiService.subdomain;
              onboardingUpdateData.ssiServiceId = ssiService.appId;
              ssiTenantUrl = ssiBaseDomain;
              Logger.debug(
                'CREATE_SSI_SERVICE step ends',
                'CustomerOnboardingService',
              );
              ssiRedisKey = generateHash(
                `${ssiService.appId}_${Context.idDashboard}`,
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
                superAdminUserId,
                `customer-onboarding:${id}:ssi`,
                ssiHidAllowanceAmount,
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
              const ssiServiceDetail = await redisClient.get(ssiRedisKey);
              const defaultAccessList = getAccessListForModule(
                TokenModule.DASHBOARD,
                SERVICE_TYPES.SSI_API,
              );
              const accessList = evaluateAccessPolicy(
                defaultAccessList,
                SERVICE_TYPES.SSI_API,
                userDetail.accessList,
                Context.idDashboard,
              );
              if (!ssiServiceDetail) {
                await this.appAuthService.storeDataInRedis(
                  GRANT_TYPES.access_service_ssi,
                  ssiService,
                  accessList,
                  ssiRedisKey,
                );
              }
              ssiAccessToken = await this.appAuthService.getAccessToken(
                {
                  appId:
                    ssiService?.appId || customerOnboardingData.ssiServiceId,
                  grantType: GRANT_TYPES.access_service_ssi,
                  appname: ssiService?.appName,
                  subdomain:
                    ssiService?.subdomain ||
                    customerOnboardingData.ssiSubdomain,
                  sessionId: ssiRedisKey,
                },
                EXPIRY_CONFIG.ONBOARDING_ACCESS.jwtTime,
                EXPIRY_CONFIG.ONBOARDING_ACCESS.jwtUnit,
              );

              const didCreateBody: {
                namespace: string;
                options?: {
                  keyType: string[];
                };
              } = {
                namespace: this.config.get('HID_NETWORK_NAMESPACE') || '',
              };
              if (useBabyJubJubIssuer) {
                didCreateBody.options = {
                  keyType: [
                    VerificationMethodTypes.Ed25519VerificationKey2020,
                    VerificationMethodTypes.BabyJubJubKey2021,
                  ],
                };
              }
              const didData = await this.makeExternalRequest(
                `${sanitizeUrl(ssiTenantUrl, true)}api/v1/did/create`,
                {
                  method: 'POST',
                  headers: {
                    authorization: `Bearer ${ssiAccessToken.access_token}`,
                    'Content-Type': 'application/json',
                    origin: ssiService?.whitelistedCors[0],
                  },
                  body: JSON.stringify(didCreateBody),
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
              if (!ssiService && customerOnboardingData.ssiServiceId) {
                ssiService = await this.appAuthRepository.findOne({
                  appId: customerOnboardingData.ssiServiceId,
                });
              }

              Logger.debug(`ssiService: ${ssiService._id}`);

              const ssiServiceDetail = await redisClient.get(ssiRedisKey);
              const defaultAccessList = getAccessListForModule(
                TokenModule.DASHBOARD,
                SERVICE_TYPES.SSI_API,
              );
              const accessList = evaluateAccessPolicy(
                defaultAccessList,
                SERVICE_TYPES.SSI_API,
                userDetail.accessList,
                Context.idDashboard,
              );
              if (!ssiServiceDetail) {
                await this.appAuthService.storeDataInRedis(
                  GRANT_TYPES.access_service_ssi,
                  ssiService,
                  accessList,
                  ssiRedisKey,
                );
              }
              ssiAccessToken =
                ssiAccessToken ||
                (await this.appAuthService.getAccessToken(
                  {
                    appId:
                      ssiService?.appId || customerOnboardingData.ssiServiceId,
                    grantType: GRANT_TYPES.access_service_ssi,
                    appname: ssiService?.appName,
                    subdomain:
                      ssiService?.subdomain ||
                      customerOnboardingData.ssiSubdomain,
                    sessionId: ssiRedisKey,
                  },
                  EXPIRY_CONFIG.ONBOARDING_ACCESS.jwtTime,
                  EXPIRY_CONFIG.ONBOARDING_ACCESS.jwtUnit,
                ));

              const didToRegister =
                issuerDidData?.did || customerOnboardingData.businessId;

              if (!didDocument) {
                const resolvedDidData = await this.makeExternalRequest(
                  `${sanitizeUrl(
                    ssiTenantUrl,
                    true,
                  )}api/v1/did/resolve/${didToRegister}`,
                  {
                    method: 'GET',
                    headers: {
                      authorization: `Bearer ${ssiAccessToken.access_token}`,
                      'Content-Type': 'application/json',
                      origin: ssiService?.whitelistedCors[0],
                    },
                  },
                  'Failed to resolve DID',
                );
                didDocument = resolvedDidData.didDocument;
              }

              await this.makeExternalRequest(
                `${sanitizeUrl(ssiTenantUrl, true)}api/v1/did/register/v2`,
                {
                  method: 'POST',
                  headers: {
                    authorization: `Bearer ${ssiAccessToken.access_token}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    didDocument,
                    signInfos: this.getDidRegisterSignInfos(
                      didToRegister,
                      useBabyJubJubIssuer,
                    ),
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
              const issuerDetails = this.getIssuerDetails(
                issuerDidData?.did || customerOnboardingData.businessId,
                useBabyJubJubIssuer,
              );
              kycService = await this.appAuthService.createAnApp(
                {
                  appName: `${companyName}`,
                  domain: domain,
                  serviceIds: [SERVICE_TYPES.CAVACH_API],
                  whitelistedCors: [
                    sanitizeUrl(
                      this.config.get<string>('CAVACH_API_DOMAIN'),
                      false,
                    ),
                    urlSanitizer(
                      this.config.get<string>('KYC_WIDGET_URL'),
                      false,
                    ),
                    urlSanitizer(
                      this.config.get<string>('KYC_VERIFIER_APP_BASE_URL'),
                      false,
                    ),
                    urlSanitizer(
                      this.config.get<string>('CLIENT_APP_URL'),
                      false,
                    ),
                    urlSanitizer(
                      this.config.get<string>('KYB_WIDGET_URL'),
                      false,
                    ),
                  ],
                  env: APP_ENVIRONMENT.dev,
                  hasDomainVerified: false,
                  dependentServices: [
                    ssiService?.appId || customerOnboardingData.ssiServiceId,
                  ],
                  logoUrl: companyLogo,
                  issuerDid: issuerDetails.issuerDid,
                  issuerVerificationMethodId:
                    issuerDetails.issuerVerificationMethodId,
                },
                userId,
              );

              // kycSubdomain = kycService.subdomain;
              onboardingUpdateData.kycSubdomain = kycService.subdomain;
              onboardingUpdateData.kycServiceId = kycService.appId;
              kycTenantUrl = cavachBaseDomain; //this.getTenantUrl(cavachBaseDomain, kycSubdomain);
              kycRedisKey = generateHash(
                `${kycService?.appId}_${Context.idDashboard}`,
              );
              Logger.debug(
                'CREATE_KYC_SERVICE step ends',
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
              const defaultAccessList = getAccessListForModule(
                TokenModule.DASHBOARD,
                SERVICE_TYPES.CAVACH_API,
              );
              const accessList = evaluateAccessPolicy(
                defaultAccessList,
                SERVICE_TYPES.CAVACH_API,
                userDetail.accessList,
                Context.idDashboard,
              );
              const kycServiceDetail = await redisClient.get(kycRedisKey);
              if (!kycServiceDetail) {
                await this.appAuthService.storeDataInRedis(
                  GRANT_TYPES.access_service_kyc,
                  kycService,
                  accessList,
                  kycRedisKey,
                );
              }
              kycAccessToken = await this.appAuthService.getAccessToken(
                {
                  appId:
                    kycService?.appId || customerOnboardingData.kycServiceId,
                  appName: kycService.appName,
                  grantType: GRANT_TYPES.access_service_kyc,
                  subdomain:
                    kycService?.subdomain ||
                    customerOnboardingData.kycSubdomain,
                  sessionId: kycRedisKey,
                },
                EXPIRY_CONFIG.ONBOARDING_ACCESS.jwtTime,
                EXPIRY_CONFIG.ONBOARDING_ACCESS.jwtUnit,
              );
              const issuerDetails = this.getIssuerDetails(
                issuerDidData?.did || customerOnboardingData.businessId,
                useBabyJubJubIssuer,
              );
              const enableProofOfAge = this.shouldEnableProofOfAge(
                customerOnboardingData.interestedService,
              );
              const requestBody = {
                name: 'Default Widget Configuration',
                description:
                  "Standard KYC configuration with face recognition and  OCR enabled.'",
                faceRecog: true,
                idOcr: {
                  enabled: true,
                  documentType: SupportedDocument.PASSPORT,
                },
                issuerDID: issuerDetails.issuerDid,
                issuerVerificationMethodId:
                  issuerDetails.issuerVerificationMethodId,
                onChainId: {
                  enabled: false,
                  selectedOnChainKYCconfiguration: null,
                },
                zkProof: enableProofOfAge
                  ? {
                      enabled: true,
                      proofs: [
                        {
                          proofType: 'zkProofOfAge',
                          criteria: 18,
                        },
                      ],
                    }
                  : {
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
                isEmailNotificationEnabled: false,
                isVaultEnabled: false,
                isWidgetLogin: false,
              };
              widgetConfigDetail = await this.makeExternalRequest(
                `${sanitizeUrl(
                  kycTenantUrl,
                  true,
                )}api/v1/e-kyc/verification/widget-config`,
                {
                  method: 'POST',
                  headers: {
                    'x-kyc-access-token': kycAccessToken.access_token,
                    'Content-Type': 'application/json',
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

              const serviceId =
                kycService?.appId || customerOnboardingData.kycServiceId;
              await this.webPageConfig.storeWebPageConfigDetial(serviceId, {
                pageTitle: 'KYC Verification',
                pageDescription: 'Complete your KYC verification to proceed',
                expiryType: ExpiryType.ONE_MONTH,
                pageType: PageType.KYC,
                contactEmail: customerEmail,
                themeColor: 'vibrant',
                linkedWidgetConfigIds: [
                  widgetConfigDetail?.data?._id?.toString(),
                ],
              });
              Logger.debug(
                'CONFIGURE_KYC_VERIFIER_PAGE step ends',
                'CustomerOnboardingService',
              );
              break;
            }
            case OnboardingStep.SETUP_KYB_WIDGET: {
              Logger.log(
                'SETUP_KYB_WIDGET step started',
                'CustomerOnboardingService',
              );
              if (
                !customerOnboardingData.interestedService?.includes(
                  InterestedService.KYB,
                )
              ) {
                break;
              }

              if (!kycService && customerOnboardingData.kycServiceId) {
                kycService = await this.appAuthRepository.findOne({
                  appId: customerOnboardingData.kycServiceId,
                });
              }
              const defaultAccessList = getAccessListForModule(
                TokenModule.DASHBOARD,
                SERVICE_TYPES.CAVACH_API,
              );
              const accessList = evaluateAccessPolicy(
                defaultAccessList,
                SERVICE_TYPES.CAVACH_API,
                userDetail.accessList,
                Context.idDashboard,
              );
              const kycServiceDetail = await redisClient.get(kycRedisKey);
              if (!kycServiceDetail) {
                await this.appAuthService.storeDataInRedis(
                  GRANT_TYPES.access_service_kyb,
                  kycService,
                  accessList,
                  kycRedisKey,
                );
              }
              kycAccessToken = await this.appAuthService.getAccessToken(
                {
                  appId:
                    kycService?.appId || customerOnboardingData.kycServiceId,
                  appName: kycService.appName,
                  grantType: GRANT_TYPES.access_service_kyb,
                  subdomain:
                    kycService?.subdomain ||
                    customerOnboardingData.kycSubdomain,
                  sessionId: kycRedisKey,
                },
                EXPIRY_CONFIG.ONBOARDING_ACCESS.jwtTime,
                EXPIRY_CONFIG.ONBOARDING_ACCESS.jwtUnit,
              );
              const issuerDetails = this.getIssuerDetails(
                issuerDidData?.did || customerOnboardingData.businessId,
                useBabyJubJubIssuer,
              );
              const requestBody = {
                issuerDID: issuerDetails.issuerDid,
                issuerVerificationMethodId:
                  issuerDetails.issuerVerificationMethodId,
                collectCertOfIncorporationDoc: true,
                collectPowerOfAttorneyDoc: true,
                collectAddressProofDoc: true,
                collectZkProof: {
                  enable: false,
                  proofType: '',
                  criteria: '',
                },
                checkAmlPep: false,
                checkAmlSanction: true,
                checkAmlAdversemedia: true,
                checkBusinessRegistry: true,
                branding: {
                  businessName: `${companyName}`,
                  title: '',
                  logoUrl: companyLogo,
                  themeColor: '#1A73E8',
                },
              };
              await this.makeExternalRequest(
                `${sanitizeUrl(
                  kycTenantUrl,
                  true,
                )}api/v1/e-kyb/verification/widget-config`,
                {
                  method: 'POST',
                  headers: {
                    'x-kyc-access-token': kycAccessToken.access_token,
                    'Content-Type': 'application/json',
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
            case OnboardingStep.CONFIGURE_KYB_VERIFIER_PAGE: {
              if (
                !customerOnboardingData.interestedService?.includes(
                  InterestedService.KYB,
                )
              ) {
                break;
              }
              Logger.log('CONFIGURE_KYB_VERIFIER_PAGE started');
              const serviceId =
                kycService?.appId || customerOnboardingData.kycServiceId;
              await this.webPageConfig.storeWebPageConfigDetial(serviceId, {
                pageTitle: 'KYB Verification',
                pageDescription: 'Complete your KYB verification to proceed',
                expiryType: ExpiryType.ONE_MONTH,
                pageType: PageType.KYB,
                contactEmail: customerEmail,
                themeColor: 'vibrant',
              });
              Logger.debug('CONFIGURE_KYB_VERIFIER_PAGE done');
              break;
            }
            case OnboardingStep.COMPLETED: {
              Logger.log('COMPLETED', 'CustomerOnboardingService');
              onboardingUpdateData.onboardingStatus = CreditStatus.APPROVED;
              onboardingStatus = CreditStatus.APPROVED;
              break;
            }
          }
          if (
            processingLeaseLost ||
            !(await this.ownsOnboardingProcessingLock(
              processingLockKey,
              processingExecutionId,
            ))
          ) {
            processingLeaseLost = true;
            throw new ConflictException([
              'Onboarding processing lease was lost. Retry the onboarding.',
            ]);
          }
          this.logStepSuccess(onboardingLogs, step as OnboardingStep);
          await this.storeOnboardingProgress(
            progressKey,
            customerOnboardingData,
            onboardingLogs,
            onboardingStatus || CreditStatus.PROCESSING,
            onboardingUpdateData,
            progressExpiresAt,
            { lockKey: processingLockKey, executionId: processingExecutionId },
          );
        } catch (error: any) {
          if (processingLeaseLost || error instanceof ConflictException) {
            throw error;
          }
          Logger.error(error, error?.stack, 'CustomerOnboardingService');
          this.logStepFailure(onboardingLogs, step as OnboardingStep, error);
          const isOptionalStep = retryableOptionalSteps.includes(
            step as OnboardingStep,
          );
          onboardingStatus = retryingOptionalSteps
            ? CreditStatus.APPROVED
            : isOptionalStep
            ? CreditStatus.PROCESSING
            : CreditStatus.FAILED;
          await this.storeOnboardingProgress(
            progressKey,
            customerOnboardingData,
            onboardingLogs,
            onboardingStatus,
            onboardingUpdateData,
            progressExpiresAt,
            { lockKey: processingLockKey, executionId: processingExecutionId },
          );
          if (!isOptionalStep) break;
        }
      }

      if (
        processingLeaseLost ||
        !(await this.ownsOnboardingProcessingLock(
          processingLockKey,
          processingExecutionId,
        ))
      ) {
        processingLeaseLost = true;
        throw new ConflictException([
          'Onboarding processing lease was lost. Retry the onboarding.',
        ]);
      }
      const finalizedLogs = this.mergeLogs(
        customerOnboardingData.logs || [],
        onboardingLogs,
      );
      // Verify ownership immediately before committing the final result.
      const finalized =
        await this.customerOnboardingRepository.updateCustomerOnboardingDetails(
          { _id: id, __v: processingVersion } as any,
          {
            $set: {
              ...onboardingUpdateData,
              onboardingStatus,
              logs: finalizedLogs,
            },
            $inc: { __v: 1 },
          } as any,
        );
      if (!finalized) {
        throw new ConflictException([
          'Onboarding state changed before the final result could be committed.',
        ]);
      }
      processingVersion = undefined;
      processingClaimed = false;
      clearInterval(processingHeartbeat);
      await this.releaseOnboardingProcessingLock(
        processingLockKey,
        processingExecutionId,
      );
      try {
        await redisClient.del(progressKey);
      } catch (error: any) {
        Logger.warn(
          `Could not clear live onboarding progress: ${
            error?.message || error
          }`,
          'CustomerOnboardingService',
        );
      }
      // Optional step failures are visible and emailed but do not fail onboarding.
      const failedLogs = finalizedLogs.filter(
        (log) => log.status === StepStatus.FAILED,
      );
      const optionalFailures = failedLogs.filter((log) =>
        retryableOptionalSteps.includes(log.step as OnboardingStep),
      );
      for (const failed of optionalFailures) {
        await this.notifySuperAdminsOnOnboardingFailure(
          customerOnboardingData,
          failed.step,
          failed.failureReason || 'Failure reason not recorded',
        );
      }
      const failed = failedLogs.find(
        (log) => !retryableOptionalSteps.includes(log.step as OnboardingStep),
      );
      if (failed) {
        if (!retryableOptionalSteps.includes(failed.step as OnboardingStep)) {
          await this.notifySuperAdminsOnOnboardingFailure(
            customerOnboardingData,
            failed.step,
            failed.failureReason || 'Failure reason not recorded',
          );
        }
        throw new InternalServerErrorException([
          `Step ${failed.step} failed: ${failed.failureReason}`,
        ]);
      }

      if (
        onboardingStatus === CreditStatus.APPROVED &&
        !retryingOptionalSteps
      ) {
        const userDetail = await this.userRepository.findOne({ userId });
        const { email, name } = userDetail;
        const message = getOnboardingApprovedNotificationMail(name);
        this.sendCustomerCreditRequestNotification({
          to: email,
          message,
          subject: 'Hypersign Dashboard  - Onboarding Approved',
          cc: [customerOnboardingData.customerEmail],
          mailType: 'send-credit-approval-notification-mail',
        });
      }
      return { message: 'Customer onboarding completed successfully' };
    } catch (e: any) {
      if (processingClaimed) {
        try {
          if (
            await this.ownsOnboardingProcessingLock(
              processingLockKey,
              processingExecutionId,
            )
          ) {
            if (!retryingOptionalSteps) {
              await this.customerOnboardingRepository.updateCustomerOnboardingDetails(
                { _id: id, __v: processingVersion } as any,
                {
                  $set: { onboardingStatus: CreditStatus.FAILED },
                  $inc: { __v: 1 },
                } as any,
              );
            }
          }
          await this.releaseOnboardingProcessingLock(
            processingLockKey,
            processingExecutionId,
          );
          processingClaimed = false;
        } catch (releaseError: any) {
          Logger.error(
            `Could not release onboarding processing lock ${id}: ${
              releaseError?.message || releaseError
            }`,
            releaseError?.stack,
            'CustomerOnboardingService',
          );
        }
      }
      clearInterval(processingHeartbeat);
      Logger.error(e, 'CustomerOnboardingService');
      if (e instanceof HttpException) throw e;
      throw new InternalServerErrorException([e.message]);
    }
  }

  private async acquireOnboardingProcessingLock(
    key: string,
    executionId: string,
    leaseMs: number,
  ): Promise<boolean> {
    const result = await redisClient.set(key, executionId, 'PX', leaseMs, 'NX');
    return result === 'OK';
  }

  private async renewOnboardingProcessingLock(
    key: string,
    executionId: string,
    leaseMs: number,
  ): Promise<boolean> {
    const result = await redisClient.eval(
      `if redis.call('get', KEYS[1]) == ARGV[1] then
        return redis.call('pexpire', KEYS[1], ARGV[2])
      end
      return 0`,
      1,
      key,
      executionId,
      String(leaseMs),
    );
    return Number(result) === 1;
  }

  private async releaseOnboardingProcessingLock(
    key: string,
    executionId: string,
  ): Promise<boolean> {
    const result = await redisClient.eval(
      `if redis.call('get', KEYS[1]) == ARGV[1] then
        return redis.call('del', KEYS[1])
      end
      return 0`,
      1,
      key,
      executionId,
    );
    return Number(result) === 1;
  }

  private async ownsOnboardingProcessingLock(
    key: string,
    executionId: string,
  ): Promise<boolean> {
    try {
      return (await redisClient.get(key)) === executionId;
    } catch (error: any) {
      Logger.error(
        `Could not verify onboarding processing lock: ${
          error?.message || error
        }`,
        error?.stack,
        'CustomerOnboardingService',
      );
      return false;
    }
  }

  private async assertOnboardingProcessingLock(
    key: string,
    executionId: string,
  ): Promise<void> {
    if (!(await this.ownsOnboardingProcessingLock(key, executionId))) {
      throw new ConflictException([
        'Onboarding processing lease was lost. Retry the onboarding.',
      ]);
    }
  }

  private async sendCustomerCreditRequestNotification({
    to,
    message,
    subject,
    cc,
    mailType,
  }) {
    Logger.log(
      'Inside sendCustomerCreditRequestNotification()',
      'CustomerOnboardingService',
    );
    await this.mailNotificationService.addAJob(
      { to, subject, message, cc },
      mailType,
    );
  }

  private async storeOnboardingProgress(
    key: string,
    onboardingData: CustomerOnboarding,
    logs: LogDetail[],
    onboardingStatus: CreditStatus,
    outputs: Partial<CustomerOnboarding>,
    expiresAt: number,
    processingLock?: { lockKey: string; executionId: string },
  ): Promise<void> {
    try {
      const remainingTtlMs = expiresAt - Date.now();
      if (remainingTtlMs <= 0) {
        Logger.warn(
          `Onboarding progress snapshot expired before it could be updated: ${key}`,
          'CustomerOnboardingService',
        );
        return;
      }
      const savedOutputs = {
        ssiSubdomain: outputs.ssiSubdomain || onboardingData.ssiSubdomain,
        ssiServiceId: outputs.ssiServiceId || onboardingData.ssiServiceId,
        kycSubdomain: outputs.kycSubdomain || onboardingData.kycSubdomain,
        kycServiceId: outputs.kycServiceId || onboardingData.kycServiceId,
        businessId: outputs.businessId || onboardingData.businessId,
      };
      const progress = {
        version: 1,
        onboardingStatus:
          onboardingStatus === CreditStatus.APPROVED
            ? CreditStatus.PROCESSING
            : onboardingStatus,
        completed: onboardingStatus === CreditStatus.APPROVED,
        logs: this.mergeLogs((onboardingData.logs || []) as LogDetail[], logs),
        outputs: savedOutputs,
        updatedAt: new Date().toISOString(),
        expiresAt: new Date(expiresAt).toISOString(),
      };
      // Keep a fixed deadline for this attempt; step updates do not extend it.
      const progressJson = JSON.stringify(progress);
      if (processingLock) {
        const stored = await redisClient.eval(
          `if redis.call('get', KEYS[1]) == ARGV[1] then
            return redis.call('set', KEYS[2], ARGV[2], 'PX', ARGV[3])
          end
          return 0`,
          2,
          processingLock.lockKey,
          key,
          processingLock.executionId,
          progressJson,
          String(remainingTtlMs),
        );
        if (stored !== 'OK') {
          throw new ConflictException([
            'Onboarding processing lease was lost before progress could be saved.',
          ]);
        }
      } else {
        await redisClient.set(key, progressJson, 'PX', remainingTtlMs);
      }
    } catch (error: any) {
      if (error instanceof ConflictException) throw error;
      Logger.warn(
        `Could not store live onboarding progress: ${error?.message || error}`,
        'CustomerOnboardingService',
      );
      throw error;
    }
  }

  private async loadOnboardingProgress(key: string): Promise<{
    onboardingStatus: CreditStatus;
    completed: boolean;
    logs: LogDetail[];
    outputs: Partial<CustomerOnboarding>;
  } | null> {
    try {
      const progressJson = await redisClient.get(key);
      if (!progressJson) return null;
      const progress = JSON.parse(progressJson);
      const validStatuses = Object.values(CreditStatus);
      if (
        progress?.version !== 1 ||
        !validStatuses.includes(progress.onboardingStatus) ||
        !Array.isArray(progress.logs) ||
        !progress.outputs ||
        typeof progress.outputs !== 'object'
      ) {
        await redisClient.del(key);
        return null;
      }
      return progress;
    } catch (error: any) {
      try {
        await redisClient.del(key);
      } catch {
        // Best-effort cleanup; processing falls back to MongoDB state.
      }
      Logger.warn(
        `Could not read onboarding recovery snapshot: ${
          error?.message || error
        }`,
        'CustomerOnboardingService',
      );
      return null;
    }
  }

  private async withLiveOnboardingProgress<T extends object>(
    onboardingData: T,
  ): Promise<T> {
    const data =
      typeof (onboardingData as any).toObject === 'function'
        ? (onboardingData as any).toObject()
        : onboardingData;
    const id = (data as any)._id?.toString();
    if (!id) return data as T;

    const progressKey = `${REDIS_KEYS.CUSTOMER_ONBOARDING_PROGRESS}${id}`;
    try {
      if ((data as any).onboardingStatus === CreditStatus.APPROVED) {
        await redisClient.del(progressKey);
        return data as T;
      }
      const progress = await this.loadOnboardingProgress(progressKey);
      if (!progress) return data as T;
      return {
        ...(data as any),
        onboardingStatus: progress.completed
          ? CreditStatus.PROCESSING
          : progress.onboardingStatus,
        logs: progress.logs,
        ...(progress.outputs || {}),
      } as T;
    } catch (error: any) {
      Logger.warn(
        `Could not read live onboarding progress for ${id}: ${
          error?.message || error
        }`,
        'CustomerOnboardingService',
      );
      return data as T;
    }
  }

  private async notifySuperAdminsOnOnboardingFailure(
    onboardingData: CustomerOnboarding,
    failedStep: string,
    failureReason: string,
  ) {
    try {
      const admins = await this.userRepository.find({
        role: UserRole.SUPER_ADMIN,
      });
      const emails = admins.map((admin) => admin.email).filter(Boolean);
      if (!emails.length) {
        Logger.warn(
          'Onboarding failed but no super admin email addresses were found',
          'CustomerOnboardingService',
        );
        return;
      }

      const details =
        typeof (onboardingData as any).toObject === 'function'
          ? (onboardingData as any).toObject()
          : { ...(onboardingData as any) };
      const message = getOnboardingFailureNotificationMail(
        details,
        failedStep,
        failureReason,
      );
      await this.sendOnboardingRequestMailToSuperAdmin(
        message,
        emails,
        `L1 Support Required: Customer Onboarding Failed at ${failedStep.replace(
          /_/g,
          ' ',
        )}`,
      );
      Logger.log(
        `Onboarding failure notification queued for ${emails.length} super admin(s)`,
        'CustomerOnboardingService',
      );
    } catch (error: any) {
      // Keep notification errors from masking the original onboarding failure.
      Logger.error(
        `Could not queue onboarding failure notification: ${
          error?.message || error
        }`,
        error?.stack,
        'CustomerOnboardingService',
      );
    }
  }

  /**
   * Merges existing logs with new logs, maintaining chronological order and deduplication
   * @param existing - Array of existing log details
   * @param newOnes - Array of new log details to be merged
   * @returns Combined and sorted array of unique log details
   */
  private mergeLogs(existing: LogDetail[], newOnes: LogDetail[]): LogDetail[] {
    Logger.log('Inside mergeLogs()', 'CustomerOnboardingService');

    const map = new Map<string, LogDetail>();
    for (const log of existing) map.set(log.step, log);
    for (const log of newOnes) map.set(log.step, log);
    return Array.from(map.values()).sort(
      (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime(),
    );
  }

  private isLatestStepFailure(
    logs: LogDetail[],
    step: OnboardingStep,
  ): boolean {
    return (
      [...logs].reverse().find((log) => log.step === step)?.status ===
      StepStatus.FAILED
    );
  }

  /**
   * Logs a successful step completion in the onboarding process
   * @param logs - Array of log details to append to
   * @param step - The onboarding step that was completed successfully
   */
  private logStepSuccess(logs: LogDetail[], step: OnboardingStep) {
    Logger.log('Inside logStepSuccess()', 'CustomerOnboardingService');

    logs.push({ step, status: StepStatus.SUCCESS, time: new Date() });
  }

  /**
   * Logs a failed step in the onboarding process with error details
   * @param logs - Array of log details to append to
   * @param step - The onboarding step that failed
   * @param error - The error object containing failure details
   */
  private logStepFailure(logs: LogDetail[], step: OnboardingStep, error: any) {
    Logger.log('Inside logStepFailure()', 'CustomerOnboardingService');

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

  private toDashboardCompanyDetail(company: any) {
    if (!company || typeof company !== 'object') return undefined;

    const fields =
      company.fields && typeof company.fields === 'object'
        ? company.fields
        : company;
    const allowedCompanyFields = [
      'name',
      'domain',
      'region',
      'countryOfRegistration',
      'registrationNumber',
      'registrationNumberType',
      'taxIdType',
      'taxIdNumber',
      'address',
    ];
    const companyFields = Object.fromEntries(
      allowedCompanyFields
        .filter((key) => fields[key] !== undefined)
        .map((key) => [key, fields[key]]),
    );
    const documents = Array.isArray(company.documents) ? company.documents : [];
    const rawStatusReason = company.statusReason;
    return {
      id: company._id || company.id,
      ...companyFields,
      status: company.status,
      statusReason: Array.isArray(rawStatusReason)
        ? rawStatusReason.map(String).join(', ')
        : rawStatusReason == null
        ? ''
        : String(rawStatusReason),
      documents,
    };
  }

  async findUserOnboardingDetail(user) {
    Logger.log(
      'Inside findUserOnboardingDetail() method start:: to get onboarding detail of particular user',
      'CustomerOnboardingService',
    );
    try {
      const userOnboardingDetail =
        await this.customerOnboardingRepository.findLatestCustomerOnboardingByUserId(
          user.userId,
        );
      if (!userOnboardingDetail) {
        throw new BadRequestException([
          `No onboarding detail found for user with id: ${user.userId}`,
        ]);
      }
      let result: Record<string, any> =
        typeof userOnboardingDetail.toObject === 'function'
          ? userOnboardingDetail.toObject()
          : { ...userOnboardingDetail };
      if (
        result.companyId &&
        result.companyVerificationStatus !== KybVerificationEnum.Approved &&
        result.companyVerificationStatus !== KybVerificationEnum.Completed
      ) {
        const kybAppId =
          result.companyIDPAppId ||
          this.config.get<string>('KYB_APP_ID')?.trim();
        const cavachApiDomain = this.config
          .get<string>('CAVACH_API_DOMAIN')
          ?.trim();
        if (!kybAppId || !cavachApiDomain) {
          throw new InternalServerErrorException(
            'KYB_APP_ID and CAVACH_API_DOMAIN must be configured',
          );
        }

        const kybApp = await this.appAuthRepository.findOne({
          appId: kybAppId,
        });
        if (
          !kybApp ||
          !kybApp.services?.some(
            (service) => service.id === SERVICE_TYPES.CAVACH_API,
          )
        ) {
          throw new BadRequestException(['Configured KYB app was not found']);
        }

        const kybAccessToken = await this.createConfiguredServiceToken(
          kybApp,
          GRANT_TYPES.access_service_kyb,
          SERVICE_TYPES.CAVACH_API,
        );
        const companyResult = await this.makeExternalRequest(
          `${sanitizeUrl(cavachApiDomain, true)}${
            SERVICE_ENDPOINTS.ID_KYB_COMPANY_VERIFICATION
          }/${encodeURIComponent(result.companyId)}`,
          {
            method: 'GET',
            headers: {
              'x-kyb-access-token': kybAccessToken,
              Origin: sanitizeUrl(
                this.config.get<string>(
                  'DEVELOPER_DASHBOARD_SERVICE_PUBLIC_EP',
                ),
                false,
              ),
            },
          },
          'Failed to refresh the KYB company verification status',
          true,
        );

        const companyData = companyResult?.data || companyResult;
        const companyDetail = this.toDashboardCompanyDetail(companyData);
        result = {
          ...result,
          companyDetail,
        };
      }

      return this.withLiveOnboardingProgress(result);
    } catch (e: any) {
      Logger.error(
        'Issue while fetching userOnboardingDetail',
        e,
        'CustomerOnboardingService',
      );
      if (e instanceof HttpException) throw e;
      throw new BadRequestException([e.message]);
    }
  }

  async notifyAdminOnOnboardingRetry(
    createCustomerOnboardingDto: CreateCustomerOnboardingDto,
    userId,
  ) {
    Logger.log(
      'Inside notifyAdminOnOnboardingRetry() method to notify super admin about retry',
      'CustomerOnboardingService',
    );
    const customerOnboardingData =
      await this.customerOnboardingRepository.findLatestCustomerOnboardingByUserId(
        userId,
      );
    if (!customerOnboardingData) {
      throw new BadRequestException([
        `No customer onboarding detail found for userId: ${userId}`,
      ]);
    }
    if (customerOnboardingData.onboardingStatus === CreditStatus.APPROVED) {
      throw new BadRequestException(['Customer onboarding is already done']);
    }
    const failedLogs =
      customerOnboardingData.onboardingStatus === CreditStatus.FAILED
        ? customerOnboardingData.logs.filter(
            (log) => log.status === StepStatus.FAILED,
          )
        : [];
    const failedStep = failedLogs[0]?.step || 'Unknown step';
    const failureReason =
      failedLogs[0]?.failureReason || 'Failure reason not recorded';
    const message = getOnboardingRetryNotificationMail(
      userId,
      createCustomerOnboardingDto.customerEmail,
      failedStep,
      failureReason,
      customerOnboardingData._id.toString(),
    );
    const superAdminDetails = await this.userRepository.find({
      role: UserRole.SUPER_ADMIN,
    });
    const superAdminEmails = superAdminDetails?.map((admin) => admin.email);
    const subject = 'Re-Onboarding Request Received';
    await this.sendOnboardingRequestMailToSuperAdmin(
      message,
      superAdminEmails,
      subject,
    );
    Logger.log(
      `Re-onboarding notification sent to ${superAdminEmails.length} super admin(s)`,
      'CustomerOnboardingService',
    );
    return customerOnboardingData;
  }
}
