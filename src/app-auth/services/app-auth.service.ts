import {
  UnauthorizedException,
  Injectable,
  NotFoundException,
  Logger,
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common';
import { SigningStargateClient } from '@cosmjs/stargate';
import { CreateAppDto, DeleteAppResponse } from '../dtos/create-app.dto';
import { App, createAppResponse } from 'src/app-auth/schemas/app.schema';
import { AppRepository } from '../repositories/app.repository';
import { UpdateAppDto } from '../dtos/update-app.dto';
import { HidWalletService } from '../../hid-wallet/services/hid-wallet.service';
import { ConfigService } from '@nestjs/config';
import { AppAuthSecretService } from './app-auth-passord.service';
import { JwtService } from '@nestjs/jwt';
import { AppAuthApiKeyService } from './app-auth-apikey.service';
import { EdvClientManagerFactoryService } from '../../edv/services/edv.clientFactory';
import { VaultWalletManager } from '../../edv/services/vaultWalletManager';
import { SupportedServiceService } from 'src/supported-service/services/supported-service.service';
import {
  APP_ENVIRONMENT,
  Context,
  SERVICE_TYPES,
} from 'src/supported-service/services/iServiceList';
import { UserRepository } from 'src/user/repository/user.repository';
import { AuthzCreditService } from 'src/credits/services/credits.service';
import { AuthZCreditsRepository } from 'src/credits/repositories/authz.repository';
import { EdvClientKeysManager } from 'src/edv/services/edv.singleton';
import { UserRole } from 'src/user/schema/user.schema';
import { WebPageConfigRepository } from 'src/webpage-config/repositories/webpage-config.repository';
import { InjectModel } from '@nestjs/mongoose';
import { CustomerOnboarding } from 'src/customer-onboarding/schemas/customer-onboarding.schema';
import { Model } from 'mongoose';
import {
  DNS_RESOLVER_URL,
  evaluateAccessPolicy,
  generateHash,
  getAccessListForModule,
} from 'src/utils/utils';
import { TokenModule } from 'src/config/access-matrix';
import { redisClient } from 'src/utils/redis.provider';
import {
  EXPIRY_CONFIG,
  getSecondsFromUnit,
  TIME_UNIT,
} from 'src/utils/time-constant';

export enum GRANT_TYPES {
  access_service_kyc = 'access_service_kyc',
  access_service_ssi = 'access_service_ssi',
  access_service_quest = 'access_service_quest',
  access_service_kyb = 'access_service_kyb',
}

@Injectable()
export class AppAuthService {
  private authzWalletInstance;
  private granterClient: SigningStargateClient;
  constructor(
    private readonly config: ConfigService,
    private readonly appRepository: AppRepository,
    private readonly hidWalletService: HidWalletService,
    private readonly appAuthSecretService: AppAuthSecretService,
    private readonly jwt: JwtService,
    private readonly appAuthApiKeyService: AppAuthApiKeyService,
    private readonly supportedServices: SupportedServiceService,
    private readonly userRepository: UserRepository,
    private readonly authzCreditService: AuthzCreditService,
    private readonly authzCreditRepository: AuthZCreditsRepository,
    @InjectModel(CustomerOnboarding.name)
    private readonly onboardModel: Model<CustomerOnboarding>,
    private readonly webpageConfigRepo: WebPageConfigRepository,
  ) {}

  async createAnApp(
    createAppDto: CreateAppDto,
    userId: string,
  ): Promise<createAppResponse> {
    Logger.log('createAnApp() method: starts....', 'AppAuthService');
    const { serviceIds } = createAppDto;
    if (!serviceIds) {
      throw new Error('No serviceIds provided while creating an app');
    }

    // Env restrictions
    createAppDto.hasDomainVerified = false;
    createAppDto.env = APP_ENVIRONMENT.dev;

    const service = this.supportedServices.fetchServiceById(serviceIds[0]);
    if (!service) {
      throw new Error('Invalid service ID: ' + serviceIds[0]);
    }

    if (!this.authzWalletInstance) {
      this.authzWalletInstance = await this.hidWalletService.generateWallet(
        this.config.get('MNEMONIC'),
      );
    }

    if (!this.granterClient) {
      this.granterClient = await SigningStargateClient.connectWithSigner(
        this.config.get('HID_NETWORK_RPC'),
        this.authzWalletInstance.wallet,
      );
    }
    const { mnemonic, address } = await this.hidWalletService.generateWallet();
    const appId = await this.appAuthApiKeyService.generateAppId();

    let subdomain;
    let edvId;
    let kmsId;
    if (service.id !== SERVICE_TYPES.QUEST) {
      const vaultPrefixInEnv = this.config.get('VAULT_PREFIX');
      const vaultPrefix = vaultPrefixInEnv
        ? vaultPrefixInEnv
        : 'hs:studio-api:';
      edvId = vaultPrefix + 'app:' + appId;

      Logger.log(
        'createAnApp() method: initialising edv service',
        'AppAuthService',
      );

      // Store menemonic and edvId in the key manager vault and get the kmsId.
      const doc = {
        mnemonic,
        edvId: edvId,
      };
      Logger.log(
        'createAnApp() method: Prepareing app keys to insert in kms vault',
      );

      if (!globalThis.kmsVault) {
        throw new InternalServerErrorException([
          'KMS vault is not initialized.',
        ]);
      }
      const edvDocToInsert = globalThis.kmsVault.prepareEdvDocument(doc, [
        { index: 'content.edvId', unique: true },
      ]);

      Logger.log(
        'createAnApp() method: Inserting app keys to insert in kms vault',
      );
      const { id } = await globalThis.kmsVault.insertDocument(edvDocToInsert);
      kmsId = id;

      Logger.log('createAnApp() method: Preparing wallet for the app');
      // TODO generate vault for this app.
      const appVaultWallet = await VaultWalletManager.getWallet(mnemonic);
      // we do not need to storing anything in the app's vault, we just create a vault for this guy
      Logger.log('createAnApp() method: Creating vault for the app');
      await EdvClientManagerFactoryService.createEdvClientManger(
        appVaultWallet,
        edvId,
      );
      subdomain = await this.getRandomSubdomain();
    }
    // TODO use mnemonic as a seed to generate API keys
    Logger.log('createAnApp() method: generating api key', 'AppAuthService');
    const { apiSecretKey, apiSecret } =
      await this.appAuthApiKeyService.generateApiKey();
    Logger.log(
      'createAnApp() method: before creating new app doc in db',
      'AppAuthService',
    );

    // Finally stroring application in db
    // const txns = {
    //   transactionHash: '',
    // };
    const appData: App = await this.appRepository.create({
      ...createAppDto,
      services: [service],
      authzTxnHash: '',
      userId,
      appId: appId, // generate app id
      apiKeySecret: apiSecret, // TODO: generate app secret and should be handled like password by hashing and all...
      edvId, // generate edvId  by called hypersign edv service
      kmsId: kmsId,
      walletAddress: address,
      apiKeyPrefix: apiSecretKey.split('.')[0],
      subdomain,
      env: createAppDto.env ? createAppDto.env : APP_ENVIRONMENT.dev,
      issuerDid: createAppDto.issuerDid,
      domain: createAppDto.domain,
      hasDomainVerified: createAppDto.hasDomainVerified,
    });
    Logger.log('App created successfully', 'app-auth-service');
    const appResponse = this.getAppResponse(appData, apiSecretKey);
    if (service.id == SERVICE_TYPES.CAVACH_API) {
      this.authzCreditService.grantCavachCredit(
        subdomain,
        appId,
        createAppDto.env ? createAppDto.env : APP_ENVIRONMENT.dev,
        appResponse.tenantUrl,
      );
    }
    return appResponse;
  }

  private getAppResponse(
    appData: App,
    apiSecretKey?: string,
  ): createAppResponse {
    const appResponse: createAppResponse = {
      ...appData['_doc'],
      apiSecretKey,
      tenantUrl: appData?.services[0].domain,
    };

    delete appResponse.userId;
    delete appResponse['_id'];
    delete appResponse['__v'];
    delete appResponse['apiKeySecret'];
    delete appResponse['apiKeyPrefix'];
    return appResponse;
  }

  // fix the type for service
  private async getRandomSubdomain() {
    const subdomain = await this.appAuthApiKeyService.generateAppId(7);
    const appInDb = await this.appRepository.findOne({
      subdomain: subdomain,
    });

    if (!appInDb) {
      Logger.log('Found subdomain in db, going recursively');
      const tenantSubDomainPrefixEnv = this.config.get(
        'TENANT_SUBDOMAIN_PREFIX',
      );
      return (
        (tenantSubDomainPrefixEnv && tenantSubDomainPrefixEnv != 'undefined'
          ? tenantSubDomainPrefixEnv
          : 'ent-') + subdomain
      );
    }

    await this.getRandomSubdomain();
  }

  async reGenerateAppSecretKey(app, userId) {
    Logger.log('reGenerateAppSecretKey() method: starts....');

    Logger.log(
      'reGenerateAppSecretKey() method: generating api key',
      'AppAuthService',
    );

    const { apiSecretKey, apiSecret } =
      await this.appAuthApiKeyService.generateApiKey();
    Logger.log(
      'reGenerateAppSecretKey() method: before calling app repository to updating app detail in db',
      'AppAuthService',
    );

    await this.appRepository.findOneAndUpdate(
      { appId: app.appId, userId },
      {
        apiKeyPrefix: apiSecretKey.split('.')[0],
        apiKeySecret: apiSecret,
      },
    );

    return { apiSecretKey };
  }

  async getAllApps(userId: string, paginationOption, userRole) {
    Logger.log('getAllApps() method: starts....', 'AppAuthService');

    const skip = (paginationOption.page - 1) * paginationOption.limit;
    paginationOption.skip = skip;
    Logger.log(
      'getAllApps() method: before calling app repository to fetch app details',
      'AppAuthService',
    );
    let app;
    if (userRole === UserRole.SUPER_ADMIN) {
      app = await this.appRepository.find({
        paginationOption,
        userId,
      });
    } else {
      const basePipeline = this.appRepository.appDataProjectPipelineToReturn();
      const pipeline = [
        {
          $match: { userId },
        },

        {
          $facet: {
            cavachApp: [
              {
                $match: {
                  services: {
                    $elemMatch: { id: SERVICE_TYPES.CAVACH_API },
                  },
                },
              },
              { $sort: { _id: -1 } },
              { $limit: 1 },
              { $project: basePipeline },
            ],

            dependentApps: [{ $project: basePipeline }],
            totalCount: [{ $count: 'total' }],
          },
        },

        {
          $unwind: {
            path: '$cavachApp',
            preserveNullAndEmptyArrays: true,
          },
        },

        {
          $project: {
            totalCount: {
              $ifNull: [{ $arrayElemAt: ['$totalCount.total', 0] }, 0],
            },

            data: {
              $cond: [
                { $ifNull: ['$cavachApp', false] },
                {
                  $concatArrays: [
                    ['$cavachApp'],
                    {
                      $filter: {
                        input: { $ifNull: ['$dependentApps', []] },
                        as: 'app',
                        cond: {
                          $in: [
                            '$$app.appId',
                            { $ifNull: ['$cavachApp.dependentServices', []] },
                          ],
                        },
                      },
                    },
                  ],
                },
                {
                  $filter: {
                    input: { $ifNull: ['$dependentApps', []] },
                    as: 'app',
                    cond: {
                      $gt: [
                        {
                          $size: {
                            $filter: {
                              input: { $ifNull: ['$$app.services', []] },
                              as: 'service',
                              cond: {
                                $eq: ['$$service.id', SERVICE_TYPES.SSI_API],
                              },
                            },
                          },
                        },
                        0,
                      ],
                    },
                  },
                },
              ],
            },
          },
        },
      ];
      app = await this.appRepository.findAppsByPipeline(pipeline);
    }
    return app;
  }

  getAppsForMarketplace() {
    Logger.log('getAppsForMarketplace() method: starts....', 'AppAuthService');
    const pipeline = [
      {
        $match: {
          hasDomainVerified: true,
          env: APP_ENVIRONMENT.prod,
          'services.id': SERVICE_TYPES.CAVACH_API,
        },
      },
      {
        $project: {
          domain: 1,
          logoUrl: 1,
          domainLinkageCredentialString: 1,
          issuerDid: 1,
          appName: 1,
          appId: 1,
          description: 1,
          env: 1,
        },
      },
    ];
    return this.appRepository.findAppsByPipeline(pipeline);
  }

  async getAppById(appId: string, userId: string): Promise<any> {
    Logger.log('getAppById() method: starts....', 'AppAuthService');
    const app: App = await this.appRepository.findOne({ appId, userId });
    return app;
  }

  private async verifyDNS01(domain: URL, txt: string) {
    // Sanitize domain url: remove www. prefix and normalize
    let hostname = domain.hostname;
    if (hostname.startsWith('www.')) {
      hostname = hostname.substring(4);
    }

    const resolveDNSURL = `${DNS_RESOLVER_URL}?name=${hostname}&type=TXT`;
    Logger.debug(`Resolving DNS TXT record for domain: ${hostname}`);

    try {
      const res = await fetch(resolveDNSURL, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!res.ok) {
        return {
          verified: false,
          error: new Error(
            `DNS resolution failed with status ${res.status}. Please try again later.`,
          ),
        };
      }

      const json = await res.json();
      Logger.debug(`DNS response for ${hostname}:`, json);

      const txtRecords = json.Answer?.filter(
        (record: any) => record.type === 16,
      );
      const txtRecord = txtRecords?.find((record: any) =>
        record.data.includes(txt),
      );

      if (!txtRecord) {
        return {
          verified: false,
          error: new Error(
            `DNS TXT record "${txt}" not found for domain ${hostname}. Please ensure you have added the correct DNS record and wait for propagation.`,
          ),
        };
      }

      Logger.debug(`DNS TXT record verified successfully for ${hostname}`);
      return {
        TXT: txtRecord,
        verified: true,
      };
    } catch (error) {
      Logger.error(`Error during DNS verification: ${error.message}`);
      return {
        verified: false,
        error: new Error(
          `Failed to verify DNS TXT record: ${error.message}. Please try again later.`,
        ),
      };
    }
  }

  private async verifyDNS01Validation(domain, txtRecord) {
    // Verify DNS-01 domain validation
    // Sanitize domain: remove www., normalize protocol
    let domainUrl = domain.trim();

    // Add https:// if no protocol specified
    if (!domainUrl.includes('http://') && !domainUrl.includes('https://')) {
      domainUrl = 'https://' + domainUrl;
    }

    const urlObj = new URL(domainUrl);
    const fetchedTxtRecord = await this.verifyDNS01(urlObj, txtRecord);

    if (fetchedTxtRecord && fetchedTxtRecord.error) {
      throw new BadRequestException([
        fetchedTxtRecord.error?.message ||
          'DNS verification failed. If you have recently added the record, it may take some time to propagate. Please try again later.',
      ]);
    }

    if (fetchedTxtRecord && fetchedTxtRecord.verified) {
      return {
        verified: true,
      };
    } else {
      throw new BadRequestException([
        'Domain verification failed. Please check your DNS records and try again.',
      ]);
    }
  }

  private getDomainLinkageCredential(subject, issuer, origin) {
    // TODO: this should be properly signed and issued using SSI API.
    const now = new Date();
    return {
      '@context': [
        'https://www.w3.org/2018/credentials/v1',
        'https://identity.foundation/.well-known/did-configuration/v1',
      ],
      type: ['VerifiableCredential', 'DomainLinkageCredential'],
      credentialSubject: {
        id: subject,
        origin: origin,
      },
      issuer: issuer,
      issuanceDate: now.toISOString(),
      expirationDate: new Date(
        now.setFullYear(now.getFullYear() + 1),
      ).toISOString(),
      proof: {
        type: 'Ed25519Signature2020',
        verificationMethod: subject + '#key-1',
        signatureValue: '',
      },
    };
  }

  async updateAnApp(
    appId: string,
    updataAppDto: UpdateAppDto,
    userDetail,
    oldApp,
  ): Promise<createAppResponse> {
    Logger.log('updateAnApp() method: starts....', 'AppAuthService');

    const { env, hasDomainVerified, domain, logoUrl, issuerDid } = updataAppDto;
    const { userId } = userDetail;
    if (!oldApp) {
      throw new BadRequestException([
        'Service with given id do not exists for this user',
      ]);
    }
    Logger.debug(oldApp);
    const isEnvChanged =
      typeof updataAppDto.env !== 'undefined' &&
      updataAppDto.env !== oldApp.env;
    Logger.debug(`isEnvChanged: ${isEnvChanged}`);
    // check if hasDomainVerified is verifed by DNS-01
    // only if credential was not issued
    // this should not happen everytime we update a record, only once.
    // so better to issue verifiable credential
    if (
      env === 'prod' &&
      hasDomainVerified &&
      domain &&
      domain != '' &&
      issuerDid &&
      issuerDid != '' &&
      !oldApp.domainLinkageCredentialString
    ) {
      const txtRecord = 'hypersign-domain-verification.did=' + issuerDid;
      const fetchedTxtRecord = await this.verifyDNS01Validation(
        domain,
        txtRecord,
      );
      if (fetchedTxtRecord.verified) {
        // issue credential
        Logger.debug('Issueing credential .... ');
        updataAppDto['domainLinkageCredentialString'] = JSON.stringify(
          this.getDomainLinkageCredential(issuerDid, issuerDid, domain),
        );
      }
    }

    // we do not allow to update the domain once domain is verified
    if (hasDomainVerified && oldApp.domainLinkageCredentialString) {
      updataAppDto.domain = oldApp.domain;
    }

    // Env restrictions
    if (env === APP_ENVIRONMENT.prod) {
      if (!(domain && hasDomainVerified)) {
        throw new BadRequestException([
          'You must verify your domain before going to production',
        ]);
      }

      if (!logoUrl || logoUrl == '') {
        throw new BadRequestException([
          'Logo must be set before going to production',
        ]);
      }
    }
    const app: App = await this.appRepository.findOneAndUpdate(
      { appId, userId },
      updataAppDto,
    );
    const updatedapp = await this.getAppResponse(app);
    //update dependent service
    if (isEnvChanged && oldApp.dependentServices?.length) {
      await this.updateDependentServicesEnv(
        oldApp.dependentServices,
        updataAppDto?.env,
        userId,
      );
    }
    // update redis
    await this.updateAppRedis(appId, userId, {
      env: (updatedapp.env as APP_ENVIRONMENT) ?? APP_ENVIRONMENT.dev,
      appName: updatedapp.appName,
      whitelistedCors: updatedapp.whitelistedCors,
    });

    return updatedapp;
  }

  async deleteApp(appId: string, userId: string): Promise<DeleteAppResponse> {
    Logger.log('deleteApp() method: starts....', 'AppAuthService');

    let appDetail = await this.appRepository.findOne({ appId, userId });
    if (!appDetail) {
      Logger.error('deleteApp() method: Error: no app found', 'AppAuthService');

      throw new NotFoundException([`No App found for appId ${appId}`]);
    }
    const checkIfAppIsLinkedWithOtherApp =
      await this.appRepository.findAppsByPipeline([
        {
          $match: {
            dependentServices: appId,
          },
        },
      ]);
    if (
      checkIfAppIsLinkedWithOtherApp &&
      checkIfAppIsLinkedWithOtherApp.length > 0
    ) {
      const linkedServicesMessage = checkIfAppIsLinkedWithOtherApp
        .map(
          (service, index) =>
            `${index + 1}. ${service.appName} (${service.appId})`,
        )
        .join('\n');
      throw new BadRequestException([
        `This service is linked with the following services:\n\n${linkedServicesMessage}.\n\nPlease delink or delete the linked services before deleting the SSI service.`,
      ]);
    }
    const { edvId, kmsId } = appDetail;
    const appDataFromVault = await globalThis.kmsVault.getDecryptedDocument(
      kmsId,
    );
    if (!appDataFromVault) {
      throw new BadRequestException([
        'App detail does not exists in datavault',
      ]);
    }
    const appKmsVaultWallet = await VaultWalletManager.getWallet(
      appDataFromVault.mnemonic,
    );
    const kmsVaultManager = new EdvClientKeysManager();
    const appKmsVault = await kmsVaultManager.createVault(
      appKmsVaultWallet,
      edvId,
    );
    try {
      await appKmsVault.deleteVault(edvId);
      await globalThis.kmsVault.deleteDocument(kmsId);
    } catch (vaultError) {
      Logger.error(
        `Error deleting KMS or EDV vault: ${vaultError}`,
        'AppAuthService',
      );
      throw new BadRequestException(['Failed to delete the vault.']);
    }
    // delete app db also
    if (!appDetail.services || appDetail.services.length === 0) {
      throw new BadRequestException(['The app is invalid.']);
    }
    const appDbConnectionSuffix = `service:${appDetail.services[0].dBSuffix}:${appDetail.subdomain}`;
    await this.appRepository.findAndDeleteServiceDB(appDbConnectionSuffix);
    if (
      appDetail?.services?.length > 0 &&
      appDetail.services[0].id === SERVICE_TYPES.CAVACH_API
    ) {
      // delete onboarding data
      await this.onboardModel.deleteOne({ kycServiceId: appId });
      // delete webpage config data of that service
      await this.webpageConfigRepo.findOneAndDelete({ appId });
    }
    this.authzCreditRepository.deleteAuthzDetail({ appId });
    appDetail = await this.appRepository.findOneAndDelete({ appId, userId });
    // delete from redis
    await Promise.all([
      redisClient.del(generateHash(appId)),
      redisClient.del(generateHash(`${appId}_${Context.idDashboard}`)),
    ]);
    Logger.debug(`Redis cache cleaned for appId: ${appId}`);
    return { appId: appDetail.appId };
  }

  public checkIfDateExpired(expiryDate: Date | null) {
    if (!expiryDate) {
      // if expiryDate null, then its never expired
      return false;
    }
    const now = Date.now();
    const expiryDateTime = new Date(expiryDate);
    const expiryEpoch = expiryDateTime.getTime();
    if (now > expiryEpoch) {
      return true;
    } else {
      return false;
    }
  }

  async generateAccessToken(
    appSecreatKey: string,
    expiresin = 4,
    grantType,
  ): Promise<{ access_token; expiresIn; tokenType }> {
    Logger.log('generateAccessToken() method: starts....', 'AppAuthService');
    const apikeyIndex = appSecreatKey.split('.')[0];
    const appDetail = await this.appRepository.findOne({
      apiKeyPrefix: apikeyIndex,
    });
    if (!appDetail) {
      Logger.error(
        'generateAccessToken() method: Error: no app found',
        'AppAuthService',
      );

      throw new UnauthorizedException(['Access denied.']);
    }
    const userDetails = await this.userRepository.findOne({
      userId: appDetail.userId,
    });
    if (!userDetails) {
      throw new UnauthorizedException([
        'Admin user not found. He/She might have delete the account or never created one',
      ]);
    }

    const compareHash = await this.appAuthSecretService.comapareSecret(
      appSecreatKey,
      appDetail.apiKeySecret,
    );

    if (!compareHash) {
      Logger.error(
        'generateAccessToken() method: Error: hashMismatch',
        'AppAuthService',
      );

      throw new UnauthorizedException(['Access denied.']);
    }

    const serviceType = appDetail.services[0]?.id; // TODO: remove this later
    let grant_type = '';
    let accessList = [];
    const key =
      grantType === 'access_service_kyb'
        ? `${appDetail.appId}_${Context.customer}_${grantType}`
        : `${appDetail.appId}_${Context.customer}`;
    const redisKey = generateHash(key);
    const savedSession = await redisClient.get(redisKey);
    if (savedSession) {
      Logger.log('Using redis cached session', 'AppAuthService');
      const sessionJson = JSON.parse(savedSession);
      const jwtPayload = {
        appId: sessionJson.appId,
        appName: sessionJson.appName,
        grantType: grantType || sessionJson.grantType,
        subdomain: sessionJson.subdomain,
        sessionId: redisKey,
      };
      return this.getAccessToken(jwtPayload, expiresin);
    }
    switch (serviceType) {
      case SERVICE_TYPES.SSI_API: {
        grant_type = GRANT_TYPES.access_service_ssi;
        const defaultAccessList = getAccessListForModule(
          TokenModule.APP_AUTH,
          SERVICE_TYPES.SSI_API,
        );
        accessList = evaluateAccessPolicy(
          defaultAccessList,
          SERVICE_TYPES.SSI_API,
          [],
        );
        break;
      }
      case SERVICE_TYPES.CAVACH_API: {
        if (
          grantType &&
          grantType !== GRANT_TYPES.access_service_kyc &&
          grantType !== GRANT_TYPES.access_service_kyb
        ) {
          throw new BadRequestException([
            'Choose access_service_kyc or access_service_kyb for Cavach service',
          ]);
        }
        grant_type = grantType || GRANT_TYPES.access_service_kyc;
        const defaultAccessList = getAccessListForModule(
          TokenModule.APP_AUTH,
          SERVICE_TYPES.CAVACH_API,
        );
        accessList = evaluateAccessPolicy(
          defaultAccessList,
          SERVICE_TYPES.CAVACH_API,
          [],
        );
        break;
      }
      case SERVICE_TYPES.QUEST: {
        grant_type = GRANT_TYPES.access_service_quest;
        const defaultAccessList = getAccessListForModule(
          TokenModule.APP_AUTH,
          SERVICE_TYPES.QUEST,
        );
        accessList = evaluateAccessPolicy(
          defaultAccessList,
          SERVICE_TYPES.QUEST,
          [],
        );
        break;
      }
      default: {
        throw new BadRequestException([
          'Invalid service ID: ' + appDetail.appId,
        ]);
      }
    }

    if (accessList.length <= 0) {
      throw new UnauthorizedException([
        `You are not authorized to access service of type ${serviceType}`,
      ]);
    }
    const jwtPayload = {
      appId: appDetail.appId,
      appName: appDetail.appName,
      grantType: grant_type,
      subdomain: appDetail.subdomain,
      sessionId: redisKey,
    };
    await this.storeDataInRedis(grant_type, appDetail, accessList, redisKey);
    return this.getAccessToken(jwtPayload, expiresin);
  }

  public async getAccessToken(
    data,
    time = 4,
    unit: TIME_UNIT = TIME_UNIT.HOUR,
  ) {
    const secret = this.config.get('JWT_SECRET');
    const token = await this.jwt.signAsync(data, {
      expiresIn: `${time}${unit}`,
      secret,
    });
    const expiresIn = getSecondsFromUnit(time, unit);
    Logger.log('generateAccessToken() method: ends....', 'AppAuthService');

    return { access_token: token, expiresIn, tokenType: 'Bearer' };
  }
  public async storeDataInRedis(
    grantType,
    appDetail,
    accessList = [],
    sessionId,
  ) {
    const payload = {
      appId: appDetail.appId,
      userId: appDetail.userId,
      grantType,
      kmsId: appDetail.kmsId,
      whitelistedCors: appDetail.whitelistedCors,
      subdomain: appDetail.subdomain,
      edvId: appDetail.edvId,
      accessList,
      env: appDetail.env ? appDetail.env : APP_ENVIRONMENT.dev,
      appName: appDetail.appName,
    };
    if (appDetail.issuerDid) {
      payload['issuerDid'] = appDetail.issuerDid;
    }
    if (appDetail.issuerVerificationMethodId) {
      payload['issuerVerificationMethodId'] =
        appDetail.issuerVerificationMethodId;
    }

    if (
      appDetail.dependentServices &&
      appDetail.dependentServices.length > 0 &&
      appDetail.dependentServices[0]
    ) {
      payload['dependentServices'] = appDetail.dependentServices;
    }
    Logger.log('storeDataInRedis() method: ends....', 'AppAuthService');
    redisClient.set(
      sessionId,
      JSON.stringify(payload),
      'EX',
      EXPIRY_CONFIG.DASHBOARD_ACCESS.redisExpiryTime,
    );
  }

  async grantPermission(
    grantType: string,
    appId: string,
    user,
    session?,
  ): Promise<{ access_token; expiresIn; tokenType }> {
    const context = Context.idDashboard;
    let rawRedisKey = `${appId}_${context}_${session.userId}`;
    if (session && session.tenantId) {
      rawRedisKey = `${rawRedisKey}_tenant`;
    }
    const sessionId = generateHash(rawRedisKey);
    const savedSession = await redisClient.get(sessionId);
    switch (grantType) {
      case GRANT_TYPES.access_service_ssi:
        break;
      case GRANT_TYPES.access_service_kyc:
        break;
      case GRANT_TYPES.access_service_kyb:
        break;
      case GRANT_TYPES.access_service_quest:
        break;
      default: {
        throw new BadRequestException([
          'Grant type not supported, supported grant types are: ' +
            GRANT_TYPES.access_service_kyc +
            ',' +
            GRANT_TYPES.access_service_ssi,
        ]);
      }
    }

    if (savedSession) {
      const app = JSON.parse(savedSession);
      const dataToStore = {
        appId,
        appName: app.appName,
        grantType,
        subdomain: app.subdomain,
        sessionId,
      };
      return this.getAccessToken(
        dataToStore,
        EXPIRY_CONFIG.DASHBOARD_ACCESS.jwtTime,
        EXPIRY_CONFIG.DASHBOARD_ACCESS.jwtUnit,
      );
    }
    const query: any = {
      appId,
      ...(user?.role !== UserRole.SUPER_ADMIN && { userId: user.userId }),
    };
    const app = await this.appRepository.findOne(query);
    if (!app) {
      throw new BadRequestException([
        'Invalid service ID or you do not have access to this service',
      ]);
    }
    const userDetails = user;
    if (!userDetails) {
      throw new UnauthorizedException([
        'You do not have access to this service',
      ]);
    }

    const serviceType = app.services[0]?.id; // TODO: remove this later
    let accessList = [];
    switch (serviceType) {
      case SERVICE_TYPES.SSI_API: {
        if (grantType != 'access_service_ssi') {
          throw new BadRequestException([
            'Invalid grant type for this service ' + appId,
          ]);
        }
        const defaultAccessList = getAccessListForModule(
          TokenModule.DASHBOARD,
          SERVICE_TYPES.SSI_API,
        );
        accessList = evaluateAccessPolicy(
          defaultAccessList,
          SERVICE_TYPES.SSI_API,
          user.accessList,
          context,
        );
        break;
      }
      case SERVICE_TYPES.CAVACH_API: {
        if (
          grantType != GRANT_TYPES.access_service_kyc &&
          grantType != GRANT_TYPES.access_service_kyb
        ) {
          throw new BadRequestException([
            'Invalid grant type for this service ' + appId,
          ]);
        }
        const defaultAccessList = getAccessListForModule(
          TokenModule.DASHBOARD,
          SERVICE_TYPES.CAVACH_API,
        );
        accessList = evaluateAccessPolicy(
          defaultAccessList,
          SERVICE_TYPES.CAVACH_API,
          user.accessList,
          context,
        );
        break;
      }
      case SERVICE_TYPES.QUEST: {
        if (grantType != 'access_service_quest') {
          throw new BadRequestException([
            'Invalid grant type for this service ' + appId,
          ]);
        }
        const defaultAccessList = getAccessListForModule(
          TokenModule.DASHBOARD,
          SERVICE_TYPES.QUEST,
        );
        accessList = evaluateAccessPolicy(
          defaultAccessList,
          SERVICE_TYPES.QUEST,
          user.accessList,
          context,
        );
        break;
      }
      default: {
        throw new BadRequestException(['Invalid service ID: ' + appId]);
      }
    }
    if (accessList.length <= 0) {
      throw new UnauthorizedException([
        `You are not authorized to access service of type ${serviceType}`,
      ]);
    }
    const tokenPayload = {
      appId,
      appName: app.appName,
      grantType,
      subdomain: app.subdomain,
      sessionId,
    };
    await this.storeDataInRedis(grantType, app, accessList, sessionId);
    return this.getAccessToken(
      tokenPayload,
      EXPIRY_CONFIG.DASHBOARD_ACCESS.jwtTime,
      EXPIRY_CONFIG.DASHBOARD_ACCESS.jwtUnit,
    );
  }

  private async updateDependentServicesEnv(
    dependentServiceIds: string[],
    env: APP_ENVIRONMENT | undefined,
    userId: string,
  ) {
    Logger.debug(
      'Inside updateDependentServicesEnv(): Updating dependent services env...',
    );
    if (!env || !dependentServiceIds?.length) return;
    // Update DB
    await this.appRepository.findOneAndUpdate(
      {
        appId: { $in: dependentServiceIds },
        userId,
      },
      { env },
    );

    // Update Redis
    await Promise.all(
      dependentServiceIds.map((serviceId) =>
        this.updateAppRedis(serviceId, userId, { env }),
      ),
    );
  }
  private async updateAppRedis(
    appId: string,
    userId,
    updatedFields: Partial<{
      env: APP_ENVIRONMENT;
      appName: string;
      whitelistedCors: string[];
    }>,
  ) {
    Logger.debug('Inside updateAppRedis(): Updating app redis cache...');
    const baseKey = generateHash(appId);
    const dashboardRedisKey = generateHash(
      `${appId}_${Context.idDashboard}_${userId}`,
    );
    const customerContextCacheKey = generateHash(
      `${appId}_${Context.customer}`,
    );
    const customerContextCacheKybKey = generateHash(
      `${appId}_${Context.customer}_${GRANT_TYPES.access_service_kyb}`,
    );
    let customerKybTokenDataString;
    if (customerContextCacheKybKey) {
      customerKybTokenDataString = await redisClient.get(
        customerContextCacheKybKey,
      );
    }

    const [baseDataString, dashboardDataString, customerContextDataString] =
      await Promise.all([
        redisClient.get(baseKey),
        redisClient.get(dashboardRedisKey),
        redisClient.get(customerContextCacheKey),
      ]);

    const updates: Promise<any>[] = [];

    if (baseDataString) {
      const baseData = JSON.parse(baseDataString);
      updates.push(
        redisClient.set(
          baseKey,
          JSON.stringify({ ...baseData, ...updatedFields }),
          'KEEPTTL',
        ),
      );
    }

    if (dashboardDataString) {
      const dashboardData = JSON.parse(dashboardDataString);
      updates.push(
        redisClient.set(
          dashboardRedisKey,
          JSON.stringify({ ...dashboardData, ...updatedFields }),
          'KEEPTTL',
        ),
      );
    }
    if (customerContextDataString) {
      const customerContextData = JSON.parse(customerContextDataString);
      updates.push(
        redisClient.set(
          customerContextCacheKey,
          JSON.stringify({ ...customerContextData, ...updatedFields }),
          'KEEPTTL',
        ),
      );
    }
    if (customerKybTokenDataString) {
      const customerContextKybData = JSON.parse(customerKybTokenDataString);
      updates.push(
        redisClient.set(
          customerContextCacheKybKey,
          JSON.stringify({ ...customerContextKybData, ...updatedFields }),
          'KEEPTTL',
        ),
      );
    }
    const verifierKybKey = generateHash(
      `${appId}_${GRANT_TYPES.access_service_kyb}`,
    );
    const verifierKybTokenDataString = await redisClient.get(verifierKybKey);
    if (verifierKybTokenDataString) {
      const verifierKybData = JSON.parse(verifierKybTokenDataString);
      updates.push(
        redisClient.set(
          verifierKybKey,
          JSON.stringify({ ...verifierKybData, ...updatedFields }),
          'KEEPTTL',
        ),
      );
    }
    if (updates.length) {
      await Promise.all(updates);
    }
  }
}
