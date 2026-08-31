import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import {
  CREDIT_EVENT_NAMES,
  type CreditBullMqWorker,
} from '@hypersign-protocol/credit-middleware';
import { CreditBullMqProvider } from './credit-bullmq.provider';
import { CreditEventStore } from './credit-event-store.service';
import { CREDIT_EVENT_QUEUE } from '../credit.constants';

@Injectable()
export class CreditLifecycleConsumer
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(CreditLifecycleConsumer.name);
  private readonly criticalBalanceProcessing = new Map<string, Promise<void>>();
  private worker?: CreditBullMqWorker;

  constructor(
    private readonly bullMq: CreditBullMqProvider,
    private readonly store: CreditEventStore,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.store.initialize();
    this.worker = await this.bullMq.createWorker(
      CREDIT_EVENT_QUEUE,
      async (job) => {
        const processJob = async () => {
          await this.store.append(job);
          switch (job.name) {
            case CREDIT_EVENT_NAMES.RESERVED:
              this.logger.log(
                `Credit reserved: ${this.eventSummary(job.data)}`,
              );
              break;
            case CREDIT_EVENT_NAMES.COMMITTED:
              this.logger.debug(
                `Credit committed: ${this.eventSummary(job.data)}`,
              );
              break;
            case CREDIT_EVENT_NAMES.ROLLED_BACK:
              this.logger.log(
                `Credit rolled back: ${this.eventSummary(job.data)}`,
              );
              break;
            case CREDIT_EVENT_NAMES.EXPIRED:
              this.logger.log(`Credit expired: ${this.eventSummary(job.data)}`);
              break;
            case CREDIT_EVENT_NAMES.PLAN_EXPIRED:
              this.logger.log(
                `Credit plan expired: ${this.eventSummary(job.data)}`,
              );
              break;
            case CREDIT_EVENT_NAMES.CREDIT_GRANTED:
              this.logger.log(`Credit granted: ${this.eventSummary(job.data)}`);
              break;
            case CREDIT_EVENT_NAMES.CRITICAL_BALANCE:
              this.logger.log(
                `Critical balance reached: ${this.eventSummary(job.data)}`,
              );
              break;
            case CREDIT_EVENT_NAMES.CREDIT_OBSERVED:
              this.logger.debug(
                `Development credit usage observed: ${this.eventSummary(
                  job.data,
                )}`,
              );
              break;
            case CREDIT_EVENT_NAMES.COMMAND_REJECTED:
              this.logger.error(
                `Credit command rejected: ${this.eventSummary(job.data)}`,
              );
              break;
          }
        };
        if (job.name === CREDIT_EVENT_NAMES.CRITICAL_BALANCE) {
          await this.processCriticalBalanceInOrder(job.data, processJob);
          return;
        }
        await processJob();
      },
    );
    try {
      const retried = await this.bullMq.retryFailedJobs(
        CREDIT_EVENT_QUEUE,
        CREDIT_EVENT_NAMES.COMMITTED,
        'Cannot insert into a time-series collection in a multi-document transaction',
      );
      if (retried > 0) {
        this.logger.warn(
          `Retried ${retried} credit commit job(s) that failed before time-series writes were moved outside transactions`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Could not retry failed credit commit jobs: ${message}`,
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }

  private async processCriticalBalanceInOrder(
    data: unknown,
    process: () => Promise<void>,
  ): Promise<void> {
    const appId = this.eventAppId(data);
    if (!appId) {
      await process();
      return;
    }
    const previous = this.criticalBalanceProcessing.get(appId);
    const current = (previous ?? Promise.resolve())
      .catch(() => undefined)
      .then(process);
    this.criticalBalanceProcessing.set(appId, current);
    try {
      await current;
    } finally {
      if (this.criticalBalanceProcessing.get(appId) === current) {
        this.criticalBalanceProcessing.delete(appId);
      }
    }
  }

  private eventAppId(data: unknown): string | undefined {
    if (!data || typeof data !== 'object') return undefined;
    const event = (data as Record<string, unknown>).event;
    if (!event || typeof event !== 'object') return undefined;
    const appId = (event as Record<string, unknown>).appId;
    return typeof appId === 'string' && appId ? appId : undefined;
  }

  private eventSummary(data: unknown): string {
    if (!data || typeof data !== 'object') return String(data);
    const envelope = data as Record<string, unknown>;
    const event =
      envelope.event && typeof envelope.event === 'object'
        ? (envelope.event as Record<string, unknown>)
        : envelope;
    const reason = event.reason;
    return JSON.stringify({
      eventId: envelope.eventId,
      serviceType: envelope.serviceType,
      type: event.type,
      appId: event.appId,
      reservationId: event.reservationId,
      planId: event.planId ?? envelope.planId,
      creditType: event.creditType,
      amount: event.amount,
      allocationIndex: event.allocationIndex,
      allocationCount: event.allocationCount,
      commandId: envelope.commandId,
      ...(typeof reason === 'string' && { reason: reason.slice(0, 500) }),
    });
  }
}
