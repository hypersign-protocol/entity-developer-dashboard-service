import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  CustomerOnboarding,
  CustomerOnboardingDocument,
} from 'src/customer-onboarding/schemas/customer-onboarding.schema';
import {
  BillingErrorCode,
  BillingRegion,
  formatCount,
  isPayEnabled,
  REGION_TAX_MODE,
} from '../billing.constants';
import { BillingException } from '../billing.exception';
import {
  AdminInvoiceDto,
  PaymentLinkListQueryDto,
} from '../dto/admin-invoice.dto';
import { PaymentRouter } from '../payments/payment-router';
import { Order, OrderDocument, OrderStatus } from '../schemas/order.schema';
import { InvoiceService } from './invoice.service';
import { OrderService, StoredOrder } from './order.service';

const DAY = 24 * 60 * 60 * 1000;
const DEFAULT_LINK_DAYS = 15;
const GET_SYNC_EVERY_MS = 5 * 1000;
const MAX_PAGE_SIZE = 100;

const notFound = () =>
  new BillingException(
    HttpStatus.NOT_FOUND,
    BillingErrorCode.ORDER_NOT_FOUND,
    'Payment link not found.',
  );

// Super-admin Collect payment (docs/payment/api-contract.md §7). A payment
// link is an ADMIN order: no invoice is issued until Razorpay reports the
// payment captured, then OrderService fulfils it like a self-serve order
// (invoice, credits). Expired or voided links leave nothing to reverse.
@Injectable()
export class PaymentLinkService {
  constructor(
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    @InjectModel(CustomerOnboarding.name)
    private readonly onboardingModel: Model<CustomerOnboardingDocument>,
    private readonly invoices: InvoiceService,
    private readonly orders: OrderService,
    private readonly router: PaymentRouter,
  ) {}

