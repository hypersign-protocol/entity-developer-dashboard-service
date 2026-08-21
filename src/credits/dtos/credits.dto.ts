import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { TimeUnit } from 'src/customer-onboarding/constants/enum';
import {
  CreditSourceEnum,
  CreditStatus,
  scope,
} from '../schemas/credit.schema';
import { SERVICE_TYPES } from 'src/supported-service/services/iServiceList';

export class ApiCreditDto {
  @ApiProperty({ example: 15000, description: 'Total API credits granted' })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  total: number;

  @ApiProperty({
    example: 0,
    required: false,
    description: 'Credits already used',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  used?: number;
}

export class CreateCreditDto {
  @ApiProperty({
    example: 'app-123',
    description: 'Application/service identifier',
  })
  @IsString()
  @IsNotEmpty()
  serviceId: string;

  @ApiProperty({ type: ApiCreditDto })
  @Type(() => ApiCreditDto)
  @ValidateNested()
  apiCredit: ApiCreditDto;

  @ApiProperty({ example: 30, description: 'Credit validity in calendar days' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  validityDays: number;
}

export class ListCreditsDto {
  @ApiProperty({ required: false, example: 'app-123' })
  @IsOptional()
  @IsString()
  serviceId?: string;
}

export class CreditListResponseDto {
  @ApiProperty({ type: [CreateCreditDto] })
  data: CreateCreditDto[];

  @ApiProperty({ example: 42 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;
}

export class OnChainAllowanceResponseDto {
  @ApiProperty({ example: 500 })
  amount: number;

  @ApiProperty({ example: 'uhid' })
  denom: string;

  @ApiPropertyOptional({ example: 0 })
  usedAmount?: number;
}

export class CreditPlanResponseDto {
  @ApiProperty({ example: '6a7d5998ce4c1a1d6a4aafd0' })
  _id: string;

  @ApiProperty({ example: 'bf34d591632f37e1facc5ba40f91d27340ce' })
  serviceId: string;

  @ApiProperty({ enum: SERVICE_TYPES, example: SERVICE_TYPES.CAVACH_API })
  serviceType: SERVICE_TYPES;

  @ApiProperty({ example: 'payment_01J5YQ3H8P7M' })
  referenceId: string;

  @ApiProperty({ type: ApiCreditDto })
  apiCredit: ApiCreditDto;

  @ApiProperty({ example: 60 })
  validityDays: number;

  @ApiProperty({ example: 100 })
  criticalBalance: number;

  @ApiPropertyOptional({ format: 'date-time' })
  expiresAt?: string;

  @ApiProperty({ enum: CreditStatus, example: CreditStatus.ACTIVE })
  status: CreditStatus;

  @ApiPropertyOptional({ type: OnChainAllowanceResponseDto })
  onChainAllowance?: OnChainAllowanceResponseDto;

  @ApiPropertyOptional({ type: [String], enum: scope })
  onChainAllowanceScopes?: scope[];

  @ApiPropertyOptional({
    example: '1784098395195-bc9b1a4f-39f4-4ccd-8dd4-e087efdf040c',
  })
  creditedBy?: string;

  @ApiPropertyOptional({
    enum: CreditSourceEnum,
  })
  source?: CreditSourceEnum;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;

  @ApiProperty({ example: 0 })
  __v: number;
}

export class GetCreditsDto {
  @ApiProperty({
    name: 'appId',
    default: 'appId',
  })
  @IsNotEmpty()
  @IsString()
  appId: string;
}
class Credit {
  @ApiProperty({
    name: 'amount',
    description: 'Amount of allowance provided',
    example: '15000',
  })
  amount: string;
  @ApiProperty({
    name: 'denom',
    description: 'Denom of the token',
    example: 'uhid',
  })
  denom: string;
}
export class GrantAllowanceResponseDto {
  @ApiProperty({
    name: 'credit',
    description: 'detail of credit',
    type: Credit,
  })
  @Type(() => Credit)
  @ValidateNested({ each: true })
  credit: Credit;
  @ApiProperty({
    name: 'creditScope',
    description: 'Credit scopre provided',
    example: [
      'MsgRegisterDID',
      'MsgDeactivateDID',
      'MsgRegisterCredentialSchema',
      'MsgUpdateDID',
    ],
  })
  creditScope: Array<string>;
}

export class CreditRequestDto {
  @ApiProperty({
    name: 'amount',
    description: 'Amount of allowance provided',
    example: '15000',
  })
  amount: string;
  @ApiProperty({
    name: 'validityPeriod',
    description: 'Time till credit will be valie',
    example: '60',
  })
  @Type(() => Number)
  validityPeriod: number;
  @ApiProperty({
    name: 'validityPeriodUnit',
    description: 'unit for validity period',
    enum: TimeUnit,
  })
  @IsEnum(TimeUnit)
  validityPeriodUnit: TimeUnit;
  @ApiProperty({
    name: 'amountDenom',
    description: 'denom',
    example: 'uHid',
  })
  @IsString()
  amountDenom: string;
}

export class CreditResponseDto {
  @ApiProperty({
    name: 'message',
    description: 'Time till credit will be valie',
    example: 'Credit is successfully granted for service 6532468859078546',
  })
  @IsString()
  message: string;
}

export class GetCreditsQueryDto {
  @ApiPropertyOptional({
    description: 'Filter credits by status',
    enum: [CreditStatus.ACTIVE],
    example: CreditStatus.ACTIVE,
    required: false,
  })
  @IsOptional()
  @IsEnum([CreditStatus.ACTIVE])
  status?: CreditStatus;
}
