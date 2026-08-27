import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Types } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { CreditPlan, CreditSourceEnum, scope } from '../schemas/credit.schema';
import { ConfigService } from '@nestjs/config';
import { SERVICE_TYPES } from 'src/supported-service/services/iServiceList';
import { AppRepository } from 'src/app-auth/repositories/app.repository';
import {
  assertIsDeliverTxSuccess,
  QueryClient,
  setupAuthzExtension,
  setupFeegrantExtension,
  SigningStargateClient,
} from '@cosmjs/stargate';
import { Tendermint34Client } from '@cosmjs/tendermint-rpc';
import { BasicAllowance } from 'cosmjs-types/cosmos/feegrant/v1beta1/feegrant';
import { HidWalletService } from 'src/hid-wallet/services/hid-wallet.service';
import {
  generateAuthzGrantTxnMessage,
  generateAuthzRevokeTxnMessage,
  generateFeegrantRevokeTxnMessage,
  generatePerformFeegrantAllowanceTxn,
  MSG_CREATE_DID_TYPEURL,
  MSG_DEACTIVATE_DID_TYPEURL,
  MSG_REGISTER_CREDENTIAL_SCHEMA,
  MSG_REGISTER_CREDENTIAL_STATUS,
  MSG_UPDATE_CREDENTIAL_STATUS,
  MSG_UPDATE_DID_TYPEURL,
} from 'src/utils/authz';
import { CreditRequestDto } from '../dtos/credits.dto';
import { TimeUnit } from 'src/customer-onboarding/constants/enum';
import { CreditRepository } from '../repositories/credit.repository';
import { CreditStatus } from '../schemas/credit.schema';
import { CreditCommandService } from './credit-command.service';

const SSI_ON_CHAIN_ALLOWANCE_MULTIPLIER = BigInt(2000);

@Injectable()
export class CreditService {
  private authzWalletInstance;
  private granterClient: SigningStargateClient;
  private grantQueryClient: QueryClient &
    ReturnType<typeof setupAuthzExtension> &
    ReturnType<typeof setupFeegrantExtension>;
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
    if (
      !appDetail ||
      (serviceType !== SERVICE_TYPES.CAVACH_API &&
        serviceType !== SERVICE_TYPES.SSI_API)
    ) {
      throw new BadRequestException([
        `No supported service configured for appId ${appId}`,
      ]);
    }
    const criticalBalance = this.resolveCriticalBalance(credit);
    let activationCredit = credit;
    if (credit.criticalBalance !== criticalBalance) {
      const normalizedCredit = await this.creditRepository.findOneAndUpdate(
        { _id: creditId, serviceId: appId },
        { $set: { criticalBalance, serviceType } },
      );
      if (!normalizedCredit) {
        throw new InternalServerErrorException([
          'Legacy credit plan critical balance could not be persisted',
        ]);
      }
      activationCredit = normalizedCredit;
    }
    let expiresAt = activationCredit.expiresAt;
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
    let newOnChainAllowance;
    let newOnChainAllowanceScopes;
    if (serviceType === SERVICE_TYPES.SSI_API) {
      if (activationCredit.onChainAllowance) {
        this.assertUsableOnChainAllowance(activationCredit.onChainAllowance);
      } else {
        const authzCreditDetail = await this.grantSSIAllowance(
          appId,
          this.ssiOnChainAllowance(
            activationCredit.apiCredit.total - activationCredit.apiCredit.used,
          ),
          activationCredit.validityDays / 365,
        );
        newOnChainAllowance = {
          amount: Number(authzCreditDetail.credit.amount),
          denom: authzCreditDetail.credit.denom,
          usedAmount: 0,
        };
        newOnChainAllowanceScopes = authzCreditDetail.creditScope;
      }
    }

    if (serviceType === SERVICE_TYPES.CAVACH_API) {
      await this.creditCommandService.grantCreditPlan(
        this.creditForMiddlewareGrant(activationCredit, expiresAt),
        serviceType,
        appDetail.subdomain,
      );
      return activationCredit;
    }

