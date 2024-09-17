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
import * as url from 'url';
import { SupportedServiceService } from 'src/supported-service/services/supported-service.service';
import {
  APP_ENVIRONMENT,
  SERVICE_TYPES,
} from 'src/supported-service/services/iServiceList';
import { UserRepository } from 'src/user/repository/user.repository';
import {
  generateAuthzGrantTxnMessage,
  generatePerformFeegrantAllowanceTxn,
  MSG_CREATE_DID_TYPEURL,
  MSG_REGISTER_CREDENTIAL_SCHEMA,
  MSG_REGISTER_CREDENTIAL_STATUS,
  MSG_UPDATE_CREDENTIAL_STATUS,
  MSG_UPDATE_DID_TYPEURL,
} from 'src/utils/authz';
import { AuthzCreditService } from 'src/credits/services/credits.service';
import { AuthZCreditsRepository } from 'src/credits/repositories/authz.repository';
import { EdvClientKeysManager } from 'src/edv/services/edv.singleton';

enum GRANT_TYPES {
  access_service_kyc = 'access_service_kyc',
  access_service_ssi = 'access_service_ssi',
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
      throw new Error('Invalid service id ' + serviceIds[0]);
    }

    if (!this.authzWalletInstance) {
      this.authzWalletInstance = await this.hidWalletService.generateWallet(
        this.config.get('MNEMONIC'),
      );
    }

    if (!this.granterClient) {
      console.log(
        this.config.get('HID_NETWORK_RPC'),
        this.authzWalletInstance.wallet,
      );

      this.granterClient = await SigningStargateClient.connectWithSigner(
        this.config.get('HID_NETWORK_RPC'),
        this.authzWalletInstance.wallet,
      );
    }

    const { mnemonic, address } = await this.hidWalletService.generateWallet();
    const appId = await this.appAuthApiKeyService.generateAppId();

    const vaultPrefixInEnv = this.config.get('VAULT_PREFIX');
    const vaultPrefix = vaultPrefixInEnv ? vaultPrefixInEnv : 'hs:studio-api:';
    const edvId = vaultPrefix + 'app:' + appId;

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
      throw new InternalServerErrorException('KMS vault is not initialized');
    }

    const edvDocToInsert = globalThis.kmsVault.prepareEdvDocument(doc, [
      { index: 'content.edvId', unique: true },
    ]);

    Logger.log(
      'createAnApp() method: Inserting app keys to insert in kms vault',
    );
    const { id: kmsId } = await globalThis.kmsVault.insertDocument(
      edvDocToInsert,
    );

    // TODO use mnemonic as a seed to generate API keys
    Logger.log('createAnApp() method: generating api key', 'AppAuthService');
    const { apiSecretKey, apiSecret } =
      await this.appAuthApiKeyService.generateApiKey();

    Logger.log('createAnApp() method: Preparing wallet for the app');
    // TODO generate vault for this app.
    const appVaultWallet = await VaultWalletManager.getWallet(mnemonic);
    // we do not need to storing anything in the app's vault, we just create a vault for this guy
    Logger.log('createAnApp() method: Creating vault for the app');
    await EdvClientManagerFactoryService.createEdvClientManger(
      appVaultWallet,
      edvId,
    );

    Logger.log(
      'createAnApp() method: before creating new app doc in db',
      'AppAuthService',
    );
    const subdomain = await this.getRandomSubdomain();
    // AUTHZ
    if (service.id == SERVICE_TYPES.SSI_API) {
      // Perform AuthZ Grant
      const authGrantTxnMsgAndFeeDID = await generateAuthzGrantTxnMessage(
        address,
        this.authzWalletInstance.address,
        MSG_CREATE_DID_TYPEURL,
      );
      const authGrantTxnMsgAndFeeDIDUpdate = await generateAuthzGrantTxnMessage(
        address,
        this.authzWalletInstance.address,
        MSG_UPDATE_DID_TYPEURL,
      );
      const authGrantTxnMsgAndFeeUpdateCredStatus =
        await generateAuthzGrantTxnMessage(
          address,
          this.authzWalletInstance.address,
          MSG_UPDATE_CREDENTIAL_STATUS,
        );

      const authGrantTxnMsgAndFeeSchema = await generateAuthzGrantTxnMessage(
        address,
        this.authzWalletInstance.address,
        MSG_REGISTER_CREDENTIAL_SCHEMA,
      );
      const authGrantTxnMsgAndFeeCred = await generateAuthzGrantTxnMessage(
        address,
        this.authzWalletInstance.address,
        MSG_REGISTER_CREDENTIAL_STATUS,
      );
      // Perform FeeGrant Allowence
      const performFeegrantAllowence =
        await generatePerformFeegrantAllowanceTxn(
          address,
          this.authzWalletInstance.address,
          this.config.get('BASIC_ALLOWANCE') || '5000000uhid',
        );
      await this.granterClient.signAndBroadcast(
        this.authzWalletInstance.address,
        [
          authGrantTxnMsgAndFeeDIDUpdate.txMsg,
          authGrantTxnMsgAndFeeDID.txMsg,
          authGrantTxnMsgAndFeeCred.txMsg,
          authGrantTxnMsgAndFeeSchema.txMsg,
          performFeegrantAllowence.txMsg,
          authGrantTxnMsgAndFeeUpdateCredStatus.txMsg,
        ],
        authGrantTxnMsgAndFeeDID.fee,
      );
      await this.authzCreditService.createAuthzCredits({
        userId,
        appId,
      });
    }

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
      tenantUrl: this.getTenantUrl(appData.subdomain, appData.services[0]), // only one service per app
    };

    delete appResponse.userId;
    delete appResponse['_id'];
    delete appResponse['__v'];
    delete appResponse['apiKeySecret'];
    delete appResponse['apiKeyPrefix'];
    return appResponse;
  }

  // fix the type for service
  private getTenantUrl(subdomain: string, service: object) {
    Logger.log('Inside getTenantUrl()', 'app-auth.service');
    const domain = this.supportedServices.fetchServiceById(
      service['id'],
    )?.domain;
    Logger.log(domain, 'app-auth.service');

    const SERVICE_BASE_URL = url.parse(domain);

    const tenantUrl =
      SERVICE_BASE_URL.protocol +
      '//' +
      subdomain +
      '.' +
      SERVICE_BASE_URL.host +
      SERVICE_BASE_URL.pathname;
    return tenantUrl;
  }

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

  getAllApps(userId: string, paginationOption) {
    Logger.log('getAllApps() method: starts....', 'AppAuthService');

    const skip = (paginationOption.page - 1) * paginationOption.limit;
    paginationOption.skip = skip;
    Logger.log(
      'getAllApps() method: before calling app repository to fetch app details',
      'AppAuthService',
    );

    return this.appRepository.find({
      userId,
      paginationOption,
    });
  }

  getAppsForMarketplace() {
    Logger.log('getAppsForMarketplace() method: starts....', 'AppAuthService');
    const pipeline = [
      {
        $match: {
          hasDomainVerified: true,
          env: APP_ENVIRONMENT.prod,
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
    const resolveDNSURL = `https://dns.google/resolve?name=${
      new URL(domain).host
    }&type=TXT`;
    const actuaTxt = txt;
    const res = await fetch(resolveDNSURL, {
      headers: {
        'Content-Type': 'Application/json',
      },
    });

    const json = await res.json();
    const txtRecords = json.Answer.filter((record: any) => record.type === 16);
    const txtRecord = txtRecords.find((record: any) =>
      record.data.includes(txt),
    );
    if (!txtRecord) {
      return {
        verified: false,
        error: new Error('DNS TXT record not found'),
      };
    }
    if (txtRecord.data !== actuaTxt) {
      return {
        verified: false,
        error: new Error('DNS TXT record not found'),
      };
    }

    return {
      TXT: txtRecord,
      verified: true,
    };
  }

  private async verifyDNS01Validation(domain, txtRecord) {
    // verify DNS-01 domain
    // const domainLinkage = new DomainLinkage(domain);
    const d = new URL(domain.includes('http') ? domain : 'https://' + domain);
    const fetchedTxtRecord = await this.verifyDNS01(d, txtRecord);
    if (fetchedTxtRecord && fetchedTxtRecord.error) {
      throw new BadRequestException(
        fetchedTxtRecord.error?.message +
          '. If you have already added then it may take a while to complete. Please try again in sometime.',
      );
    }
    if (fetchedTxtRecord.verified) {
      return {
        verified: true,
      };
    } else {
      return {
        verified: false,
      };
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
    userId: string,
  ): Promise<createAppResponse> {
    Logger.log('updateAnApp() method: starts....', 'AppAuthService');

    const { env, hasDomainVerified, domain, logoUrl, issuerDid } = updataAppDto;
    const oldApp = await this.getAppById(appId, userId);
    if (!oldApp) {
      throw new BadRequestException(
        'Service with given id do not exists for this user',
      );
    }
    Logger.debug(oldApp);
    // check if hasDomainVerified is verifed by DNS-01
    // only if credential was not issued
    // this should not happen everytime we update a record, only once.
    // so better to issue verifiable credential
    if (
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
        throw new BadRequestException(
          'You must verify your domain before going to production',
        );
      }

      if (!logoUrl || logoUrl == '') {
        throw new BadRequestException(
          'Logo must be set before going to production',
        );
      }
    }

    const app: App = await this.appRepository.findOneAndUpdate(
      { appId, userId },
      updataAppDto,
    );
    return this.getAppResponse(app);
  }

  async deleteApp(appId: string, userId: string): Promise<DeleteAppResponse> {
    Logger.log('deleteApp() method: starts....', 'AppAuthService');

    let appDetail = await this.appRepository.findOne({ appId, userId });
    if (!appDetail) {
      Logger.error('deleteApp() method: Error: no app found', 'AppAuthService');

      throw new NotFoundException([`No App found for appId ${appId}`]);
    }
    const { edvId, kmsId } = appDetail;
    const appDataFromVault = await globalThis.kmsVault.getDecryptedDocument(
      kmsId,
    );
    if (!appDataFromVault) {
      throw new BadRequestException('App detail does not exists in datavault');
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
      throw new BadRequestException(['Failed to delete vault']);
    }
    // delete app db also
    if (!appDetail.services || appDetail.services.length === 0) {
      throw new BadRequestException(['Invalid app']);
    }
    const appDbConnectionSuffix = `service:${appDetail.services[0].dBSuffix}:${appDetail.subdomain}`;
    await this.appRepository.findAndDeleteServiceDB(appDbConnectionSuffix);
    this.authzCreditRepository.deleteAuthzDetail({ appId });
    appDetail = await this.appRepository.findOneAndDelete({ appId, userId });
    return { appId: appDetail.appId };
  }

  private checkIfDateExpired(expiryDate: Date | null) {
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

      throw new UnauthorizedException(['access_denied']);
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

      throw new UnauthorizedException('access_denied');
    }

    const serviceType = appDetail.services[0]?.id; // TODO: remove this later
    let grant_type = '';
    let accessList = [];
    switch (serviceType) {
      case SERVICE_TYPES.SSI_API: {
        grant_type = GRANT_TYPES.access_service_ssi;
        if (userDetails.accessList && userDetails.accessList.length > 0) {
          accessList = userDetails.accessList
            .map((x) => {
              if (x.serviceType === SERVICE_TYPES.SSI_API) {
                if (!this.checkIfDateExpired(x.expiryDate)) {
                  return x.access;
                }
              }
            })
            .filter((x) => x != undefined);
        }
        break;
      }
      case SERVICE_TYPES.CAVACH_API: {
        grant_type = GRANT_TYPES.access_service_kyc;
        if (userDetails.accessList && userDetails.accessList.length > 0) {
          accessList = userDetails.accessList
            .map((x) => {
              if (x.serviceType === SERVICE_TYPES.CAVACH_API) {
                if (!this.checkIfDateExpired(x.expiryDate)) {
                  return x.access;
                }
              }
            })
            .filter((x) => x != undefined);
        }
        break;
      }
      default: {
        throw new BadRequestException('Invalid service ' + appDetail.appId);
      }
    }

    if (accessList.length <= 0) {
      throw new UnauthorizedException(
        'You are not authorized to access service of type ',
        serviceType,
      );
    }

    return this.getAccessToken(grant_type, appDetail, expiresin, accessList);
  }

  private async getAccessToken(
    grantType,
    appDetail,
    expiresin = 4,
    accessList = [],
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

    if (
      appDetail.dependentServices &&
      appDetail.dependentServices.length > 0 &&
      appDetail.dependentServices[0]
    ) {
      payload['dependentServices'] = appDetail.dependentServices;
    }

    const secret = this.config.get('JWT_SECRET');
    const token = await this.jwt.signAsync(payload, {
      expiresIn: expiresin.toString() + 'h',
      secret,
    });
    const expiresIn = (4 * 1 * 60 * 60 * 1000) / 1000;
    Logger.log('generateAccessToken() method: ends....', 'AppAuthService');

    return { access_token: token, expiresIn, tokenType: 'Bearer' };
  }

  //access_service_ssi
  //access_service_kyc

  async grantPermission(
    grantType: string,
    appId: string,
    user,
  ): Promise<{ access_token; expiresIn; tokenType }> {
    switch (grantType) {
      case GRANT_TYPES.access_service_ssi:
        break;
      case GRANT_TYPES.access_service_kyc:
        break;
      default: {
        throw new BadRequestException(
          'Grant type not supported, supported grant types are: ' +
            GRANT_TYPES.access_service_kyc +
            ',' +
            GRANT_TYPES.access_service_ssi,
        );
      }
    }

    const app = await this.getAppById(appId, user.userId);
    if (!app) {
      throw new BadRequestException(
        'Invalid service id or you do not have access of this service',
      );
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
          throw new BadRequestException(
            'Invalid grant type for this service ' + appId,
          );
        }
        accessList = userDetails.accessList
          .map((x) => {
            if (x.serviceType === SERVICE_TYPES.SSI_API) {
              if (!this.checkIfDateExpired(x.expiryDate)) {
                return x.access;
              }
            }
          })
          .filter((x) => x != undefined);
        break;
      }
      case SERVICE_TYPES.CAVACH_API: {
        if (grantType != 'access_service_kyc') {
          throw new BadRequestException(
            'Invalid grant type for this service ' + appId,
          );
        }
        accessList = userDetails.accessList
          .map((x) => {
            if (x.serviceType === SERVICE_TYPES.CAVACH_API) {
              if (!this.checkIfDateExpired(x.expiryDate)) {
                return x.access;
              }
            }
          })
          .filter((x) => x != undefined);
        break;
      }
      default: {
        throw new BadRequestException('Invalid service ' + appId);
      }
    }

    if (accessList.length <= 0) {
      throw new UnauthorizedException(
        'You are not authorized to access service of type ',
        serviceType,
      );
    }

    return this.getAccessToken(grantType, app, 12, accessList);
  }
}
