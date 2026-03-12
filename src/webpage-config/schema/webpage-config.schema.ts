import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ExpiryType, PageType } from '../dto/create-webpage-config.dto';
import { Types } from 'mongoose';
export type WebpageConfigDocument = WebPageConfig & Document;

@Schema({ timestamps: true })
export class WebPageConfig {
  @Prop({ type: Types.ObjectId, default: () => new Types.ObjectId() })
  _id: Types.ObjectId;
  @Prop({ type: String, required: false, default: '#f8f9fa' })
  themeColor: string;
  @Prop({ type: String, enum: ExpiryType, required: true })
  expiryType: ExpiryType;
  @Prop({ type: String})
  serviceId: string;
  @Prop({ type: Date })
  expiryDate: Date;
  @Prop({ type: String, required: false })
  pageDescription?: string;
  @Prop({ type: String })
  pageTitle: string;
  @Prop({ type: String, enum: PageType, default: PageType.KYC })
  pageType: string;
  @Prop({ type: String, required: false })
  generatedUrl?: string;
  // @Prop({ type: String })
  // tenantUrl: string;
  @Prop({ type: String, required: false })
  contactEmail?: string;
}
export const WebPageConfigSchema = SchemaFactory.createForClass(WebPageConfig);
WebPageConfigSchema.index({ serviceId: 1, pageType: 1 }, { unique: true });
