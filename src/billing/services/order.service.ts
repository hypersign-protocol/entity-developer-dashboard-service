import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { redisClient } from 'src/utils/redis.provider';
import { BillingErrorCode, BillingRegion } from '../billing.constants';
import { BillingException } from '../billing.exception';
import {
  NormalizedPayment,
  PaymentLinkState,
} from '../payments/payment-provider';
import { PaymentRouter } from '../payments/payment-router';
import {
  BillingCounter,
  BillingCounterDocument,
} from '../schemas/invoice.schema';
import {
  Order,
  OrderDocument,
  OrderStatus,
  PaymentAttempt,
  PaymentAttemptDocument,
} from '../schemas/order.schema';
import { Quote, QuoteDocument } from '../schemas/quote.schema';
import { indiaGst, supplierStateCode, TaxLine } from '../tax/india-gst';
import {
  BillingAccount,
  BillingAccountService,
} from './billing-account.service';
import { CatalogService } from './catalog.service';
import {
  CouponNotAvailable,
  CouponReservationService,
} from './coupon-reservation.service';
import { InvoiceService } from './invoice.service';

const MINUTE = 60 * 1000;
export const ORDER_TTL_MS = 30 * MINUTE; // how long Pay is offered for an order
const POLL_SYNC_EVERY_MS = 5 * 1000; // GET re-checks the provider at most this often
const SYNC_LOCK_MS = 30 * 1000;
// Reconciliation (no webhooks yet): what it re-checks, and how often.
const RECHECK_PENDING_AFTER_MS = 2 * MINUTE;
const RECHECK_LINK_AFTER_MS = 15 * MINUTE; // payment links stay open for days
const FAIL_UNSTARTED_AFTER_MS = 15 * MINUTE;
const LATE_PAYMENT_WINDOW_MS = 3 * 24 * 60 * MINUTE; // uncaptured payments are refunded after 3 days
const RECHECK_CLOSED_AFTER_MS = 30 * MINUTE;
const RECONCILE_BATCH = 100;

// A captured payment on any of these still pays the order: the money was taken.
const PAYABLE = [
  OrderStatus.PENDING_PAYMENT,
  OrderStatus.EXPIRED,
  OrderStatus.CANCELLED,
];

export type StoredOrder = Order & { _id: Types.ObjectId };

const orderNotFound = () =>
  new BillingException(
    HttpStatus.NOT_FOUND,
    BillingErrorCode.ORDER_NOT_FOUND,
    'Order not found.',
  );
const quoteExpired = (reason: string) =>
  new BillingException(
    HttpStatus.CONFLICT,
    BillingErrorCode.QUOTE_EXPIRED,
    'The price has changed or expired. Please review the new total.',
    { reason },
  );
const paymentsUnavailable = () =>
  new BillingException(
    HttpStatus.SERVICE_UNAVAILABLE,
    BillingErrorCode.PAYMENTS_UNAVAILABLE,
    'Payments are temporarily unavailable. Please try again.',
  );

// Self-serve checkout (ADR §4.5, §6.1). Without webhooks, the provider's API is
// the source of truth: confirm, polling and the reconciliation job all call
// sync(), the only place that decides what a payment means.
@Injectable()
export class OrderService {
  constructor(
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    @InjectModel(PaymentAttempt.name)
    private readonly attemptModel: Model<PaymentAttemptDocument>,
    @InjectModel(Quote.name) private readonly quoteModel: Model<QuoteDocument>,
    @InjectModel(BillingCounter.name)
    private readonly counterModel: Model<BillingCounterDocument>,
    private readonly accounts: BillingAccountService,
    private readonly catalog: CatalogService,
    private readonly coupons: CouponReservationService,
    private readonly invoices: InvoiceService,
    private readonly router: PaymentRouter,
  ) {}

