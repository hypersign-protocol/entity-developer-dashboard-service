import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { existDir, createDir, store } from './utils/utils';
import { HypersignSSISdk } from 'hs-ssi-sdk';
import { json, urlencoded } from 'express';
import * as path from 'path';
import * as express from 'express';
// eslint-disable-next-line
const hidWallet = require('hid-hd-wallet');
import { Bip39, EnglishMnemonic } from '@cosmjs/crypto';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EdvClientKeysManager } from './edv/services/edv.singleton';
import { VaultWalletManager } from './edv/services/vaultWalletManager';
import { AppAuthModule } from './app-auth/app-auth.module';
import { AppOauthModule } from './app-oauth/app-oauth.module';
//import { Header } from '@nestjs/common';
import * as cors from 'cors';
import { UserModule } from './user/user.module';
import { randomUUID } from 'crypto';
import { SupportedServiceModule } from './supported-service/supported-service.module';
import { SocialLoginModule } from './social-login/social-login.module';
import { CreditModule } from './credits/credits.module';
import { TeamModule } from './roles/role.module';
import { PeopleModule } from './people/people.module';
import * as cookieParser from 'cookie-parser';
import { WebpageConfigModule } from './webpage-config/webpage-config.module';
import { CustomerOnboardingModule } from './customer-onboarding/customer-onboarding.module';

// eslint-disable-next-line
const HypersignAuth = require('hypersign-auth-node-sdk');