    const activatedCredit = await this.creditRepository.activateSsiCreditPlan(
      appId,
      creditId,
      expiresAt,
      criticalBalance,
      newOnChainAllowance,
      newOnChainAllowanceScopes,
    );
    if (!activatedCredit) {
      throw new InternalServerErrorException([
        'SSI credit plan activation could not be persisted',
      ]);
    }
    if (activatedCredit.status !== CreditStatus.ACTIVE) {
      throw new BadRequestException([
        'Fully used SSI blockchain allowance cannot be activated',
      ]);
    }
    await this.creditCommandService.grantCreditPlan(
      activatedCredit,
      serviceType,
      appDetail.subdomain,
    );
    return activatedCredit;
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
      const hidWalletService = await this.moduleRef.resolve(
        HidWalletService,
        undefined,
        { strict: false },
      );
      this.authzWalletInstance = await hidWalletService.generateWallet(
        this.config.get('MNEMONIC'),
      );
      if (!this.granterClient) {
        this.granterClient = await SigningStargateClient.connectWithSigner(
          this.config.get('HID_NETWORK_RPC'),
          this.authzWalletInstance.wallet,
        );
      }
      if (!this.grantQueryClient) {
        const tendermintClient = await Tendermint34Client.connect(
          this.config.get('HID_NETWORK_RPC'),
        );
        this.grantQueryClient = QueryClient.withExtensions(
          tendermintClient,
          setupAuthzExtension,
          setupFeegrantExtension,
        );
      }

      const granterAddress = this.authzWalletInstance.address;
      const authzMessageTypeUrls = [
        MSG_CREATE_DID_TYPEURL,
        MSG_UPDATE_DID_TYPEURL,
        MSG_DEACTIVATE_DID_TYPEURL,
        MSG_REGISTER_CREDENTIAL_STATUS,
        MSG_REGISTER_CREDENTIAL_SCHEMA,
        MSG_UPDATE_CREDENTIAL_STATUS,
      ];

      const existingAuthzGrants = (
        await Promise.all(
          authzMessageTypeUrls.map(async (msgTypeUrl) => ({
            msgTypeUrl,
            exists: await this.hasAuthzGrant(
              granterAddress,
              walletAddress,
              msgTypeUrl,
            ),
          })),
        )
      ).filter(({ exists }) => exists);
      const previousFeegrant = await this.getFeegrantAllowance(
        granterAddress,
        walletAddress,
      );
      const replacementAllowanceValue =
        this.parseUhidAmount(previousFeegrant.remainingAmount) +
        this.parseUhidAmount(allowance);
      if (replacementAllowanceValue > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error(
          'Combined uhid allowance exceeds the maximum safe persisted value',
        );
      }
      const replacementAllowance = replacementAllowanceValue.toString();
      if (previousFeegrant.exists) {
        Logger.log(
          `Fee allowance calculation: previous remaining ${previousFeegrant.remainingAmount}uhid + new ${allowance}uhid = ${replacementAllowance}uhid`,
          'CreditService',
        );
      }

      const revokeMessages = [
        ...existingAuthzGrants.map(({ msgTypeUrl }) =>
          generateAuthzRevokeTxnMessage(
            walletAddress,
            granterAddress,
            msgTypeUrl,
          ),
        ),
        ...(previousFeegrant.exists
          ? [generateFeegrantRevokeTxnMessage(walletAddress, granterAddress)]
          : []),
      ];

      if (revokeMessages.length > 0) {
        Logger.log(
          `Replacing ${existingAuthzGrants.length} AuthZ grant(s) and ${
            previousFeegrant.exists ? 1 : 0
          } fee allowance(s) for ${walletAddress} in one transaction`,
          'CreditService',
        );
      }

