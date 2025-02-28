import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNotEmpty, IsString, ValidateNested } from 'class-validator';

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
