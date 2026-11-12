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

@Schema({ _id: false })
export class BillingAddress {
  @Prop({ type: String }) street: string;
  @Prop({ type: String }) city: string;
  @Prop({ type: String }) province: string;
  @Prop({ type: String }) postalCode: string;
  @Prop({ type: String }) country: string; // ISO 3166-1 alpha-2
}

@Schema({ _id: false })
export class BillingTaxId {
  @Prop({ type: String }) type: string; // TaxIdTypes code: GSTIN, PAN, VAT, …
  @Prop({ type: String }) number: string;
}

// A personal tax ID from KYB. Only the end of it is kept, for invoices.
@Schema({ _id: false })
export class BillingPersonalTaxId {
  @Prop({ type: String }) type: string; // PAN or OTHER
  @Prop({ type: String }) last4: string;
}

// The organisation's billing profile (ADR §4.1). Fields are optional because
// they arrive in steps: region first, then KYB prefill, then confirmedAt, from
// the customer's save or KYB approval.
@Schema({ _id: false })
export class BillingDetails {
  @Prop({ type: String, enum: ['IN', 'GLOBAL'] })
  region?: 'IN' | 'GLOBAL';
  @Prop({ type: String, enum: ['INR', 'USD'] })
  currency?: 'INR' | 'USD';
  @Prop({ type: String }) legalName?: string;
  @Prop({ type: String }) email?: string;
  @Prop({ type: String }) phone?: string; // international form, e.g. +4930123456
  @Prop({ type: SchemaFactory.createForClass(BillingAddress) })
  address?: BillingAddress;
  @Prop({ type: String }) gstStateCode?: string; // India: 2-digit GST state code
  @Prop({ type: [SchemaFactory.createForClass(BillingTaxId)] })
  taxIds?: BillingTaxId[];
  @Prop({ type: SchemaFactory.createForClass(BillingPersonalTaxId) })
  personalTaxId?: BillingPersonalTaxId;
  @Prop({ type: Date }) confirmedAt?: Date; // saved, or set on KYB approval
  @Prop({ type: Date }) lockedAt?: Date; // first paid invoice
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

export interface PromotionClaim {
  status: 'CLAIMING' | 'GRANTED';
  appId: string;
  claimedBy: string;
  claimedAt: Date;
  credits: number;
  validityDays: number;
  onChainAllowance?: number; // SSI: the HID allowance granted with the credits
  invoiced: boolean; // fixed at the claim, so a retry takes the same path
  creditPlanId?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  grantedAt?: Date;
  legacy?: boolean; // granted before claims were recorded here
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
  // Set while a KYB submission is being sent to ID-Service, so a second one
  // sent at the same time is refused. Cleared when the request finishes.
  @Prop({ type: Date, required: false })
  kybSubmissionStartedAt?: Date;
  @Prop({ type: String, required: true })
  userId: string;
  // Billing profile. Written only by the billing module (its own $set path).
  @Prop({ type: BillingDetailsSchema, required: false })
  billing?: BillingDetails;
  // Free-credit promotion claims, one per service (SSI_API, CAVACH_API), so a
  // new app can't claim again. Written only by billing's PromotionService.
  @Prop({ type: Object, required: false })
  promotions?: Record<string, PromotionClaim>;
}

export const CustomerOnboardingSchema =
  SchemaFactory.createForClass(CustomerOnboarding);
// One onboarding (organisation) per owner.
CustomerOnboardingSchema.index({ userId: 1 }, { unique: true });
