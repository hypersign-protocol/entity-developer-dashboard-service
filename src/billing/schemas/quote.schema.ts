import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { BillingCurrency, BillingRegion } from '../billing.constants';

export type QuoteDocument = Quote & Document;

// ADR §4.4: a short-lived, server-priced snapshot. Disposable: the TTL index
// deletes it, and an order copies what it needs.
@Schema({ collection: 'quotes', timestamps: true })
export class Quote {
  @Prop({ type: String, required: true })
  orgId: string;
  @Prop({ type: String, required: true })
  appId: string;
  @Prop({ type: String, required: true })
  createdBy: string; // the dashboard user (owner or team member)
  @Prop({ type: String, enum: BillingRegion, required: true })
  region: BillingRegion;
  @Prop({ type: String, enum: BillingCurrency, required: true })
  currency: BillingCurrency;
  @Prop({ type: String, required: true })
  priceBookId: string;
  @Prop({ type: Number, required: true })
  priceBookVersion: number;
  @Prop({ type: Object, required: true })
  selection: {
    planCode: string | null;
    customAmountMinor: number | null;
    couponCode: string | null;
  };
  @Prop({ type: Object, required: true })
  lines: {
    subtotalMinor: number;
    planDiscount: {
      percentBps: number;
      amountMinor: number;
      ruleId: string | null;
    };
    coupon: {
      couponId: string;
      code: string;
      percentBps: number;
      amountMinor: number;
    } | null;
    addOns: { code: string; title: string; priceMinor: number }[];
    totalBeforeTaxMinor: number;
    tax: { mode: string; amountMinor: number | null; lines: object[] };
    totalMinor: number;
  };
  @Prop({ type: Number, required: true })
  credits: number;
  @Prop({ type: Number, required: true })
  validityDays: number;
  @Prop({ type: Date, required: true })
  expiresAt: Date;
}

export const QuoteSchema = SchemaFactory.createForClass(Quote);
QuoteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
QuoteSchema.index({ orgId: 1, createdAt: -1 });
