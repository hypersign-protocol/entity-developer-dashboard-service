import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  BusinessField,
  CreditStatus,
  CustomerType,
  InterestedService,
  OnboardingStep,
  StepStatus,
  MonthlyVolume,
} from '../constants/enum';
import { KybVerificationEnum } from '../constants/identifier-types';
export type CustomerOnboardingDocument = CustomerOnboarding & Document;

// The organisation's billing profile (ADR §4.1). Region and currency come
// first (price book selection); address and tax ids follow with quotes.
@Schema({ _id: false })
export class BillingDetails {
  @Prop({ type: String, enum: ['IN', 'GLOBAL'], required: true })
  region: 'IN' | 'GLOBAL';
  @Prop({ type: String, enum: ['INR', 'USD'], required: true })
  currency: 'INR' | 'USD';
  @Prop({
    type: [{ _id: false, type: { type: String }, number: { type: String } }],
    required: false,
  })
  taxIds?: { type: string; number: string }[];
}
export const BillingDetailsSchema =
  SchemaFactory.createForClass(BillingDetails);

export class LogDetail {
  @Prop({ Type: String, required: true })
  step: OnboardingStep;
  @Prop({ Type: Date, required: true })
  time: Date;
  @Prop({ Type: String, required: true, enum: StepStatus })
  status: StepStatus;
  @Prop({ Type: String, required: false })
  failureReason?: string;
}

@Schema({ timestamps: true })
export class CustomerOnboarding {
  @Prop({ type: String, required: true, unique: true })
  companyName: string;
  @Prop({ type: String })
  customerEmail: string;
  @Prop({ type: String, required: false })
  companyLogo?: string;
  @Prop({ type: String, requried: false })
  domain?: string;
  @Prop({ type: String, enum: CustomerType, required: true })
  type: CustomerType;
  @Prop({ required: false, type: String })
  country?: string;
  @Prop({ type: String, required: false })
  billingAddress?: string;
  @Prop({ type: String, required: false })
  linkedinUrl?: string;
  @Prop({ type: String, required: false })
  twitterUrl?: string;
  @Prop({ type: String, required: false })
  telegramUrl?: string;
  @Prop({ type: String, required: false })
  referralSource?: string;
  @Prop({ type: String, required: false })
  phoneNumber?: string;
  @Prop({ type: String, required: false })
  registrationNumber?: string;
  @Prop({ type: [String], required: true, enum: InterestedService })
  interestedService: InterestedService[];
  @Prop({ type: String, enum: MonthlyVolume, required: true })
  yearlyVolume: string;
  @Prop({ type: [String], required: true, enum: BusinessField })
  businessField: BusinessField[];
  @Prop({
    type: String,
    required: false,
    enum: CreditStatus,
    default: CreditStatus.INITIATED,
  })
  onboardingStatus?: CreditStatus;
  @Prop({ type: Array<LogDetail>, required: false, default: [] })
  logs?: LogDetail[];
  @Prop({ type: String, required: false }) // didDocumet id for business
  businessId?: string;
  @Prop({ type: String, required: false })
  businessIdName?: string;
  @Prop({ type: String, required: false })
  ssiSubdomain?: string;
  @Prop({ type: String, required: false })
  kycSubdomain?: string;
  @Prop({ type: String, required: false })
  ssiServiceId?: string;
  @Prop({ type: String, required: false })
  kycServiceId?: string;
  @Prop({ type: String, required: false })
  companyId?: string;
  @Prop({ type: String, required: false })
  companyIDPAppId?: string;
  @Prop({
    type: String,
    enum: KybVerificationEnum,
    // default: KybVerificationEnum.Completed,
  })
  companyVerificationStatus?: string;
  @Prop({ type: String, required: false })
  companyStatusReason?: string;
  // Set by the KYB webhook on the first move to Approved. Coupons use it.
  @Prop({ type: Date, required: false })
  companyVerificationApprovedAt?: Date;
  @Prop({ type: String, required: true })
  userId: string;
  // Billing profile. Written only by the billing module (its own $set path).
  @Prop({ type: BillingDetailsSchema, required: false })
  billing?: BillingDetails;
}

export const CustomerOnboardingSchema =
  SchemaFactory.createForClass(CustomerOnboarding);
// One onboarding (organisation) per owner.
CustomerOnboardingSchema.index({ userId: 1 }, { unique: true });
