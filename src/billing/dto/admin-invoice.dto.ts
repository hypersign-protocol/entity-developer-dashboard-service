import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { OfflinePaymentMethod } from '../invoices/build-invoice';

export const OFFLINE_PAYMENT_METHODS: OfflinePaymentMethod[] = [
  'BANK_TRANSFER',
  'UPI',
  'CHEQUE',
  'CARD_OUTSIDE_DASHBOARD',
  'OTHER_SYSTEM',
];

export class OfflinePaymentDto {
  @ApiProperty({ enum: OFFLINE_PAYMENT_METHODS })
  @IsIn(OFFLINE_PAYMENT_METHODS)
  method: OfflinePaymentMethod;

  @ApiProperty({ example: 'UTR0012345678' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  reference: string;

  @ApiProperty({
    example: '2026-10-30',
    description: 'YYYY-MM-DD, not in the future',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'paidAt must be a date (YYYY-MM-DD)',
  })
  paidAt: string;
}

// docs/payment/api-contract.md §5: POST /admin/billing/invoices and /preview.
export class AdminInvoiceDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  appId: string;

  @ApiProperty({ example: 40000 })
  @IsInt()
  @Min(1)
  credits: number;

  @ApiProperty({ example: 30 })
  @IsInt()
  @Min(1)
  validityDays: number;

  @ApiProperty({
    example: 4000000,
    description: 'Minor units, excluding tax. 0 = Free credits',
  })
  @IsInt()
  @Min(0)
  amountMinor: number;

  @ApiPropertyOptional({
    description:
      'Required when amountMinor > 0. false (Collect payment) needs a gateway',
  })
  @IsOptional()
  @IsBoolean()
  isPaid?: boolean;

  @ApiPropertyOptional({
    type: OfflinePaymentDto,
    description: 'Required when isPaid is true',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => OfflinePaymentDto)
  payment?: OfflinePaymentDto;

  @ApiPropertyOptional({
    description:
      'Collect payment: Razorpay emails the link (default true). false: copy the link and send it yourself',
  })
  @IsOptional()
  @IsBoolean()
  notifyByEmail?: boolean;

  @ApiPropertyOptional({
    description:
      "Collect payment: where the link is emailed. Defaults to the profile's billing email",
  })
  @IsOptional()
  @IsEmail()
  notifyEmail?: string;

  @ApiPropertyOptional({
    example: 15,
    description:
      'Collect payment: days the link stays payable (1–30, default 15)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  linkExpiresInDays?: number;

  @ApiPropertyOptional({ description: 'Internal, never printed' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class InvoiceListQueryDto {
  @IsOptional() @IsString() appId?: string;
  @IsOptional() @IsString() orgId?: string;
  @IsOptional() @IsIn(['UNPAID', 'PAID', 'VOID']) status?: string;
  @IsOptional() @IsIn(['SELF_SERVE', 'ADMIN']) source?: string;
  @IsOptional()
  @IsIn(['GATEWAY', 'OFFLINE', 'COMPLIMENTARY'])
  settlement?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number;
}

export const PAYMENT_LINK_STATUSES = [
  'CREATED',
  'PENDING_PAYMENT',
  'PAID',
  'FULFILLED',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
  'NEEDS_REVIEW',
];

export class PaymentLinkListQueryDto {
  @IsOptional() @IsString() appId?: string;
  @IsOptional() @IsString() orgId?: string;
  @IsOptional() @IsIn(PAYMENT_LINK_STATUSES) status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number;
}

export class CancelPaymentLinkDto {
  @ApiProperty({ example: 'Customer paid by bank transfer instead' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
