import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { SERVICE_TYPES } from 'src/supported-service/services/iServiceList';
import { CreditPlan, CreditStatus } from '../schemas/credit.schema';
import { TIME } from '../../utils/time-constant';
export const CREDIT_QUEUE_PREFIX =
  process.env.CREDIT_QUEUE || 'credit-allocation';
export const SSI_CREDIT_ALLOCATION_QUEUE = `${CREDIT_QUEUE_PREFIX}-ssi-service`;
export const ID_CREDIT_ALLOCATION_QUEUE = `${CREDIT_QUEUE_PREFIX}-id-service`;
const CREDIT_ALLOCATION_JOB = 'credit-allocation';

@Injectable()
export class CreditAllocationQueueService {
  constructor(
    @InjectQueue(SSI_CREDIT_ALLOCATION_QUEUE)
    private readonly ssiCreditQueue: Queue,
    @InjectQueue(ID_CREDIT_ALLOCATION_QUEUE)
    private readonly idCreditQueue: Queue,
  ) {}

  async addActiveCredit(credit: CreditPlan, serviceType: string) {
    if (credit.status !== CreditStatus.ACTIVE) {
      return;
    }

    const queue = this.getQueue(serviceType);
    if (!queue) {
      Logger.warn(
        `No credit allocation queue configured for service type: ${serviceType}`,
        'CreditAllocationQueueService',
      );
      return;
    }

    const payload = {
      creditId: (credit as any)._id?.toString(),
      serviceType,
      serviceId: credit.serviceId,
      apiCredit: credit.apiCredit,
      validityDays: credit.validityDays,
      expiresAt: credit.expiresAt,
      status: credit.status,
      onChainAllowance: credit.onChainAllowance,
      onChainAllowanceScopes: credit.onChainAllowanceScopes,
      creditedBy: credit.creditedBy,
      source: credit.source,
    };

    await queue.add(CREDIT_ALLOCATION_JOB, payload, {
      removeOnComplete: { age: 10 * TIME.MINUTE }, // Remove completed jobs after 10 minutes
    });
    console.log(payload, 'payload');
    Logger.log(
      `Queued active credit ${payload.creditId} for ${serviceType}`,
      'CreditAllocationQueueService',
    );
  }

  private getQueue(serviceType: string): Queue | undefined {
    switch (serviceType) {
      case SERVICE_TYPES.SSI_API:
        return this.ssiCreditQueue;
      case SERVICE_TYPES.CAVACH_API:
        return this.idCreditQueue;
      default:
        return undefined;
    }
  }
}