  /** POST /billing/orders: an order for a quote, ready for the checkout. */
  async create(
    account: BillingAccount,
    quoteId: string,
    createdBy: string,
    idempotencyKey: string,
  ) {
    const key = idempotencyKey?.trim();
    if (!key) {
      throw new BillingException(
        HttpStatus.BAD_REQUEST,
        BillingErrorCode.VALIDATION_FAILED,
        'The Idempotency-Key header is required.',
        { fields: { 'Idempotency-Key': 'Required' } },
      );
    }
    const previous = await this.orderModel
      .findOne({ orgId: account.orgId, idempotencyKey: key })
      .lean();
    if (previous) return this.resume(previous, quoteId);

    const provider = this.router.forRegion(account.region);
    if (!provider?.isConfigured()) throw paymentsUnavailable();
    this.invoices.assertConfigured(); // never take money we can't invoice
    if (!account.profile.complete) {
      throw new BillingException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        BillingErrorCode.BILLING_PROFILE_INCOMPLETE,
        'Complete your billing details first.',
        {
          missingFields: account.profile.missingFields,
          source: account.profile.source,
        },
      );
    }

    const now = new Date();
    const quote = await this.quoteModel
      .findOne({ _id: quoteId, orgId: account.orgId })
      .lean();
    if (!quote || quote.expiresAt <= now) throw quoteExpired('QUOTE_EXPIRED');
    if (quote.region !== account.region) throw quoteExpired('REGION_CHANGED');
    const book = await this.catalog.getPublishedBook(account.region);
    if (String(book._id) !== quote.priceBookId) {
      throw quoteExpired('PRICES_CHANGED');
    }
    const app = await this.accounts.assertBillableApp(quote.appId, account);

    // Tax from the billing details as they are now; the invoice prints the same.
    let tax: TaxLine[] = [];
    let taxMinor = 0;
    if (account.region === BillingRegion.IN) {
      const gst = indiaGst(
        quote.lines.totalBeforeTaxMinor,
        account.profile.gstStateCode,
        supplierStateCode(),
      );
      tax = gst.lines;
      taxMinor = gst.amountMinor;
    }
    const amountMinor = quote.lines.totalBeforeTaxMinor + taxMinor;
    if (amountMinor !== quote.lines.totalMinor) {
      throw quoteExpired('TAX_CHANGED');
    }

    const orderId = new Types.ObjectId();
    let order: StoredOrder;
    try {
      order = (
        await this.orderModel.create({
          _id: orderId,
          orderNumber: await this.nextOrderNumber(now),
          orgId: account.orgId,
          appId: app.appId,
          appName: app.appName,
          createdBy,
          idempotencyKey: key,
          quoteId,
          quote: {
            selection: quote.selection,
            lines: quote.lines,
            credits: quote.credits,
            validityDays: quote.validityDays,
            priceBookId: quote.priceBookId,
            priceBookVersion: quote.priceBookVersion,
          },
          customer: account.profile,
          tax,
          region: account.region,
          currency: account.currency,
          amountMinor,
          status: OrderStatus.CREATED,
          provider: provider.id,
          expiresAt: new Date(now.getTime() + ORDER_TTL_MS),
        })
      ).toObject();
    } catch (error) {
      if (error?.code !== 11000) throw error;
      // The same key, sent twice at once: answer with the first order.
      const first = await this.orderModel
        .findOne({ orgId: account.orgId, idempotencyKey: key })
        .lean();
      if (!first) throw error;
      return this.resume(first, quoteId);
    }

