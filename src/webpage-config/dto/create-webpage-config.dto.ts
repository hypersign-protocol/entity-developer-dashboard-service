import { Optional } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';

export enum ExpiryType {
  ONE_MONTH = '1month',
  THREE_MONTHS = '3months',
  SIX_MONTHS = '6months',
  TWELVE_MONTHS = '12months',
  CUSTOM = 'custom',
}
export enum PageType {
  KYC = 'kyc',
  KYB = 'kyb',
}
export class CreateWebpageConfigDto {
  @ApiProperty({
    name: 'pageTitle',
    description: 'title of the page',
    example: 'KYC Verification',
  })
  @IsString()
  @IsNotEmpty()
  pageTitle: string;

  @ApiProperty({
    name: 'pageDescription',
    description: 'Description of the page',
    example: 'Complete your KYC verification process.',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  pageDescription: string;

  @ApiProperty({
    description: "Type of expiry — either a predefined duration or 'custom'",
    example: ExpiryType.THREE_MONTHS,
    enum: ExpiryType,
  })
  @IsEnum(ExpiryType)
  expiryType: ExpiryType;
  @ApiProperty({
    name: 'customExpiryDate',
    description: "Custom expiry date (required if expiryType is 'custom')",
    example: '2025-09-06',
  })
  @ValidateIf((o) => o.expiryType === 'custom')
  @IsDateString()
  @IsNotEmpty()
  customExpiryDate?: string;
  @ApiProperty({
    description: 'Type of the webpage page, either KYC or KYB',
    example: 'kyc',
    enum: PageType,
    default: 'kyc',
  })
  @Optional()
  @IsEnum(PageType)
  pageType?: 'kyc' | 'kyb';

  @ApiProperty({
    name: 'themeColor',
    description: 'Theme color',
    example: '#f8f9fa',
  })
  @IsString()
  @IsNotEmpty()
  themeColor: string;

  @ApiProperty({
    name: 'contactEmail',
    description: 'Contact email or API endpoint for communication',
    example: 'support@company.com',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  contactEmail?: string;
}