const hidNetworkUrls = Object.freeze({
  testnet: {
    rpc: 'https://rpc.jagrat.hypersign.id/',
    rest: 'https://api.jagrat.hypersign.id/',
  },
});
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ extended: true, limit: '10mb' }));
  app.use(express.static(path.join(__dirname, '../public')));
  app.use(cookieParser());

  // Adding prefix to our api

  const walletOptions = {
    hidNodeRestUrl: process.env.HID_NETWORK_API,
    hidNodeRPCUrl: process.env.HID_NETWORK_RPC,
  };
  const hidWalletInstance = new hidWallet(walletOptions);

  await hidWalletInstance.generateWallet({
    mnemonic: process.env.MNEMONIC,
  });

  // HID SDK instance
  const offlineSigner = hidWalletInstance.offlineSigner;
  const nodeRpcEndpoint = walletOptions.hidNodeRPCUrl;
  const nodeRestEndpoint = walletOptions.hidNodeRestUrl;
  const namespace = 'testnet';
  const hsSSIdkInstance = new HypersignSSISdk({
    offlineSigner,
    nodeRpcEndpoint,
    nodeRestEndpoint,
    namespace,
  });
  await hsSSIdkInstance.init();
  globalThis.hsSSIdkInstance = hsSSIdkInstance;

  const mnemonic_EnglishMnemonic: EnglishMnemonic = process.env
    .MNEMONIC as unknown as EnglishMnemonic;

  const kmsVaultWallet = await VaultWalletManager.getWallet(
    mnemonic_EnglishMnemonic,
  );

  const config = new ConfigService();
  const edv_config_dir = config.get('EDV_CONFIG_DIR')
    ? config.get('EDV_CONFIG_DIR')
    : '.edv-config';
  const edv_did_file_path = config.get('EDV_DID_FILE_PATH')
    ? config.get('EDV_DID_FILE_PATH')
    : edv_config_dir + '/edv-did.json';
  const edv_key_file_path = config.get('EDV_KEY_FILE_PATH')
    ? config.get('EDV_KEY_FILE_PATH')
    : edv_config_dir + '/edv-keys.json';

  if (!existDir(edv_config_dir)) {
    createDir(edv_config_dir);
  }
  if (!existDir(edv_did_file_path)) {
    store(kmsVaultWallet.didDocument, edv_did_file_path);
  }
  if (!existDir(edv_key_file_path)) {
    store(kmsVaultWallet.keys, edv_key_file_path);
  }

  try {
    // Super admin keymanager setup
    Logger.log('Before keymanager initialization', 'main');
    const kmsVaultManager = new EdvClientKeysManager();
    const vaultPrefixInEnv = config.get('VAULT_PREFIX');
    const vaultPrefix =
      vaultPrefixInEnv && vaultPrefixInEnv != 'undefined'
        ? vaultPrefixInEnv
        : 'hs:developer-dashboard:';
    const edvId = vaultPrefix + 'kms:' + kmsVaultWallet.didDocument.id;
    const kmsVault = await kmsVaultManager.createVault(kmsVaultWallet, edvId);

    // TODO rename this to kmsVault for bnetter cla
    globalThis.kmsVault = kmsVault;

    Logger.log('After  keymanager initialization', 'main');
  } catch (e) {
    Logger.error(e);
  }

  try {
    // Swagger documentation setup
    const orgDocConfig = new DocumentBuilder()
      .setTitle('Entity Developer Dashboard Service API')
      .setDescription('Open API Documentation for Entity Developer Dashboard')
      .addBearerAuth(
        {
          type: 'http',
          name: 'Authorization',
          in: 'header',
        },
        'Authorization',
      )
      .setVersion('1.0')
      .build();

    const orgDocuments = SwaggerModule.createDocument(app, orgDocConfig, {
      include: [AppOauthModule, WebpageConfigModule, CustomerOnboardingModule],
    });
    const tenantOptions = {
      swaggerOptions: {
        defaultModelsExpandDepth: -1,
      },
      customfavIcon: '/Entity_favicon.png',
      customSiteTitle: 'Entity Developer Documentation',
      customCss: ` .topbar-wrapper img {content:url(\'./Entity_full.png\'); width:135px; height:auto;margin-left: -150px;}
      .swagger-ui .topbar { background-color: #fff; }`,
    };
    const orgOptions = tenantOptions;
    SwaggerModule.setup('/', app, orgDocuments, orgOptions);
  } catch (e) {
    Logger.error(e);
  }

  // try {
  //   // Session for super admin
  //   if (
  //     !config.get('SUPER_ADMIN_USERNAME') ||
  //     !config.get('SUPER_ADMIN_PASSWORD')
  //   ) {
  //     throw new Error(
  //       'SUPER_ADMIN_USERNAME or SUPER_ADMIN_PASSWORD are not set in env',
  //     );
  //   }

  //   if (!config.get('SESSION_SECRET_KEY')) {
  //     throw new Error('SESSION_KEY is not set in env');
  //   }
  //   Logger.log('Setting up session start', 'main');
  //   app.use(
  //     session({
  //       secret: config.get('SESSION_SECRET_KEY'),
  //       resave: false,
  //       saveUninitialized: false,
  //       cookie: { maxAge: 3600000 },
  //     }),
  //   );
  //   app.use(passport.initialize());
  //   app.use(passport.session());
  //   Logger.log('Setting up session finished', 'main');
  // } catch (e) {
  //   Logger.error(e);
  // }

  // Only Allowing frontends which are mentioned in env
  const allowedOriginInEnv = JSON.parse(config.get('WHITELISTED_CORS')); // ["http://localhost:9001","https://wallet-jagrat.hypersign.id"]
  app.use(
    cors({
      origin: allowedOriginInEnv,
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
      credentials: true,
    }),
  );

  const server = await app.listen(process.env.PORT || 3001);

  // TODO: we might not need to pass hidWalletInstance.offlineSigner since this sdk only verifies presenatation
  // This way we do not have to pass hypersign.json config file
  const hypersignAuthOptions = {
    serviceName: 'Entity Developer Dashboard',
    serviceEp: config.get('DEVELOPER_DASHBOARD_SERVICE_PUBLIC_EP')
      ? config.get('DEVELOPER_DASHBOARD_SERVICE_PUBLIC_EP')
      : `http://localhost:${process.env.PORT}`,
    schemaId: config.get('EMAIL_CREDENTITAL_SCHEMA_ID')
      ? config.get('EMAIL_CREDENTITAL_SCHEMA_ID')
      : 'sch:hid:testnet:z6MkoTFHzx3XPXAvAVAN9CWMh91vH53m4kTFiVPypC22c7fB:1.0',
    accessToken: {
      secret: config.get('JWT_SECRET')
        ? config.get('JWT_SECRET')
        : randomUUID(),
      expiryTime: 120000,
    },
    refreshToken: {
      secret: config.get('JWT_SECRET')
        ? config.get('JWT_SECRET')
        : randomUUID(),
      expiryTime: 120000,
    },
    networkUrl: config.get('HID_NETWORK_RPC')
      ? config.get('HID_NETWORK_RPC')
      : hidNetworkUrls.testnet.rpc,
    networkRestUrl: config.get('HID_NETWORK_API')
      ? config.get('HID_NETWORK_API')
      : hidNetworkUrls.testnet.rest,
  };
  const hypersignAuth = new HypersignAuth(
    server,
    hidWalletInstance.offlineSigner,
    hypersignAuthOptions,
  );
  await hypersignAuth.init();
  globalThis.hypersignAuth = hypersignAuth;

  Logger.log(
    `Server running on http://localhost:${process.env.PORT}`,
    'Bootstrap',
  );
}
bootstrap();
