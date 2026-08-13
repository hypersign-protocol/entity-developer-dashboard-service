import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { CreditSourceEnum, scope } from '../schemas/credit.schema';
import { ConfigService } from '@nestjs/config';
import { SERVICE_TYPES } from 'src/supported-service/services/iServiceList';
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
import {
  CreateCreditDto,
  CreditRequestDto,
  ListCreditsDto,
} from '../dtos/credits.dto';
import { TimeUnit } from 'src/customer-onboarding/constants/enum';
import { CreditRepository } from '../repositories/credit.repository';
import { CreditStatus } from '../schemas/credit.schema';

@Injectable()
export class CreditService {
  private authzWalletInstance;
  private granterClient: SigningStargateClient;
  constructor(
    private readonly config: ConfigService,
    private readonly appRepository: AppRepository,
    private readonly hidWalletService: HidWalletService,
    private readonly creditRepository: CreditRepository,
  ) {}

  async fetchCreditDetails(appId: string, status?: CreditStatus) {
    Logger.log('Fetching credit plan list', 'CreditService');

    const pipeline = [
      {
        $match: {
          serviceId: appId,
          ...(status && { status }),
        },
      },
      {
        $sort: {
          createdAt: 1,
        },
      },
    ];

    return this.creditRepository.findBasedOnAggregationPipeline(pipeline);
  }

  async activateCredit(creditId: string, appId: string) {
    Logger.log(
      `Activating credit plan for app with Id: ${appId} and creditId ${creditId}`,
      'CreditService',
    );

    if (!Types.ObjectId.isValid(creditId)) {
      throw new BadRequestException(['Invalid credit id']);
    }
    const credit = await this.creditRepository.findParticularCreditDetail({
      serviceId: appId,
      _id: creditId,
    });
    if (!credit) {
      throw new NotFoundException([
        `No credit detail found for creditId: ${creditId}`,
      ]);
    }
    if (credit.expiresAt && credit.expiresAt <= new Date()) {
      throw new BadRequestException(['Expired credit cannot be activated']);
    }
    await this.creditRepository.updateMany(
      {
        serviceId: appId,
        _id: { $ne: creditId },
        status: CreditStatus.ACTIVE,
      },
      { $set: { status: CreditStatus.INACTIVE } },
    );

    const expiresAt = credit.expiresAt ?? new Date();
    if (!credit.expiresAt) {
      expiresAt.setUTCDate(expiresAt.getUTCDate() + credit.validityDays);
    }

    return this.creditRepository.findByIdAndUpdate(creditId, {
      $set: { status: CreditStatus.ACTIVE, expiresAt },
    });
  }

  async grantSSIAllowance(appId: string, allowance: string, periodInYears = 1) {
    Logger.log(
      'Inside grantSSIAllowance to provide Authz grant',
      'CreditService',
    );
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
        periodInYears,
      );
      const authGrantTxnMsgAndFeeDIDUpdate = await generateAuthzGrantTxnMessage(
        walletAddress,
        this.authzWalletInstance.address,
        MSG_UPDATE_DID_TYPEURL,
        periodInYears,
      );
      const authGrantTxnMsgAndFeeUpdateCredStatus =
        await generateAuthzGrantTxnMessage(
          walletAddress,
          this.authzWalletInstance.address,
          MSG_UPDATE_CREDENTIAL_STATUS,
          periodInYears,
        );

