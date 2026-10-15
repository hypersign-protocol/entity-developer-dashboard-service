import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { KybVerificationEnum } from '../constants/identifier-types';

export enum WebhookVerificationType {
  BUSINESS = 'business_verification',
}

export class CompanyVerificationWebhookDataDto {
  @ApiProperty({ example: 'company.verification.updated' })
  @IsIn(['company.verification.updated'])
  event: 'company.verification.updated';

  @ApiProperty({ description: 'ID-Service company ID' })
  @IsMongoId()
  companyId: string;

  @ApiProperty({
    enum: [KybVerificationEnum.Approved, KybVerificationEnum.Rejected],
  })
  @IsIn([KybVerificationEnum.Approved, KybVerificationEnum.Rejected])
  status: KybVerificationEnum;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  statusReason?: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  rejectReason?: string;

  @ApiProperty({ example: '2026-10-13T10:00:00.000Z' })
  @IsDateString()
  createdAt: string;
}

export class CompanyVerificationWebhookDto {
  @ApiProperty({ enum: WebhookVerificationType })
  @IsIn([WebhookVerificationType.BUSINESS])
  type: WebhookVerificationType.BUSINESS;

  @ApiProperty()
  @IsBoolean()
  success: boolean;

  @ApiProperty({ enum: ['dev', 'prod'] })
  @IsIn(['dev', 'prod'])
  environment: 'dev' | 'prod';

  @ApiProperty({ type: CompanyVerificationWebhookDataDto })
  @ValidateNested()
  @Type(() => CompanyVerificationWebhookDataDto)
  data: CompanyVerificationWebhookDataDto;
}
