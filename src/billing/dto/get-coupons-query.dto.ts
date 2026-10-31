import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';

export class GetCouponsQueryDto {
  @ApiProperty({ description: 'The ID Service app being topped up' })
  @IsString()
  @IsNotEmpty()
  appId: string;

  @ApiPropertyOptional({
    description: 'Selected plan, for previewDiscountMinor',
    example: 'IN_2499',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  planCode?: string;

  @ApiPropertyOptional({
    description: 'Custom amount in minor units, instead of planCode',
    example: 320000,
  })
  @ValidateIf((o) => o.customAmountMinor !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  customAmountMinor?: number;
}
