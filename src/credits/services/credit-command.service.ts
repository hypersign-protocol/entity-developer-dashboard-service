import { Injectable, Logger } from '@nestjs/common';
import { CREDIT_EVENT_NAMES } from '@hypersign-protocol/credit-middleware';
import type { CreditCommandEnvelope } from '@hypersign-protocol/credit-middleware';
import { SERVICE_TYPES } from '../../supported-service/services/iServiceList';
import { CreditPlan, CreditStatus } from '../schemas/credit.schema';
import { CreditBullMqProvider } from './credit-bullmq.provider';

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

    if (applicationServiceType !== SERVICE_TYPES.CAVACH_API) {
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
    const amount = total - used;
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

    const commandId = `grant-${ SERVICE_TYPES.CAVACH_API}-${planId}`;
    const queueName = `credit.commands.${ SERVICE_TYPES.CAVACH_API}`;
    const command: CreditCommandEnvelope = {
      schemaVersion: 3,
      commandId,
      serviceType:  SERVICE_TYPES.CAVACH_API,
      source: 'entity-developer-dashboard-service',
      requestedAt: new Date().toISOString(),
      payload: {
        subject: {
          appId,
          ...(tenantId ? { tenantId } : {}),
          appType: SERVICE_TYPES.CAVACH_API,
          creditType: 'API_CREDIT',
        },
        planId,
        amount,
        criticalBalance: credit.criticalBalance,
        grantedAt,
        expiresAt,
        referenceId: credit.referenceId.trim(),
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
