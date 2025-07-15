import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type IpDocument = IpResolver & Document;

@Schema()
export class IpResolver {
  @Prop({ required: true, type: String })
  ip: string;
  @Prop({ required: true, type: String })
  continentCode: string;
  @Prop({ required: true, type: String })
  continentName: string;
  @Prop({ required: true, type: String })
  countryCode: string;
  @Prop({ required: true, type: String })
  countryName: string;
  @Prop({ required: true, type: String })
  region: string;
  @Prop({ required: true, type: String })
  city: string;
  @Prop({ required: true, type: Array<string> })
  timeZone: Array<string>;
}
export const IpResolverSchema = SchemaFactory.createForClass(IpResolver);
