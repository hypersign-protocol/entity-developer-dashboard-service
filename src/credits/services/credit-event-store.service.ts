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
        return;
      case CREDIT_EVENT_NAMES.RESERVED:
        this.validateLifecycleEventType(envelope, 'RESERVED');
        await this.processReservation(
          envelope.event.appId,
          this.planId(envelope),
          this.eventAmount(envelope),
          this.reservationId(envelope),
        );
        return;
      case CREDIT_EVENT_NAMES.ROLLED_BACK:
        this.validateLifecycleEventType(envelope, 'ROLLED_BACK');
        await this.processReservationRelease(
          envelope.event.appId,
          this.planId(envelope),
          this.restoredAmount(envelope),
          this.reservationId(envelope),
          'rolled back',
        );
        return;
      case CREDIT_EVENT_NAMES.EXPIRED:
        this.validateLifecycleEventType(envelope, 'EXPIRED');
        await this.processReservationRelease(
          envelope.event.appId,
          this.planId(envelope),
          this.restoredAmount(envelope),
          this.reservationId(envelope),
          'expired',
        );
        return;
      case CREDIT_EVENT_NAMES.PLAN_EXPIRED:
        this.validateLifecycleEventType(envelope, 'PLAN_EXPIRED');
        await this.processPlanExpired(
          envelope.event.appId,
          this.planId(envelope),
        );
        return;
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

  private async processReservation(
    appId: string,
    planId: string,
    amount: number,
    reservationId?: string,
  ) {
    const updatedCredit =
      await this.creditRepository.applyPlanCreditReservation(
        appId,
        planId,
        amount,
      );
    if (!updatedCredit) {
      throw new Error(
        `Credit reservation could not be applied for appId ${appId}, planId ${planId}`,
      );
    }
    Logger.log(
      `Credit reservation applied for appId ${appId} and reservation ${reservationId}`,
      CreditEventStore.name,
    );
  }

  private async processReservationRelease(
    appId: string,
    planId: string,
    restoredAmount: number,
    reservationId: string,
    reason: 'rolled back' | 'expired',
  ) {
    const updatedCredit =
      await this.creditRepository.releasePlanCreditReservation(
        appId,
        planId,
        restoredAmount,
      );
    if (!updatedCredit) {
      throw new Error(
        `Credit reservation ${reason} event could not be applied for appId ${appId}, planId ${planId}`,
      );
    }
    Logger.log(
      `Credit reservation ${reason} for appId ${appId} and reservation ${reservationId}`,
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
    const event = envelope.event as AnyCreditEvent & {
      amount?: unknown;
      restoredAmount?: unknown;
      reservationId?: unknown;
    };
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
      ['COMMITTED', 'RESERVED'].includes(event.type) &&
      (!Number.isSafeInteger(event.amount) ||
        Number(event.amount) <= 0 ||
        !event.reservationId ||
        !event.planId)
    ) {
      throw new Error('Invalid committed credit lifecycle event');
    }
    if (
      ['ROLLED_BACK', 'EXPIRED'].includes(event.type) &&
      (!Number.isSafeInteger(event.restoredAmount) ||
        Number(event.restoredAmount) < 0 ||
        !event.reservationId ||
        !event.planId)
    ) {
      throw new Error('Invalid credit reservation release lifecycle event');
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
    return (
      envelope.event as Extract<
        AnyCreditEvent,
        { type: 'COMMITTED' | 'RESERVED' }
      >
    ).amount;
  }

  private reservationId(envelope: CreditLifecycleEnvelope): string {
    return (
      envelope.event as Extract<
        AnyCreditEvent,
        { type: 'COMMITTED' | 'RESERVED' | 'ROLLED_BACK' | 'EXPIRED' }
      >
    ).reservationId;
  }

  private restoredAmount(envelope: CreditLifecycleEnvelope): number {
    return (
      envelope.event as Extract<
        AnyCreditEvent,
        { type: 'ROLLED_BACK' | 'EXPIRED' }
      >
    ).restoredAmount;
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
