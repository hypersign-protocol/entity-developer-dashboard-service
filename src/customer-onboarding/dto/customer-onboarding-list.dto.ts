import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsEnum, IsInt, IsOptional, Max } from 'class-validator';
import { FetchCustomerOnboardingRespDto } from './create-customer-onboarding.dto';
import { CreditStatus } from '../constants/enum';
import { PaginationDto } from 'src/utils/pagination.dto';

export class CustomerOnboardingListRespDto {
  @ApiProperty({
    description: 'Total number of onboarding records matching the filter',
    example: 42,
  })
  @IsInt()
  totalCount: number;

  @ApiProperty({
    description: 'Onboarding records for the requested page',
    type: FetchCustomerOnboardingRespDto,
    isArray: true,
  })
  @IsArray()
  data: FetchCustomerOnboardingRespDto[];
}

export class CustomerOnboardingListQueryDto extends PaginationDto {
  @IsOptional()
  page?: number = 1;

  @IsOptional()
  @Max(20)
  limit?: number = 10;

  @IsOptional()
  @IsEnum(CreditStatus)
  status?: CreditStatus;
}
