import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { Model, Types } from 'mongoose';
import { BillingErrorCode } from '../billing.constants';
import { BillingException } from '../billing.exception';
import {
  PaymentProvider,
  PaymentWebhookEvent,
} from '../payments/payment-provider';
import { PaymentRouter } from '../payments/payment-router';
import { Order, OrderDocument } from '../schemas/order.schema';
import {
  WebhookEvent,
  WebhookEventDocument,
  WebhookEventStatus,
} from '../schemas/webhook-event.schema';
import { OrderService } from './order.service';

// While another sync holds the order (confirm, polling, the job), try again:
// that sync may have read the provider just before this payment landed.
const BUSY_TRIES = 5;
const BUSY_RETRY_MS = 3 * 1000;

const DONE = [WebhookEventStatus.PROCESSED, WebhookEventStatus.IGNORED];

export interface WebhookDelivery {
  rawBody?: Buffer;
  signature?: string;
  eventId?: string;
  body: unknown;
}

// Gateway webhooks (ADR §5.2). Optional: without a webhook secret the endpoint
// answers 503 and nothing else changes, because confirm, polling and the
// reconciliation job already move every order. With one, a payment is picked
// up seconds after it happens instead of on the next poll.
//
// A webhook never decides what a payment means. It finds our order and runs
// OrderService.sync(), which reads the payment from the provider's API, the
// same as every other path. A forged, replayed or out-of-order event can at
// worst make us check an order early.
@Injectable()
export class PaymentWebhookService {
  constructor(
    @InjectModel(WebhookEvent.name)
    private readonly eventModel: Model<WebhookEventDocument>,
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    private readonly orders: OrderService,
    private readonly router: PaymentRouter,
  ) {}

  /**
   * Verifies and records the event, then answers. The sync runs after the
   * response, so the provider gets its 2xx within its timeout.
   */
  async receive(providerId: string, delivery: WebhookDelivery) {
    const provider = this.provider(providerId);
    if (!provider.webhooksConfigured()) {
      Logger.warn(
        `A ${providerId} webhook arrived but its webhook secret isn't set; ignored (polling still runs)`,
        'PaymentWebhook',
      );
      throw new BillingException(
        HttpStatus.SERVICE_UNAVAILABLE,
        BillingErrorCode.PAYMENTS_UNAVAILABLE,
        'Webhooks are not configured.',
      );
    }
    if (
      !delivery.rawBody?.length ||
      !provider.verifyWebhook(delivery.rawBody, delivery.signature || '')
    ) {
      Logger.warn(
        `Rejected a ${providerId} webhook with a bad signature`,
        'PaymentWebhook',
      );
      throw new BillingException(
        HttpStatus.BAD_REQUEST,
        BillingErrorCode.PAYMENT_VERIFICATION_FAILED,
        'The webhook signature is not valid.',
      );
    }

    const event = provider.parseWebhook(delivery.body);
    if (!event.relevant) return { received: true, status: 'SKIPPED' };

    const eventId =
      delivery.eventId?.trim() ||
      `sha256:${createHash('sha256').update(delivery.rawBody).digest('hex')}`;
    const stored = await this.record(provider.id, eventId, event, delivery);
    if (DONE.includes(stored.status)) {
      return { received: true, status: stored.status, duplicate: true };
    }

    const order = await this.findOrder(provider.id, event);
    if (!order) {
      // Another environment's order on a shared Razorpay account, or a link
      // made outside the dashboard.
      await this.finish(stored._id, WebhookEventStatus.IGNORED, {
        error: 'ORDER_NOT_FOUND',
      });
      return { received: true, status: WebhookEventStatus.IGNORED };
    }
    const orderId = String(order._id);
    await this.eventModel.updateOne({ _id: stored._id }, { $set: { orderId } });

    // Not awaited: the response goes out now. A failure here is logged and
    // left to the reconciliation job.
    this.process(String(stored._id), orderId).catch((error) =>
      Logger.error(
        `Webhook ${eventId}: ${error?.message}`,
        error?.stack,
        'PaymentWebhook',
      ),
    );
    return { received: true, status: WebhookEventStatus.RECEIVED };
  }

  /** Syncs the order, retrying while another sync holds it. */
  async process(eventDocId: string, orderId: string) {
    for (let attempt = 1; attempt <= BUSY_TRIES; attempt++) {
      let ran: boolean;
      try {
        ran = await this.orders.sync(orderId);
      } catch (error) {
        Logger.warn(
          `Webhook sync of order ${orderId} failed; the reconciliation job will retry: ${error?.message}`,
          'PaymentWebhook',
        );
        return this.finish(eventDocId, WebhookEventStatus.FAILED, {
          error: String(error?.message || error).slice(0, 500),
        });
      }
      if (ran) return this.finish(eventDocId, WebhookEventStatus.PROCESSED);
      if (attempt < BUSY_TRIES) await this.wait(BUSY_RETRY_MS);
    }
    return this.finish(eventDocId, WebhookEventStatus.FAILED, {
      error: 'ORDER_BUSY',
    });
  }

  /** Overridden in tests. */
  protected wait(ms: number) {
    return new Promise((done) => setTimeout(done, ms));
  }

  private provider(providerId: string): PaymentProvider {
    try {
      return this.router.get(providerId);
    } catch {
      throw new BillingException(
        HttpStatus.NOT_FOUND,
        BillingErrorCode.PAYMENTS_UNAVAILABLE,
        'Unknown payment provider.',
      );
    }
  }

  /** Inserts the event; a redelivery bumps `attempts` on the first one. */
  private async record(
    provider: string,
    eventId: string,
    event: PaymentWebhookEvent,
    delivery: WebhookDelivery,
  ) {
    try {
      return (
        await this.eventModel.create({
          provider,
          eventId,
          type: event.type,
          status: WebhookEventStatus.RECEIVED,
          attempts: 1,
          receivedAt: new Date(),
          payload: delivery.body as Record<string, unknown>,
        })
      ).toObject();
    } catch (error) {
      if (error?.code !== 11000) throw error;
      const existing = await this.eventModel
        .findOneAndUpdate(
          { provider, eventId },
          { $inc: { attempts: 1 } },
          { new: true },
        )
        .lean();
      if (!existing) throw error;
      return existing;
    }
  }

  private async findOrder(provider: string, event: PaymentWebhookEvent) {
    const or: Record<string, unknown>[] = [];
    if (event.linkId) or.push({ 'paymentLink.linkId': event.linkId });
    if (event.providerOrderIds.length) {
      or.push({ providerOrderId: { $in: event.providerOrderIds } });
    }
    if (event.orderId && Types.ObjectId.isValid(event.orderId)) {
      or.push({ _id: new Types.ObjectId(event.orderId) });
    }
    if (!or.length) return null;
    return this.orderModel.findOne({ provider, $or: or }, { _id: 1 }).lean();
  }

  private async finish(
    eventDocId: unknown,
    status: WebhookEventStatus,
    extra: { error?: string } = {},
  ) {
    await this.eventModel.updateOne(
      { _id: eventDocId },
      {
        $set: {
          status,
          processedAt: new Date(),
          error: extra.error ?? null,
        },
      },
    );
  }
}
