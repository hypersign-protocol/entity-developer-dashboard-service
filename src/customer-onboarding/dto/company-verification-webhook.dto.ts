import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
} from 'class-validator';
import { KybVerificationEnum } from '../constants/identifier-types';

export class CompanyVerificationWebhookDto {
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
}
