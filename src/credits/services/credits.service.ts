import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Types } from 'mongoose';
import { CreditPlan, CreditSourceEnum, scope } from '../schemas/credit.schema';
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
import { CreditCommandService } from './credit-command.service';

@Injectable()
export class CreditService {
  private authzWalletInstance;
  private granterClient: SigningStargateClient;
  constructor(
    private readonly config: ConfigService,
    private readonly appRepository: AppRepository,
    private readonly creditRepository: CreditRepository,
    private readonly creditCommandService: CreditCommandService,
    private readonly moduleRef: ModuleRef,
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
    if (credit.apiCredit.used >= credit.apiCredit.total) {
      throw new BadRequestException([
        'Fully used credit plan cannot be activated',
      ]);
    }
    const appDetail = await this.appRepository.findOne({ appId });
    const serviceType = appDetail?.services?.[0]?.id;
    let expiresAt = credit.expiresAt;
    if (!expiresAt) {
      const proposedExpiry = new Date();
      proposedExpiry.setUTCDate(
        proposedExpiry.getUTCDate() + credit.validityDays,
      );
      if (serviceType === SERVICE_TYPES.CAVACH_API) {
        const persisted = await this.creditRepository.findOneAndUpdate(
          {
            _id: creditId,
            serviceId: appId,
            $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }],
          },
          { $set: { expiresAt: proposedExpiry } },
        );
        const stableCredit =
          persisted ??
          (await this.creditRepository.findParticularCreditDetail({
            _id: creditId,
            serviceId: appId,
          }));
        expiresAt = stableCredit?.expiresAt;
      } else {
        expiresAt = proposedExpiry;
      }
    }
    if (!expiresAt) {
      throw new InternalServerErrorException([
        'Credit plan expiry could not be persisted',
      ]);
    }
    let onChainAllowance;
    let onChainAllowanceScopes;
    if (serviceType === SERVICE_TYPES.SSI_API) {
      const authzCreditDetail = await this.grantSSIAllowance(
        appId,
        String(credit.apiCredit.total - credit.apiCredit.used),
        credit.validityDays / 365,
      );
      onChainAllowance = {
        amount: Number(authzCreditDetail.credit.amount),
        denom: authzCreditDetail.credit.denom,
      };
      onChainAllowanceScopes = authzCreditDetail.creditScope;
    }

    if (serviceType === SERVICE_TYPES.CAVACH_API) {
      await this.creditCommandService.grantCreditPlan(
        this.creditForMiddlewareGrant(credit, expiresAt),
        serviceType,
        appDetail.subdomain,
      );
      return credit;
    }

    return this.creditRepository.findOneAndUpdate(
      { _id: creditId, serviceId: appId },
      {
        $set: {
          status: CreditStatus.ACTIVE,
          expiresAt,
          ...(onChainAllowance && { onChainAllowance }),
          ...(onChainAllowanceScopes && { onChainAllowanceScopes }),
        },
      },
    );
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
      const hidWalletService = await this.moduleRef.resolve(HidWalletService);
      this.authzWalletInstance = await hidWalletService.generateWallet(
        this.config.get('MNEMONIC'),
      );
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
      const {
        amount,
        criticalBalance,
        referenceId: rawReferenceId,
        validityPeriod,
        validityPeriodUnit,
      } = creditDto;
      const referenceId = rawReferenceId?.trim();

      const totalCredit = Number(amount);
      if (!Number.isSafeInteger(totalCredit) || totalCredit <= 0) {
        throw new BadRequestException([
          'amount must be a positive safe integer',
        ]);
      }
      if (!Number.isSafeInteger(criticalBalance) || criticalBalance < 0) {
        throw new BadRequestException([
          'criticalBalance must be a non-negative safe integer',
        ]);
      }
      if (!referenceId) {
        throw new BadRequestException(['referenceId is required']);
      }

      const validity = this.getCreditValidity(
        validityPeriod,
        validityPeriodUnit,
        false,
      );
      const existingCredit =
        await this.creditRepository.findParticularCreditDetail({
          serviceId: appId,
          referenceId,
        });
      if (existingCredit) {
        if (
          existingCredit.apiCredit.total !== totalCredit ||
          existingCredit.criticalBalance !== criticalBalance ||
          existingCredit.validityDays !== validity.validityDays ||
          existingCredit.source !== source
        ) {
          throw new BadRequestException([
            'referenceId was reused with different credit semantics',
          ]);
        }
        if (
          serviceInfo.id === SERVICE_TYPES.CAVACH_API &&
          existingCredit.status === CreditStatus.INACTIVE &&
          existingCredit.expiresAt
        ) {
          await this.creditCommandService.grantCreditPlan(
            this.creditForMiddlewareGrant(
              existingCredit,
              existingCredit.expiresAt,
            ),
            serviceInfo.id,
            appDetail.subdomain,
          );
        }
        return {
          message: `Credit is successfully granted for service ${appId}`,
        };
      }

      const activeCredit =
        await this.creditRepository.findActiveCreditForService(appId);

      const { validityDays, expiresAt } = this.getCreditValidity(
        validityPeriod,
        validityPeriodUnit,
        !activeCredit,
      );

      const shouldActivate = !activeCredit;
      const status =
        shouldActivate && !isSsiService
          ? CreditStatus.INACTIVE
          : shouldActivate
          ? CreditStatus.ACTIVE
          : CreditStatus.INACTIVE;

      let onChainAllowance;
      let onChainAllowanceScopes;
      if (isSsiService && status === CreditStatus.ACTIVE) {
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

      const credit = await this.creditRepository.create({
        serviceId: appDetail.appId,
        referenceId,
        apiCredit: { total: totalCredit, used: 0 },
        validityDays,
        criticalBalance,
        status,
        ...(shouldActivate && expiresAt && { expiresAt }),
        ...(onChainAllowance && { onChainAllowance }),
        ...(onChainAllowanceScopes && { onChainAllowanceScopes }),
        creditedBy: superAdminUserId,
        source,
      });
      if (
        credit.apiCredit.total !== totalCredit ||
        credit.criticalBalance !== criticalBalance ||
        credit.validityDays !== validityDays ||
        credit.source !== source
      ) {
        throw new BadRequestException([
          'referenceId was reused with different credit semantics',
        ]);
      }
      if (shouldActivate && !isSsiService) {
        const persistedExpiry = credit.expiresAt ?? expiresAt;
        if (!persistedExpiry) {
          throw new InternalServerErrorException([
            'Credit plan expiry could not be persisted',
          ]);
        }
        await this.creditCommandService.grantCreditPlan(
          this.creditForMiddlewareGrant(credit, persistedExpiry),
          serviceInfo.id,
          appDetail.subdomain,
        );
      }

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
    setExpiry = true,
  ): { validityDays: number; expiresAt?: Date } {
    if (!Number.isFinite(validityPeriod) || validityPeriod <= 0) {
      throw new BadRequestException([
        'validityPeriod must be a positive number',
      ]);
    }

    const expiresAt = setExpiry ? new Date() : undefined;
    switch (validityPeriodUnit) {
      case TimeUnit.Days:
        expiresAt?.setUTCDate(expiresAt.getUTCDate() + validityPeriod);
        return { validityDays: validityPeriod, expiresAt };
      case TimeUnit.Month:
        expiresAt?.setUTCMonth(expiresAt.getUTCMonth() + validityPeriod);
        return { validityDays: Math.ceil(validityPeriod * 30.4375), expiresAt };
      case TimeUnit.Year:
        expiresAt?.setUTCFullYear(expiresAt.getUTCFullYear() + validityPeriod);
        return { validityDays: Math.ceil(validityPeriod * 365.25), expiresAt };
      default:
        throw new BadRequestException([
          `Invalid validityPeriodUnit: ${validityPeriodUnit}`,
        ]);
    }
  }

  private creditForMiddlewareGrant(credit: CreditPlan, expiresAt: Date) {
    const creditDocument = credit as CreditPlan & {
      toObject?: () => CreditPlan;
    };
    const value = creditDocument.toObject?.() ?? credit;
    return { ...value, status: CreditStatus.ACTIVE, expiresAt } as CreditPlan;
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
