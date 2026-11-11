import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { BillingCurrency, BillingRegion } from '../billing.constants';
import { BillingProfile } from '../profile/billing-profile';
import { TaxLine } from '../tax/india-gst';
import { Quote } from './quote.schema';

// ADR §4.5. Transitions only move forward, each as a conditional update.
export enum OrderStatus {
  CREATED = 'CREATED', // the provider order isn't created yet
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  PAID = 'PAID', // payment captured, invoice or credits still to do
  FULFILLED = 'FULFILLED',
  FAILED = 'FAILED', // the provider order could never be created
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
  NEEDS_REVIEW = 'NEEDS_REVIEW', // money taken that doesn't match the order
}

export type OrderDocument = Order & Document;

export type OrderSource = 'SELF_SERVE' | 'ADMIN';

export interface OrderPaymentLink {
  linkId: string | null; // null until the provider has created it
  url: string | null;
  notifyByEmail: boolean; // false: the admin copies the link and sends it
  sentTo: string | null; // the email the provider sends it to
  lastSentAt: Date | null;
}

// SELF_SERVE: the customer pays in the checkout popup.
// ADMIN: a super admin's Collect payment; the customer pays by payment link.
// Either way the invoice is issued only once the payment is captured.
@Schema({ collection: 'orders', timestamps: true })
export class Order {
  @Prop({ type: String, required: true })
  orderNumber: string; // ORD-2026-000123, from BillingCounter 'ORD/2026'
  @Prop({ type: String, enum: ['SELF_SERVE', 'ADMIN'], default: 'SELF_SERVE' })
  source: OrderSource;
  @Prop({ type: String, required: true })
  orgId: string;
  @Prop({ type: String, required: true })
  appId: string;
  @Prop({ type: String, required: true })
  appName: string;
  @Prop({ type: String, required: true })
  createdBy: string; // SELF_SERVE: who clicked Pay. ADMIN: the super admin's userId
  @Prop({ type: String, required: true })
  idempotencyKey: string;
  @Prop({ type: String, required: false })
  requestHash?: string; // ADMIN: detects a reused key with a different body
  @Prop({ type: String, required: false })
  quoteId?: string; // SELF_SERVE
  @Prop({ type: String, required: false })
  note?: string; // ADMIN, internal, never printed
  @Prop({ type: Object, default: null })
  paymentLink: OrderPaymentLink | null; // ADMIN
  @Prop({ type: Date, default: null })
  cancelledAt: Date | null;
  @Prop({ type: String, default: null })
  cancelledBy: string | null;
  @Prop({ type: String, default: null })
  cancelReason: string | null;
  @Prop({ type: Object, required: true })
  quote: Pick<
    Quote,
    | 'selection'
    | 'lines'
    | 'credits'
    | 'validityDays'
    | 'priceBookId'
    | 'priceBookVersion'
  >;
  // The billing details the tax was worked out from; the invoice prints them.
  @Prop({ type: Object, required: true })
  customer: BillingProfile;
  @Prop({ type: [Object], default: [] })
  tax: TaxLine[];
  @Prop({ type: String, enum: BillingRegion, required: true })
  region: BillingRegion;
  @Prop({ type: String, enum: BillingCurrency, required: true })
  currency: BillingCurrency;
  @Prop({ type: Number, required: true })
  amountMinor: number; // the total charged, tax included
  @Prop({ type: String, enum: OrderStatus, default: OrderStatus.CREATED })
  status: OrderStatus;
  @Prop({ type: String, required: true })
  provider: string;
  @Prop({ type: String, required: false })
  providerOrderId?: string;
  @Prop({ type: Date, required: true })
  expiresAt: Date; // Pay is no longer offered after this
  @Prop({ type: Date, default: null })
  lastSyncedAt: Date | null;
  @Prop({ type: Object, default: null })
  payment: {
    paymentId: string;
    method: string | null;
    amountMinor: number;
    currency: string;
    paidAt: Date;
    // USD orders: the INR amount Razorpay converted the payment to.
    baseAmountMinor?: number | null;
    baseCurrency?: string | null;
  } | null;
  @Prop({ type: Object, default: null })
  lastPaymentError: { code: string | null; description: string | null } | null;
  @Prop({ type: String, required: false })
  invoiceId?: string;
  @Prop({ type: String, required: false })
  invoiceNumber?: string;
  @Prop({ type: String, required: false })
  creditPlanId?: string;
  @Prop({ type: String, required: false })
  creditsActive?: 'IMMEDIATELY' | 'AFTER_CURRENT_PLAN';
  @Prop({ type: String, default: null })
  failureReason: string | null;
}

export const OrderSchema = SchemaFactory.createForClass(Order);
OrderSchema.index({ orgId: 1, idempotencyKey: 1 }, { unique: true });
OrderSchema.index({ orderNumber: 1 }, { unique: true });
OrderSchema.index({ orgId: 1, createdAt: -1 });
OrderSchema.index({ source: 1, status: 1, createdAt: -1 }); // super-admin list
OrderSchema.index({ status: 1, lastSyncedAt: 1 }); // reconciliation
OrderSchema.index(
  { provider: 1, providerOrderId: 1 },
  {
    unique: true,
    partialFilterExpression: { providerOrderId: { $type: 'string' } },
  },
);
// Webhooks find a Collect payment order by its link.
OrderSchema.index(
  { provider: 1, 'paymentLink.linkId': 1 },
  { partialFilterExpression: { 'paymentLink.linkId': { $type: 'string' } } },
);

export type PaymentAttemptDocument = PaymentAttempt & Document;

// One per provider payment: what the provider said, kept for support.
@Schema({ collection: 'paymentAttempts', timestamps: true })
export class PaymentAttempt {
  @Prop({ type: String, required: true })
  orderId: string;
  @Prop({ type: String, required: true })
  provider: string;
  @Prop({ type: String, required: true })
  providerPaymentId: string;
  @Prop({ type: String, required: true })
  status: string;
  @Prop({ type: Number, required: true })
  amountMinor: number;
  @Prop({ type: String, required: true })
  currency: string;
  @Prop({ type: String, default: null })
  method: string | null;
  @Prop({ type: Boolean, default: false })
  international: boolean;
  @Prop({ type: String, default: null })
  errorCode: string | null;
  @Prop({ type: String, default: null })
  errorDescription: string | null;
  @Prop({ type: Date, required: true })
  attemptedAt: Date;
}

export const PaymentAttemptSchema =
  SchemaFactory.createForClass(PaymentAttempt);
PaymentAttemptSchema.index(
  { provider: 1, providerPaymentId: 1 },
  { unique: true },
);
PaymentAttemptSchema.index({ orderId: 1 });