    if (quote.lines.coupon) {
      try {
        await this.coupons.reserve({
          couponId: quote.lines.coupon.couponId,
          orderId: String(orderId),
          account,
          discountMinor: quote.lines.coupon.amountMinor,
          until: order.expiresAt,
        });
      } catch (error) {
        if (!(error instanceof CouponNotAvailable)) throw error;
        await this.orderModel.updateOne(
          { _id: orderId, status: OrderStatus.CREATED },
          {
            $set: {
              status: OrderStatus.FAILED,
              failureReason: 'COUPON_INVALID',
            },
          },
        );
        Logger.log(
          `Order ${order.orderNumber}: coupon ${quote.lines.coupon.code} refused (${error.reason})`,
          'OrderService',
        );
        throw new BillingException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          BillingErrorCode.COUPON_INVALID,
          'This coupon code is not valid.',
        );
      }
    }
    return this.resume(order, quoteId);
  }

  /** A retried key returns its order; an order without a provider order gets one. */
  private async resume(order: StoredOrder, quoteId: string) {
    if (order.quoteId !== quoteId) {
      throw new BillingException(
        HttpStatus.CONFLICT,
        BillingErrorCode.IDEMPOTENCY_KEY_REUSED,
        'This Idempotency-Key was used for a different order.',
      );
    }
    if (order.status !== OrderStatus.CREATED) return this.view(order);

    const provider = this.router.get(order.provider);
    let providerOrderId: string;
    try {
      ({ providerOrderId } = await provider.createOrder({
        amountMinor: order.amountMinor,
        currency: order.currency,
        receipt: order.orderNumber,
        notes: {
          orderId: String(order._id),
          orderNumber: order.orderNumber,
          orgId: order.orgId,
          appId: order.appId,
        },
      }));
    } catch (error) {
      // Stays CREATED: a retry with the same key tries again, and the
      // reconciliation job fails it (and frees the coupon) after 15 minutes.
      Logger.error(
        `Order ${order.orderNumber}: ${provider.id} order not created: ${error?.message}`,
        'OrderService',
      );
      throw paymentsUnavailable();
    }
    const updated = await this.orderModel
      .findOneAndUpdate(
        { _id: order._id, status: OrderStatus.CREATED },
        { $set: { status: OrderStatus.PENDING_PAYMENT, providerOrderId } },
        { new: true },
      )
      .lean();
    return this.view(
      updated || (await this.orderModel.findById(order._id).lean()),
    );
  }

  /** POST /billing/orders/:id/confirm: the checkout's success handler. */
  async confirm(
    orgId: string,
    orderId: string,
    proof: { providerOrderId: string; paymentId: string; signature: string },
  ) {
    const order = await this.find(orgId, orderId);
    if (!order.providerOrderId) {
      throw new BillingException(
        HttpStatus.CONFLICT,
        BillingErrorCode.ORDER_NOT_PAYABLE,
        'This order has no payment to confirm.',
      );
    }
    const valid =
      proof.providerOrderId === order.providerOrderId &&
      this.router.get(order.provider).verifyCheckout({
        providerOrderId: order.providerOrderId, // ours, not the browser's
        paymentId: proof.paymentId,
        signature: proof.signature,
      });
    if (!valid) {
      Logger.warn(
        `Order ${order.orderNumber}: checkout proof for payment ${proof.paymentId} failed verification`,
        'OrderService',
      );
      throw new BillingException(
        HttpStatus.BAD_REQUEST,
        BillingErrorCode.PAYMENT_VERIFICATION_FAILED,
        'We could not verify this payment.',
      );
    }
    // A valid proof only says the browser saw a payment: the provider's API
    // decides, with the amount and currency checked.
    await this.sync(String(order._id));
    return this.view(await this.orderModel.findById(order._id).lean());
  }

  /** GET /billing/orders/:id, polled by the dashboard. */
  async get(orgId: string, orderId: string) {
    let order = await this.find(orgId, orderId);
    const open =
      order.status === OrderStatus.PENDING_PAYMENT ||
      order.status === OrderStatus.PAID;
    const due =
      !order.lastSyncedAt ||
      Date.now() - new Date(order.lastSyncedAt).getTime() >= POLL_SYNC_EVERY_MS;
    if (open && due) {
      await this.sync(String(order._id)).catch((error) =>
        Logger.warn(
          `Order ${order.orderNumber}: sync failed: ${error?.message}`,
          'OrderService',
        ),
      );
      order = await this.orderModel.findById(order._id).lean();
    }
    return this.view(order);
  }

  /** POST /billing/orders/:id/cancel. A payment that went through still counts. */
  async cancel(orgId: string, orderId: string) {
    const order = await this.find(orgId, orderId);
    if (
      [
        OrderStatus.PAID,
        OrderStatus.FULFILLED,
        OrderStatus.NEEDS_REVIEW,
      ].includes(order.status)
    ) {
      throw new BillingException(
        HttpStatus.CONFLICT,
        BillingErrorCode.ORDER_NOT_CANCELLABLE,
        'This order has been paid.',
      );
    }
    if (order.status === OrderStatus.PENDING_PAYMENT) {
      await this.sync(String(order._id));
    }
    const cancelled = await this.orderModel.updateOne(
      {
        _id: order._id,
        status: { $in: [OrderStatus.CREATED, OrderStatus.PENDING_PAYMENT] },
      },
      { $set: { status: OrderStatus.CANCELLED } },
    );
    if (cancelled.modifiedCount) await this.coupons.release(String(order._id));
    return this.view(await this.orderModel.findById(order._id).lean());
  }

  /**
   * Reads the order's payments from the provider and moves the order on.
   * Serialised per order, so confirm, polling and the job never race.
   */
  async sync(orderId: string): Promise<void> {
    const lockKey = `billing:order-sync:${orderId}`;
    const locked = await redisClient.set(
      lockKey,
      '1',
      'PX',
      SYNC_LOCK_MS,
      'NX',
    );
    if (!locked) return; // another sync is on it
    try {
      await this.syncLocked(orderId);
    } finally {
      await redisClient.del(lockKey);
    }
  }

  private async syncLocked(orderId: string) {
    const order = await this.orderModel.findById(orderId).lean();
    if (!order) return;
    if (order.status === OrderStatus.PAID) return this.fulfil(order);
    if (!PAYABLE.includes(order.status)) return;

    const provider = this.router.get(order.provider);
    let providerOrderId = order.providerOrderId;
    // A payment link gets its provider order once someone starts paying.
    let link: PaymentLinkState | null = null;
    if (order.paymentLink?.linkId) {
      link = await provider.fetchPaymentLink(order.paymentLink.linkId);
      if (link.providerOrderId && link.providerOrderId !== providerOrderId) {
        providerOrderId = link.providerOrderId;
        await this.orderModel.updateOne(
          { _id: order._id },
          { $set: { providerOrderId } },
        );
      }
    }
    if (!providerOrderId && !link) return;

    const payments: NormalizedPayment[] = [];
    const fetched = providerOrderId
      ? await provider.fetchPayments(providerOrderId)
      : [];
    for (const payment of fetched) {
      if (payment.status !== 'AUTHORIZED') {
        payments.push(payment);
        continue;
      }
      // Automatic capture should have done this. Uncaptured, it's refunded in 3 days.
      try {
        payments.push(await provider.capture(payment));
      } catch (error) {
        Logger.error(
          `Order ${order.orderNumber}: capture of ${payment.paymentId} failed: ${error?.message}`,
          'OrderService',
        );
        payments.push(payment);
      }
    }
    await this.recordAttempts(order, payments);
    const now = new Date();

    const captured = payments
      .filter((p) => p.status === 'CAPTURED')
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    if (captured.length) {
      if (captured.length > 1) {
        Logger.error(
          `Order ${order.orderNumber} has ${captured.length} captured payments; refund all but ${captured[0].paymentId}`,
          'OrderService',
        );
      }
      const p = captured[0];
      const payment = {
        paymentId: p.paymentId,
        method: p.method,
        amountMinor: p.amountMinor,
        currency: p.currency,
        paidAt: p.createdAt,
      };
      if (
        p.amountMinor !== order.amountMinor ||
        p.currency !== order.currency
      ) {
        await this.orderModel.updateOne(
          { _id: order._id, status: { $in: PAYABLE } },
          {
            $set: {
              status: OrderStatus.NEEDS_REVIEW,
              failureReason: 'AMOUNT_MISMATCH',
              payment,
              lastSyncedAt: now,
            },
          },
        );
        Logger.error(
          `Order ${order.orderNumber}: paid ${p.currency} ${p.amountMinor}, expected ${order.currency} ${order.amountMinor}. Needs review`,
          'OrderService',
        );
        return;
      }
      const paid = await this.orderModel
        .findOneAndUpdate(
          { _id: order._id, status: { $in: PAYABLE } },
          { $set: { status: OrderStatus.PAID, payment, lastSyncedAt: now } },
          { new: true },
        )
        .lean();
      if (!paid) return;
      if (order.status !== OrderStatus.PENDING_PAYMENT) {
        Logger.warn(
          `Order ${order.orderNumber} paid after it was ${order.status}; fulfilling`,
          'OrderService',
        );
      }
      return this.fulfil(paid);
    }

    const lastFailure = payments
      .filter((p) => p.status === 'FAILED')
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    const set = {
      lastSyncedAt: now,
      ...(lastFailure && {
        lastPaymentError: {
          code: lastFailure.errorCode,
          description: lastFailure.errorDescription,
        },
      }),
    };
    // A payment still in progress (UPI waiting for approval) keeps it open.
    const inProgress = payments.some(
      (p) => p.status === 'CREATED' || p.status === 'AUTHORIZED',
    );
    const closedByProvider =
      link?.status === 'EXPIRED' || link?.status === 'CANCELLED';
    if (
      order.status === OrderStatus.PENDING_PAYMENT &&
      (now >= new Date(order.expiresAt) || closedByProvider) &&
      !inProgress
    ) {
      const expired = await this.orderModel.updateOne(
        { _id: order._id, status: OrderStatus.PENDING_PAYMENT },
        {
          $set: {
            ...set,
            status:
              link?.status === 'CANCELLED'
                ? OrderStatus.CANCELLED
                : OrderStatus.EXPIRED,
          },
        },
      );
      if (expired.modifiedCount) await this.coupons.release(String(order._id));
      return;
    }
    await this.orderModel.updateOne({ _id: order._id }, { $set: set });
  }

  /** Invoice, credits, coupon, then FULFILLED. A failure leaves it PAID for the job. */
  private async fulfil(order: StoredOrder) {
    try {
      const { invoice, creditsActive } = await this.invoices.issueForOrder(
        order,
      );
      await this.coupons.redeem(String(order._id));
      await this.orderModel.updateOne(
        { _id: order._id, status: OrderStatus.PAID },
        {
          $set: {
            status: OrderStatus.FULFILLED,
            invoiceId: String(invoice._id),
            invoiceNumber: invoice.invoiceNumber,
            creditPlanId: invoice.creditPlanId,
            ...(creditsActive && { creditsActive }),
            failureReason: null,
          },
        },
      );
      Logger.log(
        `Order ${order.orderNumber} fulfilled: ${invoice.invoiceNumber}, ${order.quote.credits} credits`,
        'OrderService',
      );
    } catch (error) {
      Logger.error(
        `Order ${order.orderNumber} is paid but not fulfilled yet (will retry): ${error?.message}`,
        error?.stack,
        'OrderService',
      );
    }
  }

  private async recordAttempts(
    order: StoredOrder,
    payments: NormalizedPayment[],
  ) {
    if (!payments.length) return;
    await this.attemptModel.bulkWrite(
      payments.map((p) => ({
        updateOne: {
          filter: { provider: order.provider, providerPaymentId: p.paymentId },
          update: {
            $set: {
              orderId: String(order._id),
              status: p.status,
              amountMinor: p.amountMinor,
              currency: p.currency,
              method: p.method,
              international: p.international,
              errorCode: p.errorCode,
              errorDescription: p.errorDescription,
              attemptedAt: p.createdAt,
            },
          },
          upsert: true,
        },
      })),
    );
  }

  /** Run by the reconciliation job every few minutes (ADR §5.4). */
  async reconcile() {
    const now = Date.now();
    const notSyncedSince = (ms: number) => ({
      $or: [
        { lastSyncedAt: null },
        { lastSyncedAt: { $lt: new Date(now - ms) } },
      ],
    });

    const unstarted = await this.orderModel
      .find(
        {
          status: OrderStatus.CREATED,
          createdAt: { $lt: new Date(now - FAIL_UNSTARTED_AFTER_MS) },
        },
        { _id: 1 },
      )
      .limit(RECONCILE_BATCH)
      .lean();
    for (const { _id } of unstarted) {
      const failed = await this.orderModel.updateOne(
        { _id, status: OrderStatus.CREATED },
        {
          $set: {
            status: OrderStatus.FAILED,
            failureReason: 'CHECKOUT_NOT_CREATED',
          },
        },
      );
      if (failed.modifiedCount) await this.coupons.release(String(_id));
    }

    const toSync = await this.orderModel
      .find(
        {
          $or: [
            { status: OrderStatus.PAID },
            {
              status: OrderStatus.PENDING_PAYMENT,
              source: { $ne: 'ADMIN' },
              ...notSyncedSince(RECHECK_PENDING_AFTER_MS),
            },
            {
              status: OrderStatus.PENDING_PAYMENT,
              source: 'ADMIN',
              ...notSyncedSince(RECHECK_LINK_AFTER_MS),
            },
            {
              // Late payments on closed orders, while the provider can still capture.
              status: { $in: [OrderStatus.EXPIRED, OrderStatus.CANCELLED] },
              providerOrderId: { $type: 'string' },
              createdAt: { $gt: new Date(now - LATE_PAYMENT_WINDOW_MS) },
              ...notSyncedSince(RECHECK_CLOSED_AFTER_MS),
            },
          ],
        },
        { _id: 1 },
      )
      .sort({ lastSyncedAt: 1 })
      .limit(RECONCILE_BATCH)
      .lean();
    for (const { _id } of toSync) {
      await this.sync(String(_id)).catch((error) =>
        Logger.warn(
          `Reconciliation of order ${_id} failed: ${error?.message}`,
          'OrderService',
        ),
      );
    }
    return { failed: unstarted.length, synced: toSync.length };
  }

  private async find(orgId: string, orderId: string) {
    const order = Types.ObjectId.isValid(orderId)
      ? await this.orderModel
          .findOne({ _id: orderId, orgId, source: { $ne: 'ADMIN' } })
          .lean()
      : null;
    if (!order) throw orderNotFound();
    return order;
  }

  async nextOrderNumber(now: Date) {
    const year = now.getUTCFullYear();
    const counter = await this.counterModel.findOneAndUpdate(
      { _id: `ORD/${year}` },
      { $inc: { seq: 1 } },
      { upsert: true, new: true },
    );
    return `ORD-${year}-${String(counter.seq).padStart(6, '0')}`;
  }

  /** The Order object of docs/payment/api-contract.md §6. */
  view(order: StoredOrder) {
    const payable =
      order.status === OrderStatus.PENDING_PAYMENT &&
      Date.now() < new Date(order.expiresAt).getTime();
    const credits = order.quote.credits;
    return {
      orderId: String(order._id),
      orderNumber: order.orderNumber,
      status: order.status,
      appId: order.appId,
      appName: order.appName,
      currency: order.currency,
      totalMinor: order.amountMinor,
      credits,
      validityDays: order.quote.validityDays,
      expiresAt: order.expiresAt,
      checkout: payable
        ? {
            ...this.router.get(order.provider).checkoutOptions({
              providerOrderId: order.providerOrderId,
              amountMinor: order.amountMinor,
              currency: order.currency,
            }),
            name: process.env.BILLING_CHECKOUT_NAME?.trim() || 'Hypersign',
            description: `${credits.toLocaleString('en-IN')} credits for ${
              order.appName
            }`,
            prefill: {
              name: order.customer.legalName,
              email: order.customer.email,
            },
          }
        : null,
      payment: order.payment
        ? {
            paymentId: order.payment.paymentId,
            method: order.payment.method,
            paidAt: order.payment.paidAt,
          }
        : null,
      lastPaymentError: order.lastPaymentError ?? null,
      invoice: order.invoiceId
        ? { invoiceId: order.invoiceId, invoiceNumber: order.invoiceNumber }
        : null,
      creditPlanId: order.creditPlanId ?? null,
      creditsActive: order.creditsActive ?? null,
      failureReason: order.failureReason ?? null,
    };
  }
}
