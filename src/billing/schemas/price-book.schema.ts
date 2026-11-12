import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { BillingCurrency, BillingRegion } from '../billing.constants';

export enum PriceBookStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
  RETIRED = 'RETIRED',
}

export enum DiscountRuleType {
  PLAN = 'PLAN',
  AMOUNT_RANGE = 'AMOUNT_RANGE',
}

@Schema({ _id: false })
export class PriceBookPlan {
  @Prop({ type: String, required: true })
  code: string; // 'IN_2499'. Stable across versions
  @Prop({ type: Number, required: true })
  priceMinor: number; // excluding tax
  @Prop({ type: Number, required: true })
  displayOrder: number;
  @Prop({ type: Boolean, default: true })
  active: boolean;
}

@Schema({ _id: false })
export class DiscountRule {
  @Prop({ type: String, required: true })
  id: string;
  @Prop({ type: String, enum: DiscountRuleType, required: true })
  type: DiscountRuleType;
  @Prop({ type: String, required: false })
  planCode?: string; // PLAN
  @Prop({ type: Number, required: false })
  minMinor?: number; // AMOUNT_RANGE, inclusive
  @Prop({ type: Number, required: false })
  maxMinor?: number; // AMOUNT_RANGE, inclusive
  @Prop({ type: Number, required: true })
  percentBps: number;
  @Prop({ type: Number, default: 0 })
  priority: number; // highest matching rule wins; plan discounts never stack
}

@Schema({ _id: false })
export class PriceBookAddOn {
  @Prop({ type: String, required: true })
  code: string; // VALIDITY, EMAIL_SUPPORT, …
  @Prop({ type: String, required: true })
  title: string;
  @Prop({ type: String, required: true })
  shortTitle: string;
  @Prop({ type: String, required: true })
  description: string;
  @Prop({ type: String, required: false })
  icon?: string;
  @Prop({ type: Number, default: 0 })
  priceMinor: number;
  @Prop({ type: Boolean, default: true })
  included: boolean;
  @Prop({ type: Object, required: false })
  config?: { validityDays?: number };
}

@Schema({ _id: false })
export class CustomAmount {
  @Prop({ type: Boolean, default: false })
  enabled: boolean;
  @Prop({ type: Number, required: true })
  minMinor: number;
  @Prop({ type: Number, required: true })
  maxMinor: number;
}

export type PriceBookDocument = PriceBook & Document;

// ADR §4.2. A published book is never edited: a change is a new version.
@Schema({ collection: 'priceBooks', timestamps: true })
export class PriceBook {
  @Prop({ type: String, enum: BillingRegion, required: true })
  region: BillingRegion;
  @Prop({ type: String, enum: BillingCurrency, required: true })
  currency: BillingCurrency;
  @Prop({ type: Number, required: true })
  version: number;
  @Prop({ type: String, enum: PriceBookStatus, required: true })
  status: PriceBookStatus;
  @Prop({ type: Number, required: true })
  creditsPerMajorUnit: number; // integer: INR 1, USD 90
  @Prop({ type: SchemaFactory.createForClass(CustomAmount), required: true })
  custom: CustomAmount;
  @Prop({ type: [String], default: [] })
  calculatorFlowIds: string[];
  @Prop({ type: [SchemaFactory.createForClass(PriceBookPlan)], default: [] })
  plans: PriceBookPlan[];
  @Prop({ type: [SchemaFactory.createForClass(DiscountRule)], default: [] })
  discountRules: DiscountRule[];
  @Prop({ type: [SchemaFactory.createForClass(PriceBookAddOn)], default: [] })
  addOns: PriceBookAddOn[];
  @Prop({ type: Date, required: false })
  publishedAt?: Date;
  @Prop({ type: String, required: false })
  publishedBy?: string;
}

export const PriceBookSchema = SchemaFactory.createForClass(PriceBook);
PriceBookSchema.index({ region: 1, version: 1 }, { unique: true });
// At most one published book per region.
PriceBookSchema.index(
  { region: 1 },
  {
    unique: true,
    partialFilterExpression: { status: PriceBookStatus.PUBLISHED },
    name: 'one_published_per_region',
  },
);
