import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type InvoiceDocument = Invoice & Document;

// ADR §4.7. Everything printed is copied in when the invoice is issued and never
// edited afterwards; the dashboard renders the PDF from it (ADR §8.3).
// Nested snapshots are stored as plain objects: their shape is built and
// tested in invoices/build-invoice.ts.
@Schema({ collection: 'invoices', timestamps: true })
export class Invoice {
  @Prop({ type: String, required: true })
  invoiceNumber: string;
  @Prop({ type: String, enum: ['IN', 'GL'], required: true })
  series: 'IN' | 'GL';
  @Prop({ type: String, default: null })
  financialYear: string | null;
  @Prop({ type: String, required: true })
  templateVersion: string;
  @Prop({
    type: String,
    enum: ['SELF_SERVE', 'ADMIN', 'PROMOTION'],
    required: true,
  })
  source: 'SELF_SERVE' | 'ADMIN' | 'PROMOTION';
  @Prop({ type: String, required: false })
  orderId?: string; // SELF_SERVE only
  @Prop({ type: String, required: false })
  promotionKey?: string; // PROMOTION: 'PROMOTION:<orgId>:<serviceId>'
  @Prop({ type: String, required: true })
  orgId: string;
  @Prop({ type: String, required: true })
  appId: string;
  @Prop({ type: String, required: false })
  createdBy?: string; // ADMIN: the super admin's userId
  @Prop({ type: String, required: false })
  idempotencyKey?: string; // ADMIN
  @Prop({ type: String, required: false })
  requestHash?: string; // ADMIN: detects a reused key with a different body
  @Prop({ type: String, required: false })
  note?: string; // ADMIN, internal, never printed
  @Prop({ type: String, enum: ['UNPAID', 'PAID', 'VOID'], required: true })
  status: 'UNPAID' | 'PAID' | 'VOID';
  @Prop({ type: String, enum: ['GATEWAY', 'OFFLINE', 'COMPLIMENTARY'] })
  settlement?: 'GATEWAY' | 'OFFLINE' | 'COMPLIMENTARY';
  @Prop({ type: Date, required: true })
  issuedAt: Date;
  @Prop({ type: Date, default: null })
  paidAt: Date | null;
  @Prop({ type: Date, default: null })
  dueAt: Date | null;
  @Prop({ type: String, enum: ['INR', 'USD'], required: true })
  currency: 'INR' | 'USD';
  @Prop({ type: Object, required: true })
  supplier: Record<string, unknown>;
  @Prop({ type: Object, required: true })
  customer: Record<string, unknown>;
  @Prop({ type: Object, default: null })
  placeOfSupply: { code: string; name: string } | null;
  @Prop({ type: Object, required: true })
  app: { appId: string; appName: string };
  @Prop({ type: String, default: null })
  orderNumber: string | null;
  @Prop({ type: [Object], required: true })
  lines: Record<string, unknown>[];
  @Prop({ type: [Object], default: [] })
  addOnLines: { code: string; title: string }[];
  @Prop({ type: Object, required: true })
  discounts: { plan: unknown; coupon: unknown };
  @Prop({ type: [Object], default: [] })
  tax: { type: string; rateBps: number; amountMinor: number }[];
  @Prop({ type: String, default: null })
  taxNote: string | null;
  @Prop({ type: Object, required: true })
  totals: {
    subtotalMinor: number;
    discountMinor: number;
    taxableMinor: number;
    taxMinor: number;
    totalMinor: number;
    amountPaidMinor: number;
    balanceDueMinor: number;
  };
  @Prop({ type: Number, required: true })
  credits: number;
  @Prop({ type: Number, required: true })
  validityDays: number;
  @Prop({ type: Object, default: null })
  payment: {
    method: string;
    reference: string | null;
    provider: string | null;
    paymentId: string | null;
    paidAt: Date;
  } | null;
  @Prop({ type: String, default: null })
  payNowUrl: string | null;
  @Prop({ type: String, required: false })
  creditPlanId?: string; // set once the credits are granted
  @Prop({ type: Date, default: null })
  voidedAt: Date | null;
  @Prop({ type: String, default: null })
  voidReason: string | null;
}

export const InvoiceSchema = SchemaFactory.createForClass(Invoice);
InvoiceSchema.index({ invoiceNumber: 1 }, { unique: true });
InvoiceSchema.index(
  { createdBy: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: 'string' } },
  },
);
InvoiceSchema.index(
  { orderId: 1 },
  { unique: true, partialFilterExpression: { orderId: { $type: 'string' } } },
);
InvoiceSchema.index(
  { promotionKey: 1 },
  {
    unique: true,
    partialFilterExpression: { promotionKey: { $type: 'string' } },
  },
);
InvoiceSchema.index({ orgId: 1, issuedAt: -1 });
InvoiceSchema.index({ appId: 1, issuedAt: -1 });
InvoiceSchema.index({ status: 1, dueAt: 1 });
InvoiceSchema.index({ issuedAt: -1 });

export type BillingCounterDocument = BillingCounter & Document;

// Gap-free sequences: incremented in the same transaction as the invoice insert.
@Schema({ collection: 'billingCounters', versionKey: false })
export class BillingCounter {
  @Prop({ type: String })
  _id: string; // 'INV/IN/2026-27', 'INV/GL/2026'
  @Prop({ type: Number, default: 0 })
  seq: number;
}

export const BillingCounterSchema =
  SchemaFactory.createForClass(BillingCounter);
