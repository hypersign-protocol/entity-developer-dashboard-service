import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuthZCreditsRepository } from '../repositories/authz.repository';
import { scope } from '../../credits/schemas/authz.schema';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { APP_ENVIRONMENT } from 'src/supported-service/services/iServiceList';
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

@Injectable()
export class AuthzCreditService {
  private authzWalletInstance;
  private granterClient: SigningStargateClient;
  constructor(
    private readonly authzCreditsRepository: AuthZCreditsRepository,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly appRepository: AppRepository,
    private readonly hidWalletService: HidWalletService,
  ) {}

  async createAuthzCredits(authz: { userId; appId }) {
    return await this.authzCreditsRepository.create({
      userId: authz.userId,
      appId: authz.appId,
      expires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      // created: new Date().toISOString(),
      credit: {
        amount: this.config.get('BASIC_ALLOWANCE') || '5000000',
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
    });
  }

  async getCreditDetails(appId, userId) {
    return this.authzCreditsRepository.find({
      userId,
      appId,
    });
  }

  async grantCavachCredit(
    subdomain: string,
    appId: string,
    environmentMode: APP_ENVIRONMENT,
    tenantUrl: string,
  ) {
    Logger.log(
      'grantCavachCredit() method to grant free credit to cavach service',
      'AuthZCreditService',
    );
    const payload = {
      purpose: 'CreditRecharge',
      amount: 1501, // will take this as function parameter later
      amountDenom: 'uHID',
      validityPeriod: 6,
      serviceId: appId,
      validityPeriodUnit: 'MONTH',
      env: environmentMode,
      subdomain,
    };
    const token = await this.jwt.signAsync(payload, {
      expiresIn: '5m',
      secret: this.config.get('JWT_SECRET'),
    });
    fetch(`${tenantUrl}api/v1/credit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'Application/json',
        authorization: `Bearer ${token}`,
      },
    }).catch((error) => {
      Logger.error('Failed to grant credit:', error);
    });
  }
  async grantSSICredit(appId, allowance) {
    Logger.log(
      'Inside grantSSICredit to provide Authz grant',
      'AuthzCreditService',
    );
    let appDetail;
    try {
      appDetail = await this.appRepository.findOne({ appId });
      if (!appDetail || appDetail === null) {
        throw new NotFoundException([`No app found for appId ${appId}`]);
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
      throw new BadRequestException([e.message]);
    }
  }
}
