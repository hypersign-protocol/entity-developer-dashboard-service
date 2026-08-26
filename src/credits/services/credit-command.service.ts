import { Injectable, Logger } from '@nestjs/common';
import {
  CREDIT_EVENT_NAMES,
  CreditType,
} from '@hypersign-protocol/credit-middleware';
import type { CreditCommandEnvelope } from '@hypersign-protocol/credit-middleware';
import { SERVICE_TYPES } from '../../supported-service/services/iServiceList';
import { CreditPlan, CreditStatus } from '../schemas/credit.schema';
import { CreditBullMqProvider } from './credit-bullmq.provider';
import { sdkPlanId, sdkReferenceId } from '../credit-wallet';

type WalletGrant = {
  creditType: CreditType;
  amount: number;
  criticalBalance: number;
};

export type SsiTransactionSettlement = {
  transactionJobId: string;
  reservationId: string;
  status: 'SUCCEEDED' | 'FAILED';
  reason?: string;
};

@Injectable()
export class CreditCommandService {
  constructor(private readonly bullMq: CreditBullMqProvider) {}

  async grantCreditPlan(
    credit: CreditPlan,
    applicationServiceType: string,
    tenantId?: string,
  ): Promise<void> {
    if (credit.status !== CreditStatus.ACTIVE) {
      throw new Error('Only an active credit plan can be granted');
    }

    if (
      applicationServiceType !== SERVICE_TYPES.CAVACH_API &&
      applicationServiceType !== SERVICE_TYPES.SSI_API
    ) {
      throw new Error(
        'No SDK credit catalog configured for service type: ' +
          applicationServiceType,
      );
    }
    const planId = String((credit as CreditPlan & { _id?: unknown })._id ?? '');
    if (!planId) throw new Error('Credit plan must have an id');
    const appId = credit.serviceId;

    const { total, used } = credit.apiCredit;
    if (
      !Number.isSafeInteger(total) ||
      total <= 0 ||
      !Number.isSafeInteger(used) ||
      used < 0 ||
      used >= total
    ) {
      throw new Error('Credit plan must have a positive remaining balance');
    }
    if (
      !Number.isSafeInteger(credit.criticalBalance) ||
      credit.criticalBalance < 0
    ) {
      throw new Error(
        'Credit plan criticalBalance must be a non-negative safe integer',
      );
    }
    if (!credit.referenceId?.trim()) {
      throw new Error('Credit plan referenceId is required');
    }
    const grantedAt = new Date(
      (credit as CreditPlan & { createdAt?: Date }).createdAt ?? Date.now(),
    ).getTime();
    const expiresAt = credit.expiresAt?.getTime();
    if (!Number.isSafeInteger(grantedAt) || grantedAt <= 0) {
      throw new Error('Credit plan must have a valid creation time');
    }
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= grantedAt) {
      throw new Error('Credit plan must expire after it was created');
    }

    const serviceType = applicationServiceType as SERVICE_TYPES;
    const queueName = `credit.commands.${serviceType}`;
    for (const wallet of this.walletGrants(credit, serviceType)) {
      const middlewarePlanId = sdkPlanId(
        planId,
        serviceType,
        wallet.creditType,
      );
      const referenceId = sdkReferenceId(
        credit.referenceId.trim(),
        serviceType,
        wallet.creditType,
      );
      const commandId = `grant-${serviceType}-${middlewarePlanId}`;
      const command: CreditCommandEnvelope = {
        schemaVersion: 3,
        commandId,
        serviceType,
        source: 'entity-developer-dashboard-service',
        requestedAt: new Date().toISOString(),
        payload: {
          subject: {
            appId,
            ...(tenantId ? { tenantId } : {}),
            appType: serviceType,
            creditType: wallet.creditType,
          },
          planId: middlewarePlanId,
          amount: wallet.amount,
          criticalBalance: wallet.criticalBalance,
          grantedAt,
          expiresAt,
          referenceId,
          reason: 'credit_plan_grant',
        },
      };
      await this.bullMq.add(
        queueName,
        CREDIT_EVENT_NAMES.GRANT_REQUESTED,
        command,
        { jobId: commandId },
      );

      Logger.log(
        `Queued SDK credit grant ${commandId} on ${queueName}`,
        CreditCommandService.name,
      );
    }
  }

  async settleSsiTransaction(
    settlement: SsiTransactionSettlement,
  ): Promise<void> {
    const transactionJobId = settlement.transactionJobId?.trim();
    const reservationId = settlement.reservationId?.trim();
    if (!transactionJobId || !reservationId) {
      throw new Error(
        'SSI transaction settlement requires transactionJobId and reservationId',
      );
    }
    if (settlement.status !== 'SUCCEEDED' && settlement.status !== 'FAILED') {
      throw new Error('Unsupported SSI transaction settlement status');
    }

    const isCommit = settlement.status === 'SUCCEEDED';
    const jobName = isCommit
      ? CREDIT_EVENT_NAMES.COMMIT_REQUESTED
      : CREDIT_EVENT_NAMES.ROLLBACK_REQUESTED;
    // BullMQ custom ids must not contain ':'. The reservation id is stable and
    // a reservation can reach only one terminal credit state.
    const commandId = `settle-SSI_API-${reservationId}-${
      isCommit ? 'commit' : 'rollback'
    }`;
    const command: CreditCommandEnvelope = {
      schemaVersion: 3,
      commandId,
      serviceType: SERVICE_TYPES.SSI_API,
      source: 'entity-developer-dashboard-service',
      requestedAt: new Date().toISOString(),
      payload: {
        reservationId,
        transactionJobId,
        ...(!isCommit
          ? {
              reason:
                settlement.reason?.trim() || 'blockchain_transaction_failed',
            }
          : {}),
      },
    };

    await this.bullMq.add(
      `credit.commands.${SERVICE_TYPES.SSI_API}`,
      jobName,
      command,
      { jobId: commandId },
    );
    Logger.log(
      `Queued ${jobName} for SSI reservation ${reservationId}`,
      CreditCommandService.name,
    );
  }

  private walletGrants(
    credit: CreditPlan,
    serviceType: SERVICE_TYPES,
  ): WalletGrant[] {
    const apiAmount = credit.apiCredit.total - credit.apiCredit.used;
    if (serviceType === SERVICE_TYPES.CAVACH_API) {
      return [
        {
          creditType: CreditType.API_CREDIT,
          amount: apiAmount,
          criticalBalance: credit.criticalBalance,
        },
      ];
    }

    const allowance = credit.onChainAllowance;
    const blockchainAmount =
      Number(allowance?.amount) - Number(allowance?.usedAmount ?? 0);
    if (
      !allowance ||
      !Number.isSafeInteger(blockchainAmount) ||
      blockchainAmount <= 0
    ) {
      throw new Error(
        'An SSI credit plan must have a positive on-chain allowance balance',
      );
    }

    return [
      {
        creditType: CreditType.API_CREDIT,
        // SSI plan grants are immutable in the SDK. A retry must reproduce the
        // original plan semantics rather than grant the current remainder.
        amount: credit.apiCredit.total,
        criticalBalance: credit.criticalBalance,
      },
      {
        creditType: CreditType.BLOCKCHAIN_TXN_CREDIT,
        amount: Number(allowance.amount),
        criticalBalance: Math.floor(Number(allowance.amount) * 0.4),
      },
    ];
  }
}