  /** POST /admin/billing/invoices with isPaid false. */
  async create(
    dto: AdminInvoiceDto,
    adminUserId: string,
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
    const draft = await this.invoices.paymentLinkDraft(dto);
    const notifyByEmail = dto.notifyByEmail ?? true;
    const sendTo = dto.notifyEmail?.trim() || draft.profile.email;
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          appId: dto.appId,
          credits: dto.credits,
          validityDays: dto.validityDays,
          amountMinor: dto.amountMinor,
          notifyByEmail,
          sendTo,
          linkExpiresInDays: dto.linkExpiresInDays ?? DEFAULT_LINK_DAYS,
        }),
      )
      .digest('hex');

    const previous = await this.orderModel
      .findOne({ orgId: draft.org.orgId, idempotencyKey: key })
      .lean();
    if (previous) return this.resume(previous, requestHash);

    const region = draft.profile.region as BillingRegion;
    const provider = this.router.forRegion(region);
    if (!isPayEnabled(region) || !provider?.isConfigured()) {
      throw new BillingException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        BillingErrorCode.PAYMENTS_NOT_AVAILABLE,
        "Collect payment isn't available for this customer's region yet.",
      );
    }

    const now = new Date();
    const { tax, totals } = draft;
    let order: StoredOrder;
    try {
      order = (
        await this.orderModel.create({
          source: 'ADMIN',
          orderNumber: await this.orders.nextOrderNumber(now),
          orgId: draft.org.orgId,
          appId: draft.app.appId,
          appName: draft.app.appName,
          createdBy: adminUserId,
          idempotencyKey: key,
          requestHash,
          note: dto.note?.trim() || undefined,
          quote: {
            selection: null,
            lines: {
              subtotalMinor: dto.amountMinor,
              planDiscount: { percentBps: 0, amountMinor: 0, ruleId: null },
              coupon: null,
              addOns: draft.addOnLines.map((a) => ({ ...a, priceMinor: 0 })),
              totalBeforeTaxMinor: dto.amountMinor,
              tax: {
                mode: REGION_TAX_MODE[region],
                amountMinor: totals.taxMinor,
                lines: tax,
              },
              totalMinor: totals.totalMinor,
            },
            credits: dto.credits,
            validityDays: dto.validityDays,
            priceBookId: null,
            priceBookVersion: null,
          },
          customer: draft.profile,
          tax,
          region,
          currency: draft.profile.currency,
          amountMinor: totals.totalMinor,
          status: OrderStatus.CREATED,
          provider: provider.id,
          expiresAt: new Date(
            now.getTime() + (dto.linkExpiresInDays ?? DEFAULT_LINK_DAYS) * DAY,
          ),
          paymentLink: {
            linkId: null,
            url: null,
            notifyByEmail,
            sentTo: notifyByEmail ? sendTo : null,
            lastSentAt: null,
          },
        })
      ).toObject();
    } catch (error) {
      if (error?.code !== 11000) throw error;
      const first = await this.orderModel
        .findOne({ orgId: draft.org.orgId, idempotencyKey: key })
        .lean();
      if (!first) throw error;
      return this.resume(first, requestHash);
    }
    return this.resume(order, requestHash);
  }

  /** A retried key returns its link; a link the provider didn't create yet is retried. */
  private async resume(order: StoredOrder, requestHash: string) {
    if (order.source !== 'ADMIN' || order.requestHash !== requestHash) {
      throw new BillingException(
        HttpStatus.CONFLICT,
        BillingErrorCode.IDEMPOTENCY_KEY_REUSED,
        'This Idempotency-Key was used for a different request.',
      );
    }
    if (order.status === OrderStatus.CREATED) {
      const provider = this.router.get(order.provider);
      let link: { linkId: string; url: string };
      try {
        link = await provider.createPaymentLink({
          amountMinor: order.amountMinor,
          currency: order.currency,
          // Unique across databases sharing one Razorpay account; order
          // numbers restart per database and Razorpay rejects a reused reference_id.
          referenceId: String(order._id),
          description: `${formatCount(
            order.quote.credits,
            order.currency,
          )} verification credits for ${order.appName} (${order.orderNumber})`,
          customer: {
            name: order.customer.legalName,
            email: order.paymentLink.sentTo || order.customer.email,
            ...(order.customer.phone && { contact: order.customer.phone }),
          },
          notifyByEmail: order.paymentLink.notifyByEmail,
          expiresAt: new Date(order.expiresAt),
          notes: {
            orderId: String(order._id),
            orderNumber: order.orderNumber,
            orgId: order.orgId,
            appId: order.appId,
          },
        });
      } catch (error) {
        // Stays CREATED: a retry with the same key tries again; the
        // reconciliation job fails it after 15 minutes.
        Logger.error(
          `Payment link for ${order.orderNumber} not created: ${error?.message}`,
          'PaymentLinkService',
        );
        throw new BillingException(
          HttpStatus.SERVICE_UNAVAILABLE,
          BillingErrorCode.PAYMENTS_UNAVAILABLE,
          'The payment link could not be created. Please try again.',
        );
      }
      const now = new Date();
      order =
        (await this.orderModel
          .findOneAndUpdate(
            { _id: order._id, status: OrderStatus.CREATED },
            {
              $set: {
                status: OrderStatus.PENDING_PAYMENT,
                'paymentLink.linkId': link.linkId,
                'paymentLink.url': link.url,
                'paymentLink.lastSentAt': order.paymentLink.notifyByEmail
                  ? now
                  : null,
              },
            },
            { new: true },
          )
          .lean()) || (await this.orderModel.findById(order._id).lean());
      Logger.log(
        `Payment link ${order.orderNumber} created by ${order.createdBy} for app ${order.appId}`,
        'PaymentLinkService',
      );
    }
    return { invoice: null, paymentLink: await this.adminView(order) };
  }

  /** POST /admin/billing/payment-links/:id/cancel (Void). A payment that went through still counts. */
  async cancel(orderId: string, adminUserId: string, reason: string) {
    let order = await this.findAdmin(orderId);
    if (order.status === OrderStatus.PENDING_PAYMENT) {
      await this.orders.sync(String(order._id));
      order = await this.orderModel.findById(order._id).lean();
    }
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
        'This payment link has been paid.',
      );
    }
    if (
      order.status === OrderStatus.PENDING_PAYMENT &&
      order.paymentLink?.linkId
    ) {
      try {
        await this.router
          .get(order.provider)
          .cancelPaymentLink(order.paymentLink.linkId);
      } catch (error) {
        Logger.error(
          `Payment link ${order.orderNumber} not cancelled: ${error?.message}`,
          'PaymentLinkService',
        );
        throw new BillingException(
          HttpStatus.SERVICE_UNAVAILABLE,
          BillingErrorCode.PAYMENTS_UNAVAILABLE,
          'The payment link could not be cancelled. Please try again.',
        );
      }
    }
    await this.orderModel.updateOne(
      {
        _id: order._id,
        status: { $in: [OrderStatus.CREATED, OrderStatus.PENDING_PAYMENT] },
      },
      {
        $set: {
          status: OrderStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledBy: adminUserId,
          cancelReason: reason.trim(),
        },
      },
    );
    Logger.log(
      `Payment link ${order.orderNumber} voided by ${adminUserId}: ${reason}`,
      'PaymentLinkService',
    );
    return this.adminView(await this.orderModel.findById(order._id).lean());
  }

  /** POST /admin/billing/payment-links/:id/resend: Razorpay emails the link again. */
  async resend(orderId: string) {
    const order = await this.findAdmin(orderId);
    const open =
      order.status === OrderStatus.PENDING_PAYMENT &&
      order.paymentLink?.linkId &&
      Date.now() < new Date(order.expiresAt).getTime();
    if (!open) {
      throw new BillingException(
        HttpStatus.CONFLICT,
        BillingErrorCode.ORDER_NOT_PAYABLE,
        'Only an open payment link can be sent again.',
      );
    }
    try {
      await this.router
        .get(order.provider)
        .resendPaymentLink(order.paymentLink.linkId);
    } catch (error) {
      Logger.error(
        `Payment link ${order.orderNumber} not resent: ${error?.message}`,
        'PaymentLinkService',
      );
      throw new BillingException(
        HttpStatus.SERVICE_UNAVAILABLE,
        BillingErrorCode.PAYMENTS_UNAVAILABLE,
        'The payment link could not be sent. Please try again.',
      );
    }
    const updated = await this.orderModel
      .findOneAndUpdate(
        { _id: order._id },
        {
          $set: {
            'paymentLink.lastSentAt': new Date(),
            'paymentLink.sentTo':
              order.paymentLink.sentTo || order.customer.email,
          },
        },
        { new: true },
      )
      .lean();
    return this.adminView(updated);
  }

  /** GET /admin/billing/payment-links/:id, re-checked with Razorpay while open. */
  async get(orderId: string) {
    let order = await this.findAdmin(orderId);
    const open =
      order.status === OrderStatus.PENDING_PAYMENT ||
      order.status === OrderStatus.PAID;
    const due =
      !order.lastSyncedAt ||
      Date.now() - new Date(order.lastSyncedAt).getTime() >= GET_SYNC_EVERY_MS;
    if (open && due) {
      await this.orders
        .sync(String(order._id))
        .catch((error) =>
          Logger.warn(
            `Payment link ${order.orderNumber}: sync failed: ${error?.message}`,
            'PaymentLinkService',
          ),
        );
      order = await this.orderModel.findById(order._id).lean();
    }
    return this.adminView(order);
  }

  /** GET /admin/billing/payment-links: every organisation, newest first. */
  async list(query: PaymentLinkListQueryDto) {
    const filter: FilterQuery<Order> = { source: 'ADMIN' };
    if (query.orgId) filter.orgId = query.orgId;
    if (query.appId) filter.appId = query.appId;
    if (query.status) filter.status = query.status as OrderStatus;
    const page = query.page || 1;
    const limit = Math.min(query.limit || 10, MAX_PAGE_SIZE);
    const [rows, total] = await Promise.all([
      this.orderModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      this.orderModel.countDocuments(filter),
    ]);
    const names = await this.companyNames(rows.map((o) => o.orgId));
    return {
      data: rows.map((o) => ({
        ...this.view(o),
        org: { orgId: o.orgId, companyName: names.get(o.orgId) ?? null },
      })),
      page,
      limit,
      total,
    };
  }

  /** GET /billing/payment-links: the organisation's open links ("Awaiting payment"). */
  async listOpenForOrg(orgId: string, appId?: string) {
    const rows = await this.orderModel
      .find({
        source: 'ADMIN',
        orgId,
        ...(appId && { appId }),
        status: OrderStatus.PENDING_PAYMENT,
        expiresAt: { $gt: new Date() },
      })
      .sort({ createdAt: -1 })
      .limit(MAX_PAGE_SIZE)
      .lean();
    return {
      data: rows.map((o) => ({
        orderId: String(o._id),
        orderNumber: o.orderNumber,
        appId: o.appId,
        appName: o.appName,
        currency: o.currency,
        totalMinor: o.amountMinor,
        credits: o.quote.credits,
        validityDays: o.quote.validityDays,
        url: o.paymentLink?.url ?? null,
        expiresAt: o.expiresAt,
        createdAt: (o as any).createdAt,
      })),
    };
  }

  private async findAdmin(orderId: string) {
    const order = Types.ObjectId.isValid(orderId)
      ? await this.orderModel.findOne({ _id: orderId, source: 'ADMIN' }).lean()
      : null;
    if (!order) throw notFound();
    return order;
  }

  private async companyNames(orgIds: string[]) {
    const ids = [...new Set(orgIds)].filter((id) => Types.ObjectId.isValid(id));
    const orgs = await this.onboardingModel
      .find({ _id: { $in: ids } }, { companyName: 1 })
      .lean();
    return new Map(orgs.map((o) => [String(o._id), o.companyName]));
  }

  private async adminView(order: StoredOrder) {
    const names = await this.companyNames([order.orgId]);
    return {
      ...this.view(order),
      org: { orgId: order.orgId, companyName: names.get(order.orgId) ?? null },
    };
  }

  /** The PaymentLink object of docs/payment/api-contract.md §7. */
  view(order: StoredOrder) {
    const link = order.paymentLink;
    return {
      orderId: String(order._id),
      orderNumber: order.orderNumber,
      status: order.status,
      appId: order.appId,
      appName: order.appName,
      currency: order.currency,
      totalBeforeTaxMinor: order.quote.lines.totalBeforeTaxMinor,
      tax: { amountMinor: order.quote.lines.tax.amountMinor, lines: order.tax },
      totalMinor: order.amountMinor,
      credits: order.quote.credits,
      validityDays: order.quote.validityDays,
      url: link?.url ?? null,
      expiresAt: order.expiresAt,
      notifyByEmail: link?.notifyByEmail ?? false,
      sentTo: link?.sentTo ?? null,
      lastSentAt: link?.lastSentAt ?? null,
      payment: order.payment
        ? {
            paymentId: order.payment.paymentId,
            method: order.payment.method,
            paidAt: order.payment.paidAt,
          }
        : null,
      invoice: order.invoiceId
        ? { invoiceId: order.invoiceId, invoiceNumber: order.invoiceNumber }
        : null,
      creditPlanId: order.creditPlanId ?? null,
      failureReason: order.failureReason ?? null,
      createdBy: order.createdBy,
      createdAt: (order as any).createdAt,
      cancelledAt: order.cancelledAt ?? null,
      cancelReason: order.cancelReason ?? null,
      note: order.note ?? null,
    };
  }
}
