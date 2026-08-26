import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import amqp, {
  AmqpConnectionManager,
  ChannelWrapper,
} from 'amqp-connection-manager';
import { SERVICE_TYPES } from '../../supported-service/services/iServiceList';
import { CreditCommandService } from './credit-command.service';

type ResultStatus = 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';

type SsiTransactionResultItem = {
  transactionJobId: string;
  reservationId: string;
  serviceType: string;
};

type SsiTransactionResult = {
  schemaVersion: 1;
  eventId: string;
  status: ResultStatus;
  transactionHash?: string;
  code?: number;
  rawLog?: string;
  reason?: string;
  items: SsiTransactionResultItem[];
};

@Injectable()
export class SsiTransactionResultConsumer
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(SsiTransactionResultConsumer.name);
  private connection?: AmqpConnectionManager;
  private channel?: ChannelWrapper;

  constructor(
    private readonly config: ConfigService,
    private readonly commands: CreditCommandService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const rabbitUrl = this.config.get<string>('RABBIT_MQ_URI')?.trim();
    if (!rabbitUrl) {
      this.logger.warn(
        'RABBIT_MQ_URI is not configured; SSI transaction settlement consumer is disabled',
      );
      return;
    }

    const exchange =
      this.config.get<string>('SSI_TXN_RESULT_EXCHANGE')?.trim() ||
      'ssi.txn.results';
    const queue =
      this.config.get<string>('SSI_TXN_RESULT_QUEUE')?.trim() ||
      'developer-dashboard.ssi.txn-results';
    const unknownQueue =
      this.config.get<string>('SSI_TXN_UNKNOWN_QUEUE')?.trim() ||
      'developer-dashboard.ssi.txn-unknown';

    this.connection = amqp.connect(rabbitUrl);
    this.connection.on('disconnect', ({ err }) =>
      this.logger.error(`RabbitMQ disconnected: ${err?.message ?? err}`),
    );
    this.channel = this.connection.createChannel({
      name: 'ssi-transaction-results',
      setup: async (channel) => {
        await channel.assertExchange(exchange, 'topic', { durable: true });
        await channel.assertQueue(queue, { durable: true });
        await channel.bindQueue(queue, exchange, 'ssi.txn.succeeded');
        await channel.bindQueue(queue, exchange, 'ssi.txn.failed');
        // Unknown outcomes must be reconciled rather than committed or rolled
        // back. Retain them durably without blocking terminal settlements.
        await channel.assertQueue(unknownQueue, { durable: true });
        await channel.bindQueue(unknownQueue, exchange, 'ssi.txn.unknown');
        await channel.prefetch(10);
        await channel.consume(
          queue,
          (message) => {
            if (message) void this.consume(message, channel);
          },
          { noAck: false },
        );
      },
    });
    this.logger.log(
      `Listening for SSI transaction results on RabbitMQ queue ${queue}`,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.channel?.close();
    await this.connection?.close();
  }

  private async consume(message: any, channel: any): Promise<void> {
    let result: SsiTransactionResult;
    try {
      result = this.parseResult(message.content.toString());
    } catch (error) {
      this.logger.error(
        `Discarding invalid SSI transaction result: ${this.errorMessage(
          error,
        )}`,
      );
      channel.ack(message);
      return;
    }

    try {
      if (result.status === 'UNKNOWN') {
        this.logger.warn(
          `SSI transaction result ${result.eventId} requires reconciliation`,
        );
      } else {
        for (const item of result.items) {
          await this.commands.settleSsiTransaction({
            transactionJobId: item.transactionJobId,
            reservationId: item.reservationId,
            status: result.status,
            reason:
              result.status === 'FAILED'
                ? result.reason ||
                  result.rawLog ||
                  (Number.isSafeInteger(result.code)
                    ? `blockchain_transaction_code_${result.code}`
                    : undefined)
                : undefined,
          });
        }
      }
      channel.ack(message);
    } catch (error) {
      this.logger.error(
        `Could not process SSI transaction result ${
          result.eventId
        }: ${this.errorMessage(error)}`,
      );
      channel.nack(message, false, true);
    }
  }

  private parseResult(raw: string): SsiTransactionResult {
    const value = JSON.parse(raw) as Partial<SsiTransactionResult>;
    if (
      value.schemaVersion !== 1 ||
      typeof value.eventId !== 'string' ||
      !value.eventId ||
      !['SUCCEEDED', 'FAILED', 'UNKNOWN'].includes(value.status) ||
      !Array.isArray(value.items) ||
      value.items.length === 0
    ) {
      throw new Error('Invalid SSI transaction result envelope');
    }
    for (const item of value.items) {
      if (
        !item ||
        item.serviceType !== SERVICE_TYPES.SSI_API ||
        typeof item.transactionJobId !== 'string' ||
        !item.transactionJobId ||
        typeof item.reservationId !== 'string' ||
        !item.reservationId
      ) {
        throw new Error('Invalid SSI transaction result item');
      }
    }
    return value as SsiTransactionResult;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
