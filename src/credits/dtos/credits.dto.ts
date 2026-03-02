import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsString,
  ValidateNested,
} from 'class-validator';
import { TimeUnit } from 'src/customer-onboarding/constants/enum';

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
  @IsNumber()
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
  @IsNumber()
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
