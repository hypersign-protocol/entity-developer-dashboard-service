import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import {
  BusinessField,
  CountryCode,
  CreditStatus,
  CustomerType,
  InterestedService,
  OnboardingStep,
  StepStatus,
  YearlyVolume,
} from '../constants/enum';
import { ExactlyOneTrue } from 'src/utils/customDecorator/kyc-kyb-selection.validator';
import { IsPhoneNumberByCountry } from 'src/utils/customDecorator/validate-phone-no-country.decorator';
import { Type } from 'class-transformer';
@ExactlyOneTrue({
  message: 'Exactly one of isKyc, isKyb, or both must be true',
})
export class CustomerOnboardingBasicDto {
  @ApiProperty({
    name: 'companyName',
    example: 'hypermine',
    description: 'Name of the company',
    required: true,
  })
  @IsNotEmpty()
  @IsString()
  companyName: string;

  @ApiProperty({
    name: 'companyLogo',
    description: 'logo url og company',
    example: 'https://logo.com/logo.png',
  })
  @IsNotEmpty()
  @IsString()
  companyLogo: string;
  @ApiProperty({
    name: 'customerEmail',
    example: 'xyz@gmail.com',
    description: 'Email of the customer',
  })
  @IsNotEmpty()
  @IsEmail()
  customerEmail: string;
  @ApiProperty({
    name: 'domain',
    description: 'domain of the company',
    example: 'hypermine.in',
  })
  @IsNotEmpty()
  @IsString()
  domain: string;
  @ApiProperty({
    name: 'type',
    description: 'type of customer',
    enum: CustomerType,
    example: 'BUSINESS',
  })
  @IsEnum(CustomerType)
  @IsString()
  type: CustomerType;
  @ApiProperty({
    name: 'country',
    example: 'IN',
    description:
      'Country where the company is located (ISO Alpha-2 code preferred)',
    enum: CountryCode,
  })
  @IsNotEmpty()
  @IsString()
  @IsIn(CountryCode)
  country: string;
  @ApiProperty({
    name: 'registrationNumber',
    description: 'registration number of the company',
    example: '1234567890',
  })
  @IsNotEmpty()
  @IsString()
  registrationNumber: string;
  @ApiProperty({
    name: 'billingAddress',
    description: 'billing address of the company',
    example: ' ',
    required: false,
  })
  @IsOptional()
  @IsString()
  billingAddress: string;
  @ApiProperty({
    name: 'twitterUrl',
    description: 'twitter profile url of the company',
    example: 'https://www.twitter.com/hypermine',
  })
  @IsNotEmpty()
  @IsString()
  twitterUrl: string;
  @ApiProperty({
    name: 'linkedinUrl',
    description: 'linkdin profile url of the company',
    example: 'https://www.linkedin.com/company/hypermine',
    required: false,
  })
  @IsNotEmpty()
  @IsString()
  linkedinUrl?: string;
  @ApiProperty({
    name: 'phoneNumber',
    description: 'Contact phone number of the company',
    example: '6234572090',
  })
  @IsNotEmpty()
  @IsString()
  @IsPhoneNumberByCountry()
  phoneNumber: string;
  @ApiProperty({
    name: 'interestedService',
    description: 'Services interested by customer',
    example: [InterestedService.ID_VERIFICATION],
    enum: InterestedService,
    isArray: true,
  })
  @ArrayNotEmpty()
  @IsEnum(InterestedService, { each: true })
  interestedService: InterestedService[];
  @ApiProperty({
    name: 'yearlyVolume',
    description: 'Yearly verification volume',
    example: YearlyVolume.ZERO_ONEK,
    enum: YearlyVolume,
  })
  @IsNotEmpty()
  @IsEnum(YearlyVolume)
  yearlyVolume: YearlyVolume;
  @ApiProperty({
    name: 'businessField',
    description: 'Industry fields the company operates in',
    example: [BusinessField.FINTECH],
    isArray: true,
    enum: BusinessField,
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(BusinessField, { each: true })
  businessField: BusinessField[];

  @ApiProperty({
    name: 'isKyc',
    description: 'Is kyc service is to be created for customer',
    example: true,
  })
  @IsBoolean()
  isKyc: boolean;
  @ApiProperty({
    name: 'isKyb',
    description: 'Is kyb service is to be created for customer',
    example: false,
  })
  @IsBoolean()
  isKyb: boolean;
}
export class CreateCustomerOnboardingDto extends CustomerOnboardingBasicDto {
  @ApiProperty({
    name: 'isKycAndKyb',
    description: ' Is both kyc and kyb service to be created for customer',
    example: false,
  })
  @IsBoolean()
  isKycAndKyb: boolean;
}
export class CreateCustomerOnboardingRespDto extends CustomerOnboardingBasicDto {
  @ApiProperty({
    name: 'userId',
    description: 'Unique identification of user',
    example: '1751435627461-e8bdcf4f-3573-467a-841a-9263b4d0e721',
  })
  @IsString()
  userId: string;
  @ApiProperty({
    name: 'onboardingStatus',
    description: 'Onboarding process status of the customer',
    example: CreditStatus.INITIATED,
  })
  @IsEnum(CreditStatus)
  onboardingStatus: CreditStatus;
  @ApiProperty({
    name: '_id',
    description: 'Unique identifier for the customer onboarding record',
    example: '6902f58a7e4d5c055e9ab950',
    required: true,
  })
  @IsString()
  _id?: string;
  @ApiProperty({
    name: 'createdAt',
    description: 'Time at which customer is onboarded',
    example: '2025-10-30T12:50:03.984Z',
  })
  @IsString()
  createdAt: string;
  @ApiProperty({
    name: 'updatedAt',
    description: 'Time at which onboarded customer last updated',
    example: '2025-11-01T12:50:03.984Z',
  })
  @IsString()
  updatedAt: string;
}
export class CustomerStepLogs {
  @ApiProperty({
    name: 'step',
    description: 'Onboarding step',
    example: OnboardingStep.CREATE_SSI_SERVICE,
    enum: OnboardingStep,
  })
  @IsEnum(OnboardingStep)
  step: OnboardingStep;
  @ApiProperty({
    name: 'time',
    description: 'Timestamp of the log entry',
    example: '2025-11-01T12:50:03.984Z',
  })
  @IsString()
  time: string;
  @ApiProperty({
    name: 'status',
    description: 'Status of the onboarding step',
    example: 'COMPLETED',
    enum: StepStatus,
  })
  @IsEnum(StepStatus)
  status: StepStatus;
  @ApiProperty({
    name: 'failureReason',
    description: 'Reason for failure if the step failed',
    example: 'Invalid documents provided',
    required: false,
  })
  @IsOptional()
  @IsString()
  failureReason?: string;
}
export class FetchCustomerOnboardingRespDto extends CreateCustomerOnboardingRespDto {
  @ApiProperty({
    name: 'logs',
    description: 'Logs related to customer onboarding process',
    type: CustomerStepLogs,
    required: false,
    isArray: true,
  })
  @IsOptional()
  @Type(() => CustomerStepLogs)
  @ValidateNested()
  logs?: CustomerStepLogs;
  @ApiProperty({
    name: 'businessIdName',
    description: 'Name of business id for kyb',
    example: 'hypermine-kyb-did',
  })
  @IsOptional()
  @IsString()
  businessIdName?: string;
  @ApiProperty({
    name: 'businessId',
    description: 'Did document id for business',
    example: 'did:ion:EiDgH6...',
  })
  @IsOptional()
  @IsString()
  businessId?: string;
  @ApiProperty({
    name: 'ssiSubdomain',
    description: 'Subdomain for ssi service',
    example: 'ent-abc123',
  })
  @IsOptional()
  @IsString()
  ssiSubdomain?: string;
  @ApiProperty({
    name: 'kycSubdomain',
    description: 'Subdomain for kyc service',
    example: 'ent-def123',
  })
  @IsOptional()
  @IsString()
  kycSubdomain?: string;
  @ApiProperty({
    name: 'ssiServiceId',
    example: 'adcc346677',
    description: 'Service id for ssi service',
  })
  @IsOptional()
  @IsString()
  ssiServiceId?: string;
  @ApiProperty({
    name: 'kycServiceId',
    example: 'dbc1234346677',
    description: 'Service id for kyc service',
  })
  @IsOptional()
  @IsString()
  kycServiceId?: string;
}
