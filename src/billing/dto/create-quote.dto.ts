import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateQuoteDto {
  @ApiProperty({ description: 'The ID Service app being topped up' })
  @IsString()
  @IsNotEmpty()
  appId: string;

  @ApiPropertyOptional({
    example: 'IN_2499',
    description: 'Send this or customAmountMinor',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  planCode?: string;

  @ApiPropertyOptional({
    example: 320000,
    description: 'Minor units, whole major units only',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  customAmountMinor?: number;

  @ApiPropertyOptional({ example: 'FOUNDING8' })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  couponCode?: string;
}
