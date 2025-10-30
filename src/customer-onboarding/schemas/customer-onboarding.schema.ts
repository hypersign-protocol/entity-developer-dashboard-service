import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  CountryCode,
  CreditStatus,
  CustomerType,
  StepStatus,
} from '../constants/enum';
export type CustomerOnboardingDocument = CustomerOnboarding & Document;
export class CompanyAddressDetail {
  @Prop({ required: true, type: String })
  street: string;
  @Prop({ required: true, type: String })
  province: string;
  @Prop({ required: true, type: String })
  postalCode: string;
  @Prop({ required: true, type: String })
  city: string;
  @Prop({ required: true, type: String, enum: CountryCode })
  country: string;
}

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
  @Prop({ type: String })
  taxId: string;
  @Prop({ type: CompanyAddressDetail })
  address: CompanyAddressDetail;
  @Prop({ type: String })
  businessLegalName: string;
  @Prop({ type: String, required: false })
  linkdinUrl?: string;
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
  @Prop({ type: String, required: false })
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
