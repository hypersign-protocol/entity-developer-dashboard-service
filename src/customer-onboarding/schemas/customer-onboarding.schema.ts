import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  BusinessField,
  CountryCode,
  CreditStatus,
  CustomerType,
  InterestedService,
  StepStatus,
  YearlyVolume,
} from '../constants/enum';
export type CustomerOnboardingDocument = CustomerOnboarding & Document;

export class LogDetail {
  @Prop({ Type: String, required: true })
  step: string; // add list of stpes we will have as enum or constant
  @Prop({ Type: Date, required: true })
  time: Date;
  @Prop({ Type: String, required: true, enum: StepStatus })
  status: string;
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
  companyLogo: string;
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
  phoneNumber?: string;
  @Prop({ type: String, required: true })
  registrationNumber: string;
  @Prop({ type: [String], required: true, enum: InterestedService })
  interestedService: InterestedService[];
  @Prop({ type: String, enum: YearlyVolume, required: true })
  yearlyVolume: string;
  @Prop({ type: [String], required: true, enum: BusinessField })
  businessField: BusinessField[];
  @Prop({ type: Boolean, required: false })
  isKyc?: boolean;
  @Prop({ type: Boolean, required: false })
  isKyb?: boolean;
  @Prop({
    type: String,
    required: false,
    enum: CreditStatus,
    default: CreditStatus.REQUESTED,
  })
  creditStatus?: CreditStatus;
  @Prop({ type: LogDetail, required: false })
  logs?: LogDetail[];
  @Prop({ type: String, required: false }) // didDocumet id for business
  businessId?: string;
  @Prop({ type: String, required: false })
  businessIdName?: string;
  @Prop({ type: String, required: false })
  ssiSubdomain?: string;
  @Prop({ type: String, required: false })
  kycSubdomain?: string;
  @Prop({ type: String, required: true })
  userId: string;
}

export const CustomerOnboardingSchema =
  SchemaFactory.createForClass(CustomerOnboarding);
CustomerOnboardingSchema.index({ companyName: 1 });
CustomerOnboardingSchema.index({ companyEmail: 1 });
