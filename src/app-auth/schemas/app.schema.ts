import { ApiProperty, ApiHideProperty } from '@nestjs/swagger';
import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
} from 'class-validator';
import { supportedServiceResponseDto } from 'src/supported-service/dto/create-supported-service.dto';
import { APP_ENVIRONMENT } from 'src/supported-service/services/iServiceList';
export type AppDocument = App & Document;

@Schema()
export class App {
  @ApiHideProperty()
  @Prop()
  userId: string;

  @ApiProperty({
    description: 'Application name',
    example: 'demo app',
  })
  @IsNotEmpty()
  @IsString()
  @IsNotEmpty()
  @Prop({ required: true })
  appName: string;

  @ApiProperty({
    description: 'Application id',
    example: 'app-1',
  })
  @Prop({ required: false })
  appId: string;

  @ApiHideProperty()
  @Prop()
  apiKeySecret: string;

  @ApiProperty({
    description: 'Data Vault Id',
    example: 'hs-edv-id-1',
  })
  @Prop()
  edvId: string;

  @Prop()
  @ApiProperty({
    description: 'Key Manager Service Id',
    example: 'KMS Id for this application',
  })
  kmsId: string;

  @ApiHideProperty()
  @Prop()
  apiKeyPrefix: string;
  @ApiProperty({
    description: 'hid wallet address',
    example: 'hid17wgv5xqdlldvjp3ly4rsl4s48xls0ut4rtvupt',
  })
  @Prop()
  walletAddress: string;

  @ApiProperty({
    description: 'description',
    example: 'Example description',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Prop({ required: false })
  description: string;

  @ApiProperty({
    description: 'whitelistedCors',
    example: ['https://example.com'],
    isArray: true,
  })
  @IsArray()
  @Prop({ required: false })
  whitelistedCors: Array<string>;

  @ApiProperty({
    description: 'logoUrl',
    example: 'http://image.png',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsUrl()
  @Prop({ required: false })
  logoUrl: string;

  @IsOptional()
  @IsString()
  @Prop({ required: false, unique: false })
  subdomain: string;
  @Prop({ required: true })
  @ApiProperty({
    description: 'services',
    type: supportedServiceResponseDto,
    required: true,
    isArray: true,
  })
  services: Array<supportedServiceResponseDto>;

  @ApiProperty({
    description: 'dependentServices',
    example: ['1212312123mmmaweeem'],
    isArray: true,
  })
  @IsArray()
  @Prop({ required: false })
  dependentServices: Array<string>;

  @IsOptional()
  @IsString()
  @Prop({ required: false, type: String, enum: APP_ENVIRONMENT })
  env: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'issuerDid',
    required: false,
  })
  @Prop({ required: false })
  issuerDid: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'issuerVerificationMethodId',
    required: false,
  })
  @Prop({ required: false })
  issuerVerificationMethodId: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'domain',
    required: false,
  })
  @Prop({ required: false })
  domain: string;

  @IsOptional()
  @IsBoolean()
  @ApiProperty({
    description: 'domain',
    required: false,
  })
  @Prop({ required: false })
  hasDomainVerified?: boolean;

  @IsOptional()
  @Prop({ required: false })
  domainLinkageCredentialString?: string;

  @IsOptional()
  @Prop({ required: false })
  authzTxnHash?: string;
}
export class createAppResponse extends App {
  @ApiProperty({
    description: 'Application Secret',
    example: 'app-secret-1',
  })
  apiKeySecret: string;

  @ApiProperty({
    description: 'Your base API url',
    example: 'yoursubdomain.api.entity.hypersign.id',
  })
  tenantUrl: string;
}

export const AppSchema = SchemaFactory.createForClass(App);

AppSchema.index({ apiKeyPrefix: 1, apiKeySecret: 1 }, { unique: true });
AppSchema.index({ appId: 1 }, { unique: true });
AppSchema.index({ appId: 1, walletAddress: 1, edvId: 1 }, { unique: true });
