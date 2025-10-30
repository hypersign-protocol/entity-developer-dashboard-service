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
} from 'class-validator';
import {
  BusinessField,
  CountryCode,
  CustomerType,
  InterestedService,
  YearlyVolume,
} from '../constants/enum';
import { ExactlyOneTrue } from 'src/utils/customDecorator/kyc-kyb-selection.validator';
import { IsPhoneNumberByCountry } from 'src/utils/customDecorator/validate-phone-no-country.decorator';
@ExactlyOneTrue({
  message: 'Exactly one of isKyc, isKyb, or both must be true',
})
export class CreateCustomerOnboardingDto {
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
    example: CustomerType.BUSINESS,
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
  isKyc?: boolean;
  @ApiProperty({
    name: 'isKyb',
    description: 'Is kyb service is to be created for customer',
    example: false,
  })
  isKyb?: boolean;
  @ApiProperty({
    name: 'both',
    description: ' Is both kyc and kyb service to be created for customer',
    example: false,
    required: false,
  })
  @IsBoolean()
  both?: boolean;
}
export class CreateCustomerOnboardingRespDto {
  @ApiProperty({
    name: 'message',
    example: 'Customer Onboarding detail created successfully',
    description: 'Success message after creating customer onboarding detail',
  })
  message: string;
}
