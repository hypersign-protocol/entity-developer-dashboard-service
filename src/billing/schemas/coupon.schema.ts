import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { BillingRegion } from '../billing.constants';

export enum CouponStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  EXPIRED = 'EXPIRED',
}

export enum CouponRedemptionStatus {
  RESERVED = 'RESERVED',
  REDEEMED = 'REDEEMED',
  RELEASED = 'RELEASED',
}

export class CouponEligibility {
  requiresKybApproved?: boolean; // FOUNDING
  requiresTaxId?: string[]; // FOUNDING8: any of ['GSTIN', 'PAN']
  withinDaysOfKybApproval?: number; // FOUNDING: 180
  firstPurchaseOnly?: boolean; // REFER*. Needs purchase history (checkout)
  minDaysSinceLastPurchase?: number; // WINBACK. Needs purchase history (checkout)
  allowedOrgIds?: string[]; // WINBACK, partner cohorts
  partnerId?: string; // PARTNER
}

export class CouponLimits {
  maxAccounts?: number; // FOUNDING: first 500 accounts
  maxRedemptions?: number; // total uses of the code
  maxRedemptionsPerAccount?: number; // FOUNDING: 3
  startsAt?: Date;
  expiresAt?: Date;
}

export type CouponDocument = Coupon & Document;

// ADR §4.3.
@Schema({ collection: 'coupons', timestamps: true })
export class Coupon {
  @Prop({ type: String, required: true, uppercase: true, trim: true })
  code: string;
  @Prop({ type: String, enum: BillingRegion, required: true })
  region: BillingRegion;
  @Prop({ type: Number, required: true })
  percentBps: number;
  @Prop({ type: Number, required: false })
  maxDiscountMinor?: number;
  @Prop({ type: Boolean, default: false })
  listed: boolean; // offered in the coupon dialog to eligible accounts
  @Prop({ type: String, required: true })
  title: string;
  @Prop({ type: String, required: true })
  description: string;
  @Prop({ type: String, required: true })
  campaign: string; // FOUNDING, REFERRAL, PARTNER, WINBACK, …
  @Prop({ type: Object, default: {} })
  eligibility: CouponEligibility;
  @Prop({ type: Object, default: {} })
  limits: CouponLimits;
  @Prop({ type: Number, default: 0 })
  accountCount: number; // distinct accounts holding a claim
  @Prop({ type: Number, default: 0 })
  redemptionCount: number; // RESERVED + REDEEMED uses
  @Prop({ type: String, enum: CouponStatus, default: CouponStatus.ACTIVE })
  status: CouponStatus;
}

export const CouponSchema = SchemaFactory.createForClass(Coupon);
CouponSchema.index({ code: 1 }, { unique: true });
CouponSchema.index({ region: 1, status: 1, listed: 1 });

export type CouponAccountDocument = CouponAccount & Document;

// One per (coupon, account): "first 500 accounts, 3 uses each" is two limits.
@Schema({ collection: 'couponAccounts', timestamps: true })
export class CouponAccount {
  @Prop({ type: String, required: true })
  couponId: string;
  @Prop({ type: String, required: true })
  orgId: string;
  @Prop({ type: Number, default: 0 })
  redemptions: number; // RESERVED + REDEEMED uses by this account
}

export const CouponAccountSchema = SchemaFactory.createForClass(CouponAccount);
CouponAccountSchema.index({ couponId: 1, orgId: 1 }, { unique: true });
CouponAccountSchema.index({ orgId: 1 });

export type CouponRedemptionDocument = CouponRedemption & Document;

// Written at checkout (reservation), not yet used by the invoicing stage.
@Schema({ collection: 'couponRedemptions', timestamps: true })
export class CouponRedemption {
  @Prop({ type: String, required: true })
  couponId: string;
  @Prop({ type: String, required: true })
  code: string;
  @Prop({ type: String, required: true })
  orgId: string;
  @Prop({ type: String, required: true })
  orderId: string;
  @Prop({ type: String, enum: CouponRedemptionStatus, required: true })
  status: CouponRedemptionStatus;
  @Prop({ type: Number, required: true })
  discountMinor: number;
  @Prop({ type: Date, required: false })
  reservedUntil?: Date;
}

export const CouponRedemptionSchema =
  SchemaFactory.createForClass(CouponRedemption);
CouponRedemptionSchema.index({ orderId: 1 }, { unique: true });
CouponRedemptionSchema.index({ couponId: 1, status: 1 });
