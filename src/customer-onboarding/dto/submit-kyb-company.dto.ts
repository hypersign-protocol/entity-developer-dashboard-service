import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CountryCode, SupportedKybDocument } from '../constants/enum';
import {
  RegistrationNumberTypes,
  TaxIdTypes,
} from '../constants/identifier-types';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsValidCompanyIdentifiers } from '../../utils/customDecorator/valid-company-identifiers.decorator';

export class KybCompanyAddressDto {
  @ApiProperty({ example: '12 Market Road' })
  @IsNotEmpty()
  @IsString()
  street: string;

  @ApiProperty({ example: 'Karnataka' })
  @IsNotEmpty()
  @IsString()
  province: string;

  @ApiProperty({ example: '560001' })
  @IsNotEmpty()
  @IsString()
  postalCode: string;

  @ApiProperty({ example: 'Bengaluru' })
  @IsNotEmpty()
  @IsString()
  city: string;

  @ApiProperty({ example: 'IN' })
  @IsNotEmpty()
  @IsString()
  country: string;
}

export class KybCompanyFieldsDto {
  @ApiProperty({ example: 'Example Private Limited' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ example: 'example.com' })
  @IsNotEmpty()
  @IsString()
  domain: string;

  @ApiProperty({ example: 'Asia' })
  @IsNotEmpty()
  @IsString()
  region: string;

  @ApiProperty({
    example: 'IN',
    enum: CountryCode,
    description: 'Country of company registration (ISO 3166-1 alpha-2).',
  })
  @IsNotEmpty()
  @IsIn(CountryCode)
  @IsValidCompanyIdentifiers()
  countryOfRegistration: string;

  @ApiPropertyOptional({ example: 'U12345KA2024PTC123456' })
  @IsOptional()
  @IsString()
  registrationNumber?: string;

  @ApiPropertyOptional({
    example: 'CIN',
    enum: [...new Set(RegistrationNumberTypes.map(({ code }) => code))],
    description:
      'Must be a registration type supported for countryOfRegistration.',
  })
  @IsOptional()
  @IsString()
  registrationNumberType?: string;

  @ApiPropertyOptional({
    example: 'GSTIN',
    enum: [...new Set(TaxIdTypes.map(({ code }) => code))],
    description: 'Must be a tax ID type supported for countryOfRegistration.',
  })
  @IsOptional()
  @IsString()
  taxIdType?: string;

  @ApiPropertyOptional({ example: '29ABCDE1234F1Z5' })
  @IsOptional()
  @IsString()
  taxIdNumber?: string;

  @ApiPropertyOptional({ type: KybCompanyAddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => KybCompanyAddressDto)
  address?: KybCompanyAddressDto;
}

export class SubmitKybCompanyMultipartDto {
  @ApiProperty({
    type: KybCompanyFieldsDto,
    example: {
      name: 'Example Private Limited',
      domain: 'example.com',
      region: 'Asia',
      countryOfRegistration: 'IN',
      registrationNumber: 'U12345KA2024PTC123456',
      registrationNumberType: 'CIN',
      taxIdType: 'GSTIN',
      taxIdNumber: '29ABCDE1234F1Z5',
      address: {
        street: '12 Market Road',
        province: 'Karnataka',
        postalCode: '560001',
        city: 'Bengaluru',
        country: 'IN',
      },
    },
    description:
      'Company fields. Base required fields are name, domain, region, and countryOfRegistration. Identifier pairs must be valid for the selected country.',
  })
  company: KybCompanyFieldsDto;

  @ApiProperty({
    type: () => KybDocumentMultipartDto,
    isArray: true,
    example: [
      {
        type: SupportedKybDocument.CERTIFICATE_OF_INCORPORATION,
        file: 'certificate-of-incorporation.pdf',
      },
    ],
    description:
      'Each document contains its type and uploaded file. Include one item per file.',
  })
  documents: KybDocumentMultipartDto[];
}

class KybDocumentMultipartDto {
  @ApiProperty({
    enum: Object.values(SupportedKybDocument),
    example: SupportedKybDocument.CERTIFICATE_OF_INCORPORATION,
  })
  type: SupportedKybDocument;

  @ApiProperty({
    type: 'string',
    format: 'binary',
    example: 'certificate-of-incorporation.pdf',
    description: `Allowed MIME types: ${(
      process.env.SUPPORTED_FILE_TYPES ||
      'image/jpeg,image/png,image/gif,application/pdf'
    )
      .split(',')
      .map((fileType) => fileType.trim())
      .join(', ')}. Maximum size: ${Number.parseInt(
      process.env.FILE_MAX_SIZE || '5242880',
      10,
    )} bytes per file.`,
  })
  file: string;
}