      const authGrantTxnMessages = await Promise.all(
        authzMessageTypeUrls.map((msgTypeUrl) =>
          generateAuthzGrantTxnMessage(
            walletAddress,
            granterAddress,
            msgTypeUrl,
            periodInYears,
          ),
        ),
      );
      // Perform FeeGrant Allowence
      const performFeegrantAllowence =
        await generatePerformFeegrantAllowanceTxn(
          walletAddress,
          granterAddress,
          `${replacementAllowance}uhid`,
          periodInYears,
        );
      const transactionMessages = [
        ...revokeMessages,
        ...authGrantTxnMessages.map(({ txMsg }) => txMsg),
        performFeegrantAllowence.txMsg,
      ];
      const grantResult = await this.granterClient.signAndBroadcast(
        granterAddress,
        transactionMessages,
        this.authzTransactionFee(transactionMessages.length),
      );
      assertIsDeliverTxSuccess(grantResult);
      Logger.log(
        `${
          revokeMessages.length > 0
            ? 'SSI grants replaced'
            : 'SSI grants created'
        } atomically in transaction ${grantResult.transactionHash}`,
        'CreditService',
      );
      return {
        credit: {
          // The middleware plan receives only the newly purchased credit.
          // The previous remainder is already present in older FIFO plans.
          amount: allowance,
          denom: 'uhid',
        },
        feegrant: {
          amount: replacementAllowance,
          previousRemainingAmount: previousFeegrant.remainingAmount,
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

  private async hasAuthzGrant(
    granterAddress: string,
    granteeAddress: string,
    msgTypeUrl: string,
  ): Promise<boolean> {
    try {
      const response = await this.grantQueryClient.authz.grants(
        granterAddress,
        granteeAddress,
        msgTypeUrl,
      );
      if (response.grants.length > 0) {
        Logger.log(
          `Previous AuthZ grant exists: ${JSON.stringify({
            granter: granterAddress,
            grantee: granteeAddress,
            msgTypeUrl,
            grants: response.grants.map((grant) => ({
              authorizationType: grant.authorization?.typeUrl,
              expiration: this.formatGrantExpiration(grant.expiration),
            })),
          })}`,
          'CreditService',
        );
      }
      return response.grants.length > 0;
    } catch (error) {
      if (this.isMissingGrantError(error)) {
        return false;
      }
      throw error;
    }
  }

  private async getFeegrantAllowance(
    granterAddress: string,
    granteeAddress: string,
  ): Promise<{ exists: boolean; remainingAmount: string }> {
    try {
      const response = await this.grantQueryClient.feegrant.allowance(
        granterAddress,
        granteeAddress,
      );
      if (response.allowance) {
        const encodedAllowance = response.allowance.allowance;
        const previousAllowance: Record<string, unknown> = {
          granter: response.allowance.granter,
          grantee: response.allowance.grantee,
          allowanceType: encodedAllowance?.typeUrl,
        };
        if (
          encodedAllowance?.typeUrl ===
            '/cosmos.feegrant.v1beta1.BasicAllowance' &&
          encodedAllowance.value
        ) {
          const decodedAllowance = BasicAllowance.decode(
            encodedAllowance.value,
          );
          previousAllowance.spendLimit = decodedAllowance.spendLimit;
          previousAllowance.expiration = this.formatGrantExpiration(
            decodedAllowance.expiration,
          );
          const uhidSpendLimit = decodedAllowance.spendLimit.find(
            ({ denom }) => denom === 'uhid',
          );
          if (!uhidSpendLimit) {
            throw new Error(
              'Existing BasicAllowance has no finite uhid spend limit',
            );
          }
          previousAllowance.remainingAmount = uhidSpendLimit.amount;
          Logger.log(
            `Previous fee allowance exists: ${JSON.stringify(
              previousAllowance,
            )}`,
            'CreditService',
          );
          return {
            exists: true,
            remainingAmount: uhidSpendLimit.amount,
          };
        }
        throw new Error(
          `Existing fee allowance type ${
            encodedAllowance?.typeUrl ?? 'unknown'
          } is not supported for balance rollover`,
        );
      }
      return { exists: false, remainingAmount: '0' };
    } catch (error) {
      if (this.isMissingGrantError(error)) {
        return { exists: false, remainingAmount: '0' };
      }
      throw error;
    }
  }

  private parseUhidAmount(amount: string): bigint {
    if (!/^(0|[1-9]\d*)$/.test(amount)) {
      throw new Error(`Invalid uhid allowance amount: ${amount}`);
    }
    return BigInt(amount);
  }

  private ssiOnChainAllowance(apiCredits: number): string {
    if (!Number.isSafeInteger(apiCredits) || apiCredits <= 0) {
      throw new BadRequestException([
        'SSI API credit amount must be a positive safe integer',
      ]);
    }
    const allowance = BigInt(apiCredits) * SSI_ON_CHAIN_ALLOWANCE_MULTIPLIER;
    if (allowance > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new BadRequestException([
        'SSI blockchain allowance exceeds the maximum safe persisted value',
      ]);
    }
    return allowance.toString();
  }

  private isMissingGrantError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /not found|does not exist|no allowance/i.test(message);
  }

  private formatGrantExpiration(expiration?: {
    seconds?: { toString(): string };
    nanos?: number;
  }): string | null {
    if (!expiration?.seconds) {
      return null;
    }
    const seconds = Number(expiration.seconds.toString());
    if (!Number.isFinite(seconds)) {
      return expiration.seconds.toString();
    }
    return new Date(
      seconds * 1000 + Math.floor((expiration.nanos ?? 0) / 1_000_000),
    ).toISOString();
  }

  private authzTransactionFee(messageCount: number) {
    const feeUnits = Math.max(1, Math.ceil(messageCount / 7));
    return {
      amount: [{ denom: 'uhid', amount: String(20000 * feeUnits) }],
      gas: String(500000 * feeUnits),
    };
  }
  async grantCredit(
    appId: string,
    creditDto: CreditRequestDto,
    superAdminUserId: string,
    source: CreditSourceEnum,
    grantReferenceId?: string,
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
      const serviceType = serviceInfo.id as SERVICE_TYPES;
      const isSsiService = serviceInfo.id === SERVICE_TYPES.SSI_API;
      const { amount, validityPeriod, validityPeriodUnit } = creditDto;

      const totalCredit = Number(amount);
      if (!Number.isSafeInteger(totalCredit) || totalCredit <= 0) {
        throw new BadRequestException([
          'amount must be a positive safe integer',
        ]);
      }
      const criticalBalance = Math.floor(totalCredit * 0.4);
      const referenceId = grantReferenceId?.trim() || randomUUID();

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
        const isRetryableKycGrant =
          serviceInfo.id === SERVICE_TYPES.CAVACH_API &&
          existingCredit.status === CreditStatus.INACTIVE;
        const isRetryableSsiGrant =
          serviceInfo.id === SERVICE_TYPES.SSI_API &&
          existingCredit.status === CreditStatus.ACTIVE &&
          existingCredit.onChainAllowance;
        if (
          existingCredit.expiresAt &&
          (isRetryableKycGrant || isRetryableSsiGrant)
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
          this.ssiOnChainAllowance(totalCredit),
          periodInYears,
        );
        onChainAllowance = {
          amount: Number(authzCreditDetail.credit.amount),
          denom: authzCreditDetail.credit.denom,
          usedAmount: 0,
        };
        onChainAllowanceScopes = authzCreditDetail.creditScope;
      }

      const credit = await this.creditRepository.create({
        serviceId: appDetail.appId,
        serviceType,
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
      if (shouldActivate) {
        const persistedExpiry = credit.expiresAt ?? expiresAt;
        if (!persistedExpiry) {
          throw new InternalServerErrorException([
            'Credit plan expiry could not be persisted',
          ]);
        }
        await this.creditCommandService.grantCreditPlan(
          isSsiService
            ? credit
            : this.creditForMiddlewareGrant(credit, persistedExpiry),
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
    return {
      ...value,
      status: CreditStatus.ACTIVE,
      expiresAt,
      criticalBalance: this.resolveCriticalBalance(value),
    } as CreditPlan;
  }

  private resolveCriticalBalance(credit: CreditPlan): number {
    if (
      Number.isSafeInteger(credit.criticalBalance) &&
      credit.criticalBalance >= 0
    ) {
      return credit.criticalBalance;
    }
    return Math.floor(credit.apiCredit.total * 0.4);
  }

  private assertUsableOnChainAllowance(
    allowance: CreditPlan['onChainAllowance'],
  ): void {
    const amount = Number(allowance?.amount);
    const usedAmount = Number(allowance?.usedAmount ?? 0);
    if (
      !allowance ||
      !Number.isSafeInteger(amount) ||
      amount <= 0 ||
      !Number.isSafeInteger(usedAmount) ||
      usedAmount < 0 ||
      usedAmount >= amount
    ) {
      throw new BadRequestException([
        'Fully used SSI blockchain allowance cannot be activated',
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
