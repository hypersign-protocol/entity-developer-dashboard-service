import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ _id: false })
export class CreditCommitEventMetadata {
  @Prop({ required: true, type: String })
  tenantId: string;

  @Prop({ required: true, type: String })
  serviceId: string;

  @Prop({ required: true, type: String })
  serviceType: string;

  @Prop({ required: true, type: String })
  creditType: string;
}

/**
 * Immutable record of a successfully applied COMMITTED credit lifecycle event.
 *
 * MongoDB stores this schema in a native time-series collection. Metadata is
 * limited to stable, common query dimensions so buckets remain densely packed.
 * Plan and operation are indexed measurements because they change more often.
 */
@Schema({
  collection: 'creditEventHistory',
  timeseries: {
    timeField: 'timestamp',
    metaField: 'metadata',
    granularity: 'minutes',
  },
  versionKey: false,
})
export class CreditCommitEvent {
  @Prop({ required: true, type: Date })
  timestamp: Date;

  @Prop({ required: true, type: CreditCommitEventMetadata })
  metadata: CreditCommitEventMetadata;

  @Prop({ required: true, type: String })
  planId: string;

  @Prop({ required: true, type: String })
  operation: string;

  @Prop({ required: true, type: String })
  eventId: string;

  @Prop({ required: true, type: Number })
  schemaVersion: number;

  @Prop({ required: true, type: String })
  catalogVersion: string;

  @Prop({ required: true, type: String })
  catalogId: string;

  @Prop({ required: true, type: String })
  reservationId: string;

  @Prop({ required: true, type: Number })
  amount: number;

  @Prop({ required: true, type: Number })
  totalAmount: number;

  @Prop({ required: true, type: Number })
  allocationIndex: number;

  @Prop({ required: true, type: Number })
  allocationCount: number;

  @Prop({ required: true, type: Number })
  planBalanceAfter: number;

  @Prop({ required: true, type: Number })
  balanceAfter: number;
}

export const CreditCommitEventSchema =
  SchemaFactory.createForClass(CreditCommitEvent);

CreditCommitEventSchema.index({
  'metadata.tenantId': 1,
  timestamp: -1,
});
CreditCommitEventSchema.index({
  'metadata.tenantId': 1,
  'metadata.appId': 1,
  timestamp: -1,
});
CreditCommitEventSchema.index({
  'metadata.tenantId': 1,
  'metadata.appId': 1,
  planId: 1,
  timestamp: -1,
});
CreditCommitEventSchema.index({
  'metadata.tenantId': 1,
  'metadata.appId': 1,
  operation: 1,
  timestamp: -1,
});
