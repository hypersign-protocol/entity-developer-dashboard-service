import { PartialType } from '@nestjs/swagger';
import { CreateCustomerOnboardingDto } from './create-customer-onboarding.dto';

export class UpdateCustomerOnboardingDto extends PartialType(
  CreateCustomerOnboardingDto,
) {}
