import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { CreditLedgerMetadata } from './credit-ledger.schema';

export enum CreditCommitLedgerStatus {
  PENDING = 'PENDING',
  WRITING = 'WRITING',
  WRITTEN = 'WRITTEN',
}

/**
 * Transactional idempotency record for committed credit events.
 *
 * MongoDB does not permit time-series writes in transactions, so this regular
 * collection is committed atomically with the credit-plan balance. The ledger
 * measurement is appended after the transaction and can safely be retried.
 */
@Schema({
  collection: 'creditCommitOutbox',
  timestamps: true,
  versionKey: false,
  autoCreate: true,
  autoIndex: true,
})
export class CreditCommitOutbox {
  @Prop({ required: true, type: String })
  eventId: string;

  @Prop({ required: true, type: Date })
  timestamp: Date;

  @Prop({ required: true, type: CreditLedgerMetadata })
  metadata: CreditLedgerMetadata;

  @Prop({ required: true, type: String })
  eventType: string;

  @Prop({ required: false, type: String })
  planId?: string;

  @Prop({ required: false, type: String })
  operation?: string;

  @Prop({ required: true, type: Number })
  schemaVersion: number;

  @Prop({ required: false, type: String })
  catalogVersion?: string;

  @Prop({ required: false, type: String })
  reservationId?: string;

  @Prop({ required: false, type: Number })
  amount?: number;

  @Prop({ required: false, type: Number })
  totalAmount?: number;

  @Prop({ required: false, type: Number })
  allocationIndex?: number;

  @Prop({ required: false, type: Number })
  allocationCount?: number;

  @Prop({ required: false, type: Number })
  planBalanceAfter?: number;

  @Prop({ required: false, type: Number })
  balanceAfter?: number;

  @Prop({
    required: true,
    type: String,
    enum: CreditCommitLedgerStatus,
    default: CreditCommitLedgerStatus.PENDING,
  })
  ledgerStatus: CreditCommitLedgerStatus;

  @Prop({ required: false, type: String })
  ledgerLeaseToken?: string;

  @Prop({ required: false, type: Date })
  ledgerLeaseUntil?: Date;

  @Prop({ required: true, type: Number, default: 0 })
  ledgerAttempts: number;

  @Prop({ required: false, type: Date })
  ledgerWrittenAt?: Date;

  @Prop({ required: false, type: String })
  ledgerLastError?: string;
}

export const CreditCommitOutboxSchema =
  SchemaFactory.createForClass(CreditCommitOutbox);

CreditCommitOutboxSchema.index({ eventId: 1 }, { unique: true });
CreditCommitOutboxSchema.index({ ledgerStatus: 1, ledgerLeaseUntil: 1 });
