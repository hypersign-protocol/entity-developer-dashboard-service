import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  BusinessField,
  CountryCode,
  CreditStatus,
  CustomerType,
  InterestedService,
  OnboardingStep,
  StepStatus,
  YearlyVolume,
} from '../constants/enum';
export type CustomerOnboardingDocument = CustomerOnboarding & Document;

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
  @Prop({ type: String })
  companyLogo?: string;
  @Prop({ type: String })
  domain: string;
  @Prop({ type: String, enum: CustomerType, required: true })
  type: CustomerType;
  @Prop({ required: true, type: String, enum: CountryCode })
  country: string;
  @Prop({ type: String, required: false })
  billingAddress?: string;
  @Prop({ type: String, required: false })
  linkedinUrl?: string;
  @Prop({ type: String, required: false })
  twitterUrl?: string;
  @Prop({ type: String, required: false })
  telegramUrl?: string;
  @Prop({ type: String, required: false })
  phoneNumber?: string;
  @Prop({ type: String, required: true })
  registrationNumber: string;
  @Prop({ type: [String], required: true, enum: InterestedService })
  interestedService: InterestedService[];
  @Prop({ type: String, enum: YearlyVolume, required: true })
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
  @Prop({ type: String, required: true, unique: true })
  userId: string;
}

export const CustomerOnboardingSchema =
  SchemaFactory.createForClass(CustomerOnboarding);
CustomerOnboardingSchema.index({ userId: 1 });
CustomerOnboardingSchema.index({ companyName: 1 });
CustomerOnboardingSchema.index({ companyEmail: 1 });
