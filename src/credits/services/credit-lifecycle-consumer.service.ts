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
        await this.store.append(job);
        switch (job.name) {
          case CREDIT_EVENT_NAMES.RESERVED:
            this.logger.log(`Credit reserved: ${JSON.stringify(job.data)}`);
            break;
          case CREDIT_EVENT_NAMES.COMMITTED:
            this.logger.debug(`Credit committed: ${JSON.stringify(job.data)}`);
            break;
          case CREDIT_EVENT_NAMES.ROLLED_BACK:
            this.logger.log(`Credit rolled back: ${JSON.stringify(job.data)}`);
            break;
          case CREDIT_EVENT_NAMES.EXPIRED:
            this.logger.log(`Credit expired: ${JSON.stringify(job.data)}`);
            break;
          case CREDIT_EVENT_NAMES.PLAN_EXPIRED:
            this.logger.log(`Credit plan expired: ${JSON.stringify(job.data)}`);
            break;
          case CREDIT_EVENT_NAMES.CREDIT_GRANTED:
            this.logger.log(`Credit granted: ${JSON.stringify(job.data)}`);
            break;
          case CREDIT_EVENT_NAMES.CRITICAL_BALANCE:
            this.logger.log(
              `Critical balance reached: ${JSON.stringify(job.data)}`,
            );
            break;
          case CREDIT_EVENT_NAMES.CREDIT_OBSERVED:
            this.logger.debug(
              `Development credit usage observed: ${JSON.stringify(job.data)}`,
            );
            break;
          case CREDIT_EVENT_NAMES.COMMAND_REJECTED:
            this.logger.error(
              `Credit command rejected: ${JSON.stringify(job.data)}`,
            );
            break;
        }
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
}
