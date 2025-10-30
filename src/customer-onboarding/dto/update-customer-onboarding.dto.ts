import { ApiProperty, PartialType } from '@nestjs/swagger';
import { CreateCustomerOnboardingDto } from './create-customer-onboarding.dto';
import { Optional } from '@nestjs/common';
import { IsString } from 'class-validator';

export class UpdateCustomerOnboardingDto extends PartialType(
  CreateCustomerOnboardingDto,
) {
  @ApiProperty({
    name: 'businessIdName',
    description: 'Business identification name',
    example: 'My Business Ltd',
  })
  @Optional()
  @IsString()
  businessIdName?: string;
}
