import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ExpiryType, PageType } from '../dto/create-webpage-config.dto';
export type WebpageConfigDocument = WebPageConfig & Document;

@Schema({ timestamps: true })
export class WebPageConfig {
  // @Prop({ type: Date, required: true })
  // validUpto: Date;
  @Prop({ type: String, required: false, default: '#f8f9fa' })
  themeColor: string;
  @Prop({ type: String })
  ssiAccessToken: string;
  @Prop({ type: String })
  kycAccessToken: string;
  @Prop({ type: String, enum: ExpiryType, required: true })
  expiryType: ExpiryType;
  @Prop({ type: String })
  serviceId: string;
  @Prop({ type: Date })
  expiryDate: Date;
  @Prop({ type: String })
  pageDescription: string;
  @Prop({ type: String })
  pageTitle: string;
  @Prop({ type: String, enum: PageType, default: PageType.KYC })
  pageType: string;
  @Prop({ type: String })
  generatedUrl: string;
  @Prop({ type: String })
  tenantUrl: string;
}

export const WebPageConfigSchema = SchemaFactory.createForClass(WebPageConfig);
