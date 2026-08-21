import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

export enum scope {
  MsgRegisterDID = 'MsgRegisterDID',
  MsgUpdateDID = 'MsgUpdateDID',
  MsgDeactivateDID = 'MsgDeactivateDID',
  MsgRegisterCredentialSchema = 'MsgRegisterCredentialSchema',
  MsgRegisterCredentialStatus = 'MsgRegisterCredentialStatus',
  MsgUpdateCredentialStatus = 'MsgUpdateCredentialStatus',
}

export type CreditPlanDocument = CreditPlan & Document;

export enum CreditStatus {
  ACTIVE = 'Active',
  INACTIVE = 'Inactive',
}

export enum CreditSourceEnum {
  'MANUAL_RECHARGE' = 'MANUAL_RECHARGE',
  'CUSTOMER_ONBOARDING' = 'CUSTOMER_ONBOARDING',
  'MIGRATION' = 'MIGRATION',
  'PAYMENT' = 'PAYMENT',
  'ADJUSTMENT' = 'ADJUSTMENT',
}

export class CreditNotificationState {
  lastNotifiedUsageThreshold?: number;
  expiryThresholdsSent?: number;
}

export class OnChainCreditAllowance {
  amount: number;
  denom: string;
  usedAmount?: number;
}
export class ApiCredit {
  @Prop({ required: true, type: Number })
  total: number;
  @Prop({ required: true, type: Number, default: 0 })
  used: number;
}

@Schema({ timestamps: true })
export class CreditPlan {
  @Prop({ required: true })
  serviceId: string;
  @Prop({ required: true, type: ApiCredit })
  apiCredit: ApiCredit;
  @Prop({ required: true, type: Number })
  validityDays: number;
  @Prop({ required: true, type: Number, min: 0 })
  criticalBalance: number;
  @Prop({ required: false, type: Date })
  expiresAt?: Date;
  @Prop({
    required: true,
    enum: CreditStatus,
    default: CreditStatus.INACTIVE,
  })
  status: CreditStatus;
  @Prop({ required: false, type: OnChainCreditAllowance })
  onChainAllowance?: OnChainCreditAllowance;
  @Prop({ required: false, type: [String], default: [] })
  onChainAllowanceScopes?: scope[];
  @Prop({ required: false })
  creditedBy?: string;
  @Prop({ required: false })
  source?: CreditSourceEnum;
  @Prop({ required: false })
  migrationSource?: 'ID_SERVICE' | 'SSI_SERVICE';
  @Prop({ required: false })
  legacyCreditId?: string;
  @Prop({ required: false, type: [String], default: [], select: false })
  processedCommitEventIds?: string[];
  // ToDo:- check if we need credit for spellOver and its expiry
  @Prop({ required: false, type: CreditNotificationState })
  notification?: CreditNotificationState;
}

export const CreditsSchema = SchemaFactory.createForClass(CreditPlan);
CreditsSchema.index({ serviceId: 1, status: 1 });
CreditsSchema.index({ serviceId: 1, createdAt: 1 });
CreditsSchema.index({ legacyCreditId: 1, migrationSource: 1 });
