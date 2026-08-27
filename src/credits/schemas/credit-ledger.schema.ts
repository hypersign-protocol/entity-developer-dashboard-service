import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ _id: false })
export class CreditLedgerMetadata {
  @Prop({ required: false, type: String })
  tenantId?: string;

  @Prop({ required: false, type: String })
  serviceId?: string;

  @Prop({ required: true, type: String })
  serviceType: string;

  @Prop({ required: false, type: String })
  creditType?: string;
}

/** Append-only, time-ordered credit lifecycle ledger used for audit and idempotency. */
@Schema({
  collection: 'creditLedger',
  versionKey: false,
  // Keep ledger events in a MongoDB time-series collection. `timestamp` is
  // the measurement time and `metadata` groups measurements for efficient
  // time-range queries.
  timeseries: {
    timeField: 'timestamp',
    metaField: 'metadata',
    granularity: 'seconds',
  },
  // This model must build its indexes even when the application disables
  // index creation globally (as is common in production).
  autoCreate: true,
  autoIndex: true,
})
export class CreditLedger {
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

  @Prop({ required: true, type: String })
  eventId: string;

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
}

export const CreditLedgerSchema = SchemaFactory.createForClass(CreditLedger);

// MongoDB does not allow unique indexes on time-series collections. Keep an
// index for the idempotency lookup; uniqueness is handled by the event-store
// check before insertion.
CreditLedgerSchema.index({ eventId: 1 });
CreditLedgerSchema.index({
  'metadata.tenantId': 1,
  timestamp: -1,
});
CreditLedgerSchema.index({
  'metadata.serviceId': 1,
  timestamp: -1,
});
CreditLedgerSchema.index({ planId: 1, timestamp: -1 });
CreditLedgerSchema.index({
  'metadata.serviceId': 1,
  planId: 1,
  timestamp: -1,
});
CreditLedgerSchema.index({
  'metadata.serviceId': 1,
  eventType: 1,
  timestamp: -1,
});
CreditLedgerSchema.index({
  'metadata.tenantId': 1,
  'metadata.serviceId': 1,
  timestamp: -1,
});
CreditLedgerSchema.index({
  'metadata.tenantId': 1,
  'metadata.serviceId': 1,
  planId: 1,
  timestamp: -1,
});
CreditLedgerSchema.index({
  'metadata.tenantId': 1,
  'metadata.serviceId': 1,
  operation: 1,
  timestamp: -1,
});
