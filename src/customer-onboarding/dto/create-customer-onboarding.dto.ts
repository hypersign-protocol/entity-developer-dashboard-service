import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsEmpty,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsString,
  Matches,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CountryCode, CustomerType } from '../constants/enum';
import { Type } from 'class-transformer';

export class AddressDto {
  @ApiProperty({
    example: '123 Baker Street',
    description: 'Street address of the company',
  })
  @IsNotEmpty()
  @IsString()
  @MinLength(5, { message: 'Street must be at least 3 characters long' })
  @Matches(/^(?=.*[a-zA-Z0-9])[a-zA-Z0-9\s,'\-\/#\.]+$/, {
    message:
      'Street must contain at least one letter or number, and can include spaces and symbols like , . - / #',
  })
  street: string;
  @ApiProperty({
    name: 'province',
    example: 'California',
    description: 'Province or state where the company is located',
  })
  @IsNotEmpty()
  @IsString()
  province: string;
  @ApiProperty({
    name: 'postalCode',
    example: '94016',
    description: 'Postal or ZIP code of the company',
  })
  @IsNotEmpty()
  @IsString()
  postalCode: string;
  @ApiProperty({
    name: 'city',
    example: 'San Francisco',
    description: 'City where the company is located',
  })
  @IsNotEmpty()
  @IsString()
  city: string;
  @ApiProperty({
    name: 'country',
    example: 'US',
    description:
      'Country where the company is located (ISO Alpha-2 code preferred)',
    enum: CountryCode,
  })
  @IsNotEmpty()
  @IsString()
  @IsIn(CountryCode)
  country: string;
}
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
    name: 'customerEmail',
    example: 'xyz@gmail.com',
    description: 'Email of the customer',
  })
  @IsNotEmpty()
  @IsEmail()
  customerEmail: string;
  @ApiProperty({
    name: 'companyLogo',
    description: 'logo url og company',
    example: 'https://logo.com/logo.png',
  })
  @IsNotEmpty()
  @IsString()
  companyLogo: string;
  @ApiProperty({
    name: 'domain',
    description: 'domain of the company',
    example: 'hypermine.in',
  })
  @IsEmpty()
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
    name: 'taxId',
    description: 'tax identification number of the company',
    example: 'TAX123456',
  })
  @IsNotEmpty()
  @IsString()
  taxId: string;
  @ApiProperty({
    name: 'address',
    description: 'address of the company',
    example: AddressDto,
  })
  @Type(() => AddressDto)
  @ValidateNested()
  address: AddressDto;
  @ApiProperty({
    name: 'businessLegalName',
    description: 'legal name of the business',
    example: 'Hypermine Solutions Pvt Ltd',
  })
  @IsNotEmpty()
  @IsString()
  businessLegalName: string;
  @ApiProperty({
    name: 'linkdinUrl',
    description: 'linkdin profile url of the company',
    example: 'https://www.linkedin.com/company/hypermine',
    required: false,
  })
  @IsNotEmpty()
  @IsString()
  linkdinUrl?: string;
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
