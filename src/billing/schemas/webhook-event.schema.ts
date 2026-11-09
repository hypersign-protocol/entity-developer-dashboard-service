import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export enum WebhookEventStatus {
  RECEIVED = 'RECEIVED', // stored, the sync hasn't finished yet
  PROCESSED = 'PROCESSED', // the order was synced
  IGNORED = 'IGNORED', // no order of ours matches it
  FAILED = 'FAILED', // the sync failed; the reconciliation job picks the order up
}

export type WebhookEventDocument = WebhookEvent & Document;

// One per delivered gateway event (ADR §4.5). The unique provider + eventId
// turns redeliveries into no-ops. The event never decides anything itself: it
// only triggers OrderService.sync(), which reads the provider's API.
@Schema({ collection: 'webhookEvents', timestamps: true })
export class WebhookEvent {
  @Prop({ type: String, required: true })
  provider: string;
  @Prop({ type: String, required: true })
  eventId: string; // Razorpay: the X-Razorpay-Event-Id header
  @Prop({ type: String, required: true })
  type: string;
  @Prop({
    type: String,
    enum: WebhookEventStatus,
    default: WebhookEventStatus.RECEIVED,
  })
  status: WebhookEventStatus;
  @Prop({ type: String, default: null })
  orderId: string | null;
  @Prop({ type: Number, default: 0 })
  attempts: number; // deliveries handled, redeliveries included
  @Prop({ type: Date, required: true })
  receivedAt: Date;
  @Prop({ type: Date, default: null })
  processedAt: Date | null;
  @Prop({ type: String, default: null })
  error: string | null;
  @Prop({ type: Object, default: null })
  payload: Record<string, unknown> | null; // kept for support
}

export const WebhookEventSchema = SchemaFactory.createForClass(WebhookEvent);
WebhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });
WebhookEventSchema.index({ status: 1, receivedAt: -1 });
