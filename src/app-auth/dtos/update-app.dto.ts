import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
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
import { APP_ENVIRONMENT } from 'src/supported-service/services/iServiceList';

export class UpdateAppDto {
  @ApiProperty({
    description: 'Application Name',
    example: 'demo app',
  })
  @Transform(({ value }) => validator.trim(value))
  @IsString()
  @IsNotEmpty()
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
  @MaxLength(200)
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
    description: 'issuerVerificationMethodId',
    example: 'did:hid:123123123123#key-x',
    required: false,
  })
  @IsOptional()
  @IsString()
  issuerVerificationMethodId?: string;

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
