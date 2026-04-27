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
import { EnglishMnemonic } from '@cosmjs/crypto';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EdvClientKeysManager } from './edv/services/edv.singleton';
import { VaultWalletManager } from './edv/services/vaultWalletManager';
import { AppOauthModule } from './app-oauth/app-oauth.module';
import * as cors from 'cors';
import * as cookieParser from 'cookie-parser';
import { WebpageConfigModule } from './webpage-config/webpage-config.module';
import { CustomerOnboardingModule } from './customer-onboarding/customer-onboarding.module';
import { CreditModule } from './credits/credits.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ extended: true, limit: '10mb' }));
  app.use(express.static(path.join(__dirname, '../public')));
  app.use(cookieParser());

  const config = new ConfigService();
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
  const namespace = config.get('HID_NETWORK_NAMESPACE') || '';
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
      include: [
        AppOauthModule,
        WebpageConfigModule,
        CustomerOnboardingModule,
        CreditModule,
      ],
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

  // Only Allowing frontends which are mentioned in env
  const allowedOriginInEnv = JSON.parse(config.get('WHITELISTED_CORS'));
  app.use(
    cors({
      origin: allowedOriginInEnv,
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
      credentials: true,
    }),
  );

  await app.listen(process.env.PORT || 3001);
  Logger.log(
    `Server running on http://localhost:${process.env.PORT}`,
    'Bootstrap',
  );
}
bootstrap();
