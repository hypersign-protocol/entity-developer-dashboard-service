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
  IsUrl,
  Matches,
  ValidateIf,
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
import { IsPhoneNumberByCountry } from 'src/utils/customDecorator/validate-phone-no-country.decorator';
import { Type } from 'class-transformer';

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
    required: false,
  })
  @IsOptional()
  @IsNotEmpty()
  @IsString()
  @IsUrl({
    require_protocol: true,
  })
  companyLogo?: string;
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
  @Matches(/^(?!:\/\/)([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/, {
    message:
      'domain must be a valid domain name (e.g., example.com, sub.domain.io)',
  })
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
  @ValidateIf((o) => o.type === CustomerType.BUSINESS)
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
    required: false,
  })
  @IsOptional()
  @IsString()
  @ValidateIf((o) => o.twitterUrl !== '')
  @Matches(/^https?:\/\/(twitter\.com|x\.com)\/[A-Za-z0-9_]+\/?$/, {
    message: 'Invalid Twitter/X profile URL',
  })
  twitterUrl?: string;
  @ApiProperty({
    name: 'linkedinUrl',
    description: 'linkdin profile url of the company',
    example: 'https://www.linkedin.com/company/hypermine',
    required: false,
  })
  @IsOptional()
  @IsString()
  @ValidateIf((o) => o.linkedinUrl !== '')
  @Matches(
    /^https?:\/\/(www\.)?linkedin\.com\/(in|company)\/[A-Za-z0-9_-]+\/?$/,
    {
      message: 'Invalid LinkedIn profile URL',
    },
  )
  linkedinUrl?: string;
  @ApiProperty({
    name: 'telegramUrl',
    description: 'Telegram profile or channel URL',
    example: 'https://t.me/hypermine',
    required: false,
  })
  @IsOptional()
  @IsString()
  @ValidateIf((o) => o.telegramUrl !== '')
  @Matches(
    /^https?:\/\/(t\.me|telegram\.me)\/([A-Za-z0-9_]+|joinchat\/[A-Za-z0-9_-]+)\/?$/,
    { message: 'Invalid Telegram URL' },
  )
  telegramUrl?: string;
  @ApiProperty({
    name: 'phoneNumber',
    description: 'Contact phone number of the company',
    example: '6234572090',
  })
  @ValidateIf((o) => o.type === CustomerType.BUSINESS)
  @IsNotEmpty()
  @IsString()
  @IsPhoneNumberByCountry()
  phoneNumber: string;
  @ApiProperty({
    name: 'interestedService',
    description: 'Services interested by customer',
    example: [InterestedService.AGE_VERIFICATION],
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
}
export class CreateCustomerOnboardingDto extends CustomerOnboardingBasicDto {
  @ApiProperty({
    name: 'isRetry',
    description:
      'Indicates if the customer is retrying onboarding (re-request)',
    example: false,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  isRetry?: boolean;
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