      const authGrantTxnMsgAndFeeSchema = await generateAuthzGrantTxnMessage(
        walletAddress,
        this.authzWalletInstance.address,
        MSG_REGISTER_CREDENTIAL_SCHEMA,
        periodInYears,
      );
      const authGrantTxnMsgAndFeeCred = await generateAuthzGrantTxnMessage(
        walletAddress,
        this.authzWalletInstance.address,
        MSG_REGISTER_CREDENTIAL_STATUS,
        periodInYears,
      );
      // Perform FeeGrant Allowence
      const performFeegrantAllowence =
        await generatePerformFeegrantAllowanceTxn(
          walletAddress,
          this.authzWalletInstance.address,
          `${allowance}uhid`,
          periodInYears,
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
      Logger.error(
        'Issue while providing grantSSIAllowance',
        e,
        'CreditService',
      );
      if (e instanceof Error) {
        throw new InternalServerErrorException(e.message);
      }
      throw new InternalServerErrorException([e]);
    }
  }
  async grantCredit(
    appId: string,
    creditDto: CreditRequestDto,
    superAdminUserId: string,
    source: CreditSourceEnum,
  ) {
    try {
      const appDetail = await this.appRepository.findOne({ appId });
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
      const { amount, validityPeriod, validityPeriodUnit } = creditDto;

      const totalCredit = Number(amount);
      if (!Number.isFinite(totalCredit) || totalCredit <= 0) {
        throw new BadRequestException(['amount must be a positive number']);
      }

      const { validityDays, expiresAt } = this.getCreditValidity(
        validityPeriod,
        validityPeriodUnit,
      );

      const activeCredit =
        await this.creditRepository.findParticularCreditDetail({
          serviceId: appDetail.appId,
          status: CreditStatus.ACTIVE,
        });
      const status = activeCredit ? CreditStatus.INACTIVE : CreditStatus.ACTIVE;

      let onChainAllowance;
      let onChainAllowanceScopes;
      if (isSsiService) {
        const periodInYears = this.getPeriodInYears(
          validityPeriod,
          validityPeriodUnit,
        );
        const authzCreditDetail = await this.grantSSIAllowance(
          appId,
          amount,
          periodInYears,
        );
        onChainAllowance = {
          amount: Number(authzCreditDetail.credit.amount),
          denom: authzCreditDetail.credit.denom,
        };
        onChainAllowanceScopes = authzCreditDetail.creditScope;
      }

      await this.creditRepository.create({
        serviceId: appDetail.appId,
        apiCredit: { total: totalCredit, used: 0 },
        validityDays,
        status,
        ...(status === CreditStatus.ACTIVE && { expiresAt }),
        ...(onChainAllowance && { onChainAllowance }),
        ...(onChainAllowanceScopes && { onChainAllowanceScopes }),
        creditedBy: superAdminUserId,
        source,
      });

      return { message: `Credit is successfully granted for service ${appId}` };
    } catch (e) {
      if (e instanceof BadRequestException) {
        throw e;
      }
      if (e instanceof Error) {
        throw new InternalServerErrorException([e.message]);
      }
      throw new InternalServerErrorException([e]);
    }
  }

  private getCreditValidity(
    validityPeriod: number,
    validityPeriodUnit: TimeUnit,
  ): { validityDays: number; expiresAt: Date } {
    if (!Number.isFinite(validityPeriod) || validityPeriod <= 0) {
      throw new BadRequestException([
        'validityPeriod must be a positive number',
      ]);
    }

    const expiresAt = new Date();
    switch (validityPeriodUnit) {
      case TimeUnit.Days:
        expiresAt.setUTCDate(expiresAt.getUTCDate() + validityPeriod);
        return { validityDays: validityPeriod, expiresAt };
      case TimeUnit.Month:
        expiresAt.setUTCMonth(expiresAt.getUTCMonth() + validityPeriod);
        return { validityDays: Math.ceil(validityPeriod * 30.4375), expiresAt };
      case TimeUnit.Year:
        expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + validityPeriod);
        return { validityDays: Math.ceil(validityPeriod * 365.25), expiresAt };
      default:
        throw new BadRequestException([
          `Invalid validityPeriodUnit: ${validityPeriodUnit}`,
        ]);
    }
  }

  private getPeriodInYears(
    validityPeriod?: number,
    validityPeriodUnit?: TimeUnit,
  ): number {
    if (validityPeriod === undefined || validityPeriodUnit === undefined) {
      return 1;
    }

    switch (validityPeriodUnit) {
      case TimeUnit.Days:
        return validityPeriod / 365;
      case TimeUnit.Month:
        return validityPeriod / 12;
      case TimeUnit.Year:
        return validityPeriod;
      default:
        throw new BadRequestException([
          `Invalid validityPeriodUnit: ${validityPeriodUnit}`,
        ]);
    }
  }
}
