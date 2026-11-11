import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { PaymentRouter } from '../payments/payment-router';
import { OrderService } from './order.service';

const QUEUE = 'billing-payments';
const EVERY_MS = 5 * 60 * 1000;

// Payment status without webhooks (phase 1): a repeatable BullMQ job re-checks
// open, paid-but-unfulfilled and recently closed orders. One schedule for all
// replicas; one job runs at a time.
@Injectable()
export class PaymentReconciliationService
  implements OnModuleInit, OnApplicationShutdown
{
  private connection?: Redis;
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly orders: OrderService,
    private readonly router: PaymentRouter,
  ) {}

  onModuleInit() {
    if (
      process.env.BILLING_PAY_ENABLED !== 'true' ||
      !this.router.configured().length
    ) {
      Logger.log(
        'Payment reconciliation is off (BILLING_PAY_ENABLED or provider keys not set)',
        'PaymentReconciliation',
      );
      return;
    }
    const url =
      process.env.REDIS_URL ||
      `redis://${
        process.env.REDIS_HOST ||
        'redis-stack-service.hypermine-development.svc.cluster.local'
      }:${process.env.REDIS_PORT || '6379'}`;
    this.connection = new Redis(url, { maxRetriesPerRequest: null });
    this.queue = new Queue(QUEUE, { connection: this.connection });
    // Not awaited: a slow Redis must not hold up the dashboard's startup.
    this.queue
      .add(
        'reconcile',
        {},
        {
          repeat: { every: EVERY_MS },
          removeOnComplete: 100,
          removeOnFail: 100,
        },
      )
      .catch((error) =>
        Logger.error(
          `Could not schedule payment reconciliation: ${error?.message}`,
          'PaymentReconciliation',
        ),
      );
    this.worker = new Worker(
      QUEUE,
      async () => {
        const result = await this.orders.reconcile();
        if (result.failed || result.synced) {
          Logger.log(
            `Reconciled orders: ${result.synced} checked, ${result.failed} failed`,
            'PaymentReconciliation',
          );
        }
        return result;
      },
      { connection: this.connection, concurrency: 1 },
    );
    this.worker.on('failed', (_, error) =>
      Logger.error(
        `Reconciliation run failed: ${error?.message}`,
        'PaymentReconciliation',
      ),
    );
  }

  async onApplicationShutdown() {
    await this.worker?.close();
    await this.queue?.close();
    await this.connection?.quit();
  }
}
