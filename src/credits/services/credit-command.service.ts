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
    serviceType: string,
    tenantId?: string,
  ): Promise<void> {
    if (credit.status !== CreditStatus.ACTIVE) {
      throw new Error('Only an active credit plan can be granted');
    }

    if (serviceType !== SERVICE_TYPES.CAVACH_API) {
      throw new Error(
        `No SDK credit catalog configured for service type: ${serviceType}`,
      );
    }
    const catalogId = 'KYC';

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

    const commandId = `grant-${catalogId}-${planId}`;
    const queueName = `credit.commands.${catalogId}`;
    const command: CreditCommandEnvelope = {
      schemaVersion: 2,
      commandId,
      catalogId,
      source: 'entity-developer-dashboard-service',
      requestedAt: new Date().toISOString(),
      payload: {
        subject: {
          appId,
          ...(tenantId ? { tenantId } : {}),
          appType: 'KYC_SERVICE',
          creditType: 'API_CREDIT',
        },
        planId,
        amount,
        grantedAt,
        expiresAt,
        referenceId: planId,
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
