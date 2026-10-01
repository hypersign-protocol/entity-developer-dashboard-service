import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsString,
} from 'class-validator';
import { TimeUnit } from '../constants/enum';

export class CreditDetail {
  @ApiProperty({
    name: 'amount',
    description: 'Credit amount',
    example: 500,
  })
  amount: number;
  @ApiProperty({
    name: 'validityPeriod',
    description: 'Credit validity period',
    example: 60,
  })
  @IsNotEmpty()
  @IsNumber()
  validityPeriod: number;
  @ApiProperty({
    name: 'validityPeriodUnit',
    description: 'Unit of validity period',
    example: TimeUnit.Days,
    enum: TimeUnit,
  })
  @IsEnum(TimeUnit)
  @IsNotEmpty()
  validityPeriodUnit: TimeUnit;
  @ApiProperty({
    name: 'amountDenom',
    description:
      'Denomination of the credit amount (e.g., currency or token unit)',
    example: 'uHID',
  })
  @IsString()
  @IsNotEmpty()
  amountDenom: string;
}
export class ProcessCustomerOnboardingRespDto {
  @ApiProperty({
    name: 'message',
    example: 'Customer onboarding completed successfully',
    description: 'Success message after processing customer onboarding detail',
  })
  message: string;
}
