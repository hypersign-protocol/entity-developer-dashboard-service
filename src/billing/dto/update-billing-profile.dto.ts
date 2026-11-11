import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  IsIn,
  IsArray,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class BillingAddressDto {
  @ApiProperty({ example: '12 MG Road' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  street: string;

  @ApiProperty({ example: 'Bengaluru' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  city: string;

  @ApiProperty({ example: 'Karnataka' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  province: string;

  @ApiProperty({ example: '560001' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  postalCode: string;

  @ApiProperty({ example: 'IN', description: 'ISO 3166-1 alpha-2' })
  @Matches(/^[A-Z]{2}$/, { message: 'country must be a 2-letter ISO code' })
  country: string;
}

export class BillingTaxIdDto {
  @ApiProperty({ example: 'GSTIN' })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiProperty({ example: '29ABCDE1234F1Z5' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  number: string;
}

export class UpdateBillingProfileDto {
  @ApiProperty({ example: 'Acme Technologies Private Limited' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  legalName: string;

  @ApiProperty({ example: 'billing@acme.example' })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({
    example: '+49 30 12345678',
    description:
      'International form (+<country code> …). Needed for Global customers to pay online. Omit or send "" to remove it.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiProperty({ type: BillingAddressDto })
  @ValidateNested()
  @Type(() => BillingAddressDto)
  address: BillingAddressDto;

  @ApiPropertyOptional({
    example: '29',
    description:
      'India: 2-digit GST state code. Taken from the GSTIN when one is given',
  })
  @IsOptional()
  @Matches(/^\d{2}$/, { message: 'gstStateCode must be 2 digits' })
  gstStateCode?: string;

  @ApiProperty({ type: [BillingTaxIdDto] })
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => BillingTaxIdDto)
  taxIds: BillingTaxIdDto[];
}

// PATCH /admin/billing/profiles/:orgId: the full profile, plus admin-only fields.
export class AdminUpdateBillingProfileDto extends UpdateBillingProfileDto {
  @ApiPropertyOptional({
    enum: ['IN', 'GLOBAL'],
    description: 'Changes the billing region',
  })
  @IsOptional()
  @IsIn(['IN', 'GLOBAL'])
  region?: 'IN' | 'GLOBAL';

  @ApiPropertyOptional({
    description: 'Clears the lock set by the first invoice',
  })
  @IsOptional()
  @IsBoolean()
  unlock?: boolean;

  @ApiProperty({ example: 'Customer sent their GST certificate by email' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  reason: string;
}
