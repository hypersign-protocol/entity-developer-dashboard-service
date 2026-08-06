import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { scope } from '../../credits/schemas/authz.schema';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  APP_ENVIRONMENT,
  SERVICE_TYPES,
  SERVICES,
} from 'src/supported-service/services/iServiceList';
import { AppRepository } from 'src/app-auth/repositories/app.repository';
import { SigningStargateClient } from '@cosmjs/stargate';
import { HidWalletService } from 'src/hid-wallet/services/hid-wallet.service';
import {
  generateAuthzGrantTxnMessage,
  generatePerformFeegrantAllowanceTxn,
  MSG_CREATE_DID_TYPEURL,
  MSG_REGISTER_CREDENTIAL_SCHEMA,
  MSG_REGISTER_CREDENTIAL_STATUS,
  MSG_UPDATE_CREDENTIAL_STATUS,
  MSG_UPDATE_DID_TYPEURL,
} from 'src/utils/authz';
import { sanitizeUrl } from 'src/utils/utils';
import { GRANT_TYPES } from 'src/app-auth/services/app-auth.service';
import { EXPIRY_CONFIG } from 'src/utils/time-constant';

@Injectable()
export class CreditService {
  private authzWalletInstance;
  private granterClient: SigningStargateClient;
  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly appRepository: AppRepository,
    private readonly hidWalletService: HidWalletService,
  ) {}

  async grantSSICredit(appId, allowance) {
    Logger.log('Inside grantSSICredit to provide Authz grant', 'CreditService');
    let appDetail;
    try {
      appDetail = await this.appRepository.findOne({ appId });
      if (!appDetail || appDetail === null) {
        throw new BadRequestException([`No app found for appId ${appId}`]);
      }
      const walletAddress = appDetail.walletAddress;
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
      // Perform AuthZ Grant
      const authGrantTxnMsgAndFeeDID = await generateAuthzGrantTxnMessage(
        walletAddress,
        this.authzWalletInstance.address,
        MSG_CREATE_DID_TYPEURL,
      );
      const authGrantTxnMsgAndFeeDIDUpdate = await generateAuthzGrantTxnMessage(
        walletAddress,
        this.authzWalletInstance.address,
        MSG_UPDATE_DID_TYPEURL,
      );
      const authGrantTxnMsgAndFeeUpdateCredStatus =
        await generateAuthzGrantTxnMessage(
          walletAddress,
          this.authzWalletInstance.address,
          MSG_UPDATE_CREDENTIAL_STATUS,
        );

      const authGrantTxnMsgAndFeeSchema = await generateAuthzGrantTxnMessage(
        walletAddress,
        this.authzWalletInstance.address,
        MSG_REGISTER_CREDENTIAL_SCHEMA,
      );
      const authGrantTxnMsgAndFeeCred = await generateAuthzGrantTxnMessage(
        walletAddress,
        this.authzWalletInstance.address,
        MSG_REGISTER_CREDENTIAL_STATUS,
      );
      // Perform FeeGrant Allowence
      const performFeegrantAllowence =
        await generatePerformFeegrantAllowanceTxn(
          walletAddress,
          this.authzWalletInstance.address,
          `${allowance}uhid`,
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
      return {
        credit: {
          amount: allowance,
          denom: 'uhid',
        },
        creditScope: [
          scope.MsgRegisterDID,
          scope.MsgDeactivateDID,
          scope.MsgRegisterCredentialSchema,
          scope.MsgUpdateDID,
          scope.MsgUpdateCredentialStatus,
          scope.MsgRegisterCredentialStatus,
        ],
      };
    } catch (e) {
      Logger.error('Issue while providing grantSSICredit', e, 'CreditService');
      if (e instanceof Error) {
        throw new InternalServerErrorException(e.message);
      }
      throw new InternalServerErrorException([e]);
    }
  }
  async grantCredit(appId, creditDto, superAdminUserId) {
    let appDetail;
    try {
      appDetail = await this.appRepository.findOne({ appId });
      if (!appDetail || appDetail === null) {
        throw new BadRequestException([`No app found for appId ${appId}`]);
      }
      const serviceInfo = appDetail?.services?.[0];
      if (!serviceInfo) {
        throw new BadRequestException(
          `No service configured for appId ${appId}`,
        );
      }
      const isSsiService = serviceInfo.id === SERVICE_TYPES.SSI_API;
      const {
        amount,
        validityPeriod,
        validityPeriodUnit,
        amountDenom = 'uHID',
      } = creditDto;
      const creditPayload = {
        serviceId: appDetail.appId,
        purpose: 'CreditRecharge',
        amount,
        validityPeriod,
        validityPeriodUnit,
        amountDenom,
        subdomain: appDetail.subdomain,
        grantType: isSsiService
          ? GRANT_TYPES.access_service_ssi
          : GRANT_TYPES.access_service_kyc,
        whitelistedCors: appDetail.whitelistedCors,
        // If service has access WRITE_CREDIT then only allow to call credit API.
        accessList: isSsiService
          ? SERVICES.SSI_API.ACCESS_TYPES.WRITE_CREDIT
          : SERVICES.CAVACH_API.ACCESS_TYPES.WRITE_CREDIT,
        creditedBy: superAdminUserId,
      };
      const { jwtTime, jwtUnit } = EXPIRY_CONFIG.CREDIT_TOKEN;
      const expiresIn = `${jwtTime}${jwtUnit}`;
      const creditToken = this.jwt.sign(creditPayload, {
        expiresIn,
        secret: this.config.get('JWT_SECRET'),
      });
      const requestOptions: RequestInit = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-credit-token': creditToken,
        },
      };
      if (isSsiService) {
        const authzCreditDetail = await this.grantSSICredit(appId, amount);
        requestOptions.body = JSON.stringify({
          ...authzCreditDetail,
        });
      }
      const tenantUrl = sanitizeUrl(serviceInfo.domain, true);
      await this.makeExternalRequest(
        `${tenantUrl}api/v1/credit`,
        requestOptions,
      );
      return { message: `Credit is successfully granted for service ${appId}` };
    } catch (e) {
      if (e instanceof Error) {
        throw new InternalServerErrorException([e.message]);
      }
      throw new InternalServerErrorException([e]);
    }
  }

  private async makeExternalRequest(url: string, options: RequestInit) {
    Logger.log('Inside makeExternalRequest()', 'CreditService');
    try {
      Logger.log(`Making request to ${url}`, 'CreditService');
      const response = await fetch(url, options);
      Logger.log(
        `Received response with status ${response.status}`,
        'CreditService',
      );
      const text = await response.text();
      const detail = text ? JSON.parse(text) : null;
      if (!response.ok) {
        const serverError =
          detail?.error?.details ||
          (Array.isArray(detail?.message)
            ? detail.message.join(', ')
            : detail?.message) ||
          JSON.stringify(detail) ||
          'Unknown error from external service';
        throw new Error(serverError);
      }
      return detail;
    } catch (error) {
      Logger.error(error, error?.stack, 'CreditService');
      throw error;
    }
  }
}
