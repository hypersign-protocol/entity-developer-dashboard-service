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
