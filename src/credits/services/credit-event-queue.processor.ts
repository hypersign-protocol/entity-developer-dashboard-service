import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { CreditRepository } from '../repositories/credit.repository';

export const CREDIT_EVENT_QUEUE =
  process.env.CREDIT_EVENT_QUEUE || 'credit-event';

type CreditEventType = 'commit' | 'reserved' | 'rollback';

export type CreditEvent = {
  eventType: CreditEventType;
  creditId: string;
  appId: string;
  appTenant: string;
  amount: number;
  reservationId: string;
  requestId?: string;
  requestPath: string;
};

@Processor(CREDIT_EVENT_QUEUE)
export class CreditEventQueueProcessor extends WorkerHost {
  constructor(private readonly creditRepository: CreditRepository) {
    super();
  }

  async process(job: Job<CreditEvent>) {
    const event = job.data;

    this.validateEvent(event);
    switch (event.eventType) {
      case 'reserved':
      case 'rollback':
        Logger.log(
          `Credit ${event.eventType} event acknowledged for reservation ${event.reservationId}`,
          'CreditEventQueueProcessor',
        );
        return;
      case 'commit':
        await this.processCommit(event);
        return;
    }
  }

  private async processCommit(event: CreditEvent) {
    const updatedCredit = await this.creditRepository.applyCreditCommit(
      event.creditId,
      event.appId,
      event.amount,
    );

    if (!updatedCredit) {
      throw new Error(
        `Credit commit could not be applied for creditId ${event.creditId}`,
      );
    }

    Logger.log(
      `Credit commit applied for creditId ${event.creditId} and reservation ${event.reservationId}`,
      'CreditEventQueueProcessor',
    );
  }

  private validateEvent(event: CreditEvent) {
    if (!event?.creditId || !event?.appId || !event?.reservationId) {
      throw new Error('creditId, appId and reservationId are required');
    }
    if (!['commit', 'reserved', 'rollback'].includes(event.eventType)) {
      throw new Error(`Unsupported credit event type: ${event?.eventType}`);
    }
    if (!Number.isFinite(event.amount) || event.amount <= 0) {
      throw new Error('amount must be a positive number');
    }
  }
}
