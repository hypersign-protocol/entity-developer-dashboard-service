import { Injectable, Logger } from '@nestjs/common';
import {
  CREDIT_EVENT_NAMES,
  type AnyCreditEvent,
  type CreditBullMqJob,
  type CreditLifecycleEventEnvelope,
} from '@hypersign-protocol/credit-middleware';
import { CreditRepository } from '../repositories/credit.repository';
import { CreditStatus } from '../schemas/credit.schema';
import { CreditService } from './credits.service';

export const CREDIT_EVENT_QUEUE = 'credit.lifecycle';

type CreditLifecycleEnvelope = Omit<CreditLifecycleEventEnvelope, 'event'> & {
  event: AnyCreditEvent;
};

@Injectable()
export class CreditEventStore {
  constructor(
    private readonly creditRepository: CreditRepository,
    private readonly creditService: CreditService,
  ) {}

  async append(job: CreditBullMqJob): Promise<void> {
    if (job.name === CREDIT_EVENT_NAMES.COMMAND_REJECTED) {
      this.validateCommandRejection(job.data);
      Logger.error(
        `Credit command rejected: ${JSON.stringify(job.data)}`,
        CreditEventStore.name,
      );
      return;
    }
    await this.processLifecycleEvent(
      job.name,
      this.lifecycleEnvelope(job.data),
    );
  }

  private async processLifecycleEvent(
    jobName: string,
    envelope: CreditLifecycleEnvelope,
  ) {
    this.validateLifecycleEnvelope(envelope);

    switch (jobName) {
      case CREDIT_EVENT_NAMES.COMMITTED:
        this.validateLifecycleEventType(envelope, 'COMMITTED');
        await this.processCommit(
          envelope.event.appId,
          this.planId(envelope),
          this.eventAmount(envelope),
          envelope.eventId,
          this.reservationId(envelope),
        );
        return;
      case CREDIT_EVENT_NAMES.PLAN_EXPIRED:
        this.validateLifecycleEventType(envelope, 'PLAN_EXPIRED');
        await this.processPlanExpired(
          envelope.event.appId,
          this.planId(envelope),
        );
        return;
      case CREDIT_EVENT_NAMES.RESERVED:
        this.validateLifecycleEventType(envelope, 'RESERVED');
        break;
      case CREDIT_EVENT_NAMES.ROLLED_BACK:
        this.validateLifecycleEventType(envelope, 'ROLLED_BACK');
        break;
      case CREDIT_EVENT_NAMES.EXPIRED:
        this.validateLifecycleEventType(envelope, 'EXPIRED');
        break;
      case CREDIT_EVENT_NAMES.CREDIT_GRANTED:
        this.validateLifecycleEventType(envelope, 'CREDIT_GRANTED');
        break;
      case CREDIT_EVENT_NAMES.CRITICAL_BALANCE:
        this.validateLifecycleEventType(envelope, 'CRITICAL_BALANCE');
        await this.processCriticalBalance(
          envelope.event.appId,
          this.planId(envelope),
        );
        break;
      default:
        throw new Error(`Unsupported credit lifecycle job: ${jobName}`);
    }
  }

  private async processCommit(
    appId: string,
    planId: string,
    amount: number,
    eventId: string,
    reservationId?: string,
  ) {
    const updatedCredit = await this.creditRepository.applyPlanCreditCommit(
      appId,
      planId,
      amount,
      eventId,
    );
    if (!updatedCredit) {
      if (await this.creditRepository.hasProcessedCommit(appId, eventId)) {
        return;
      }
      throw new Error(
        `Credit commit could not be applied for appId ${appId}, planId ${planId}`,
      );
    }
    Logger.log(
      `Credit commit applied for appId ${appId} and reservation ${reservationId}`,
      CreditEventStore.name,
    );
  }

  private async processPlanExpired(appId: string, planId: string) {
    await this.creditRepository.findOneAndUpdate(
      { _id: planId, serviceId: appId, status: CreditStatus.ACTIVE },
      { $set: { status: CreditStatus.INACTIVE } },
    );
  }

  private async processCriticalBalance(appId: string, planId: string) {
    const activeReplacement =
      await this.creditRepository.findActiveCreditForService(appId, planId);
    if (activeReplacement) return;

    const replacement = await this.creditRepository.findParticularCreditDetail({
      serviceId: appId,
      status: CreditStatus.INACTIVE,
      expiresAt: { $exists: false },
    });
    if (!replacement) return;
    const replacementId = String(
      (replacement as unknown as CreditPlanWithId)._id,
    );
    await this.creditService.activateCredit(replacementId, appId);
  }

  private lifecycleEnvelope(event: unknown): CreditLifecycleEnvelope {
    if (!event || typeof event !== 'object') {
      throw new Error('Invalid credit lifecycle event envelope');
    }
    return event as CreditLifecycleEnvelope;
  }

  private validateLifecycleEnvelope(envelope: CreditLifecycleEnvelope) {
    if (
      envelope.schemaVersion !== 2 ||
      !envelope.eventId ||
      !envelope.catalogVersion ||
      !envelope.catalogId ||
      !envelope.event?.appId
    ) {
      throw new Error('Invalid credit lifecycle event envelope');
    }
    if (
      envelope.event.type === 'COMMITTED' &&
      (!Number.isSafeInteger(envelope.event.amount) ||
        Number(envelope.event.amount) <= 0 ||
        !envelope.event.reservationId ||
        !envelope.event.planId)
    ) {
      throw new Error('Invalid committed credit lifecycle event');
    }
  }

  private validateLifecycleEventType(
    envelope: CreditLifecycleEnvelope,
    expectedType: AnyCreditEvent['type'],
  ) {
    if (envelope.event.type !== expectedType) {
      throw new Error('Credit lifecycle job name and event type do not match');
    }
  }

  private eventAmount(envelope: CreditLifecycleEnvelope): number {
    return (envelope.event as Extract<AnyCreditEvent, { type: 'COMMITTED' }>)
      .amount;
  }

  private reservationId(envelope: CreditLifecycleEnvelope): string {
    return (envelope.event as Extract<AnyCreditEvent, { type: 'COMMITTED' }>)
      .reservationId;
  }

  private planId(envelope: CreditLifecycleEnvelope): string {
    const planId = envelope.event.planId;
    if (typeof planId !== 'string' || !planId) {
      throw new Error('Credit lifecycle event is missing planId');
    }
    return planId;
  }

  private validateCommandRejection(value: unknown): void {
    const rejection = value as {
      schemaVersion?: unknown;
      catalogId?: unknown;
      commandId?: unknown;
      reason?: unknown;
    };
    if (
      !rejection ||
      rejection.schemaVersion !== 2 ||
      typeof rejection.catalogId !== 'string' ||
      typeof rejection.commandId !== 'string' ||
      typeof rejection.reason !== 'string'
    ) {
      throw new Error('Invalid credit command rejection');
    }
  }
}

type CreditPlanWithId = { _id: unknown };
