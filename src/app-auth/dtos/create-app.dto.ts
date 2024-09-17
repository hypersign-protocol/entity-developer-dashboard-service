import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  Validate,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { IsUrlEmpty } from 'src/utils/customDecorator/isUrl.decorator';
import { Transform } from 'class-transformer';
import validator from 'validator';
import { SanitizeUrlValidator } from 'src/utils/sanitizeUrl.validator';
import {
  SERVICE_TYPES,
  APP_ENVIRONMENT,
} from 'src/supported-service/services/iServiceList';

export class CreateAppDto {
  @ApiProperty({
    description: 'Application Name',
    example: 'demo app',
  })
  @Transform(({ value }) => validator.trim(value))
  @Length(5, 50)
  appName: string;

  @ApiProperty({
    description: 'Whitelisted cors',
    example: ['https://example.com'],
    isArray: true,
    required: false,
  })
  @IsOptional()
  @IsArray()
  // @Matches(/^(https?:\/\/[^ ]+|\*)$/, {
  //   each: true,
  //   message: 'Whitelisted cors must be a valid url or *',
  // })
  @Validate(SanitizeUrlValidator)
  whitelistedCors: Array<string>;

  @ApiProperty({
    description: 'description',
    example: 'Example description',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  description: string;
  @ApiProperty({
    description: 'logoUrl',
    example: 'http://image.png',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsUrlEmpty()
  logoUrl: string;
  @ApiProperty({
    description: 'services',
    example: [SERVICE_TYPES.SSI_API],
    required: true,
    isArray: true,
  })
  @IsArray({ message: 'serviceId must be an array' })
  @ArrayNotEmpty({ message: 'serviceIds cannot be empty' })
  @IsString({
    each: true,
    message: 'Each value in serviceIds must be a string',
  })
  @IsEnum(SERVICE_TYPES, {
    each: true,
    message:
      "services must be one of the following values: 'CAVACH_API', 'SSI_API'",
  })
  serviceIds: [SERVICE_TYPES];

  @ApiProperty({
    description: 'dependentServices',
    example: ['asdasda123123123123'],
    isArray: true,
    required: false,
  })
  @IsOptional()
  @IsArray()
  dependentServices: Array<string>; // ids of dependent services / apps

  @ApiProperty({
    description: 'environment',
    example: APP_ENVIRONMENT.dev,
    required: true,
  })
  @IsString({ message: 'environment must be a string' })
  @IsEnum(APP_ENVIRONMENT, {
    each: true,
    message: "environment must be one of the following values: 'prod', 'dev'",
  })
  @IsOptional()
  env: APP_ENVIRONMENT;

  @ApiProperty({
    description: 'issuerDid',
    example: 'did:hid:123123123123',
    required: false,
  })
  @IsOptional()
  @IsString()
  issuerDid: string;

  @ApiProperty({
    description: 'domain',
    example: 'hypersign.id',
    required: false,
  })
  @IsOptional()
  @IsUrlEmpty()
  @IsString()
  domain: string;

  @ApiProperty({
    description: 'hasDomainVerified',
    example: 'true',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  hasDomainVerified: boolean;
}

export class DeleteAppResponse {
  @ApiProperty({
    description: 'Application id',
    example: '3420d77a5547b60fe265a463a0e5897578d3',
  })
  appId: string;
}
