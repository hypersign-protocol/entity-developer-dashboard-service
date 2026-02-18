import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class GenerateEmailOtpDto {
  @ApiProperty({
    name: 'email',
    description: 'emailId',
    example: 'xyz@gmail.com',
  })
  @IsEmail()
  @IsNotEmpty()
  @IsString()
  email: string;
}
export class VerifyEmailOtpDto {
  @ApiProperty({
    name: 'email',
    description: 'emailId',
    example: 'xyz@gmail.com',
  })
  @IsEmail()
  @IsNotEmpty()
  @IsString()
  email: string;
  @ApiProperty({
    name: 'otp',
    description: 'otp sent to email',
    example: 'A2CDE3',
  })
  @IsNotEmpty()
  @IsString()
  otp: string;
}

export class GenerateEmailOtpResponse {
  @ApiProperty({
    description: 'message',
    example: 'Otp sent successfully',
  })
  message: string;
}

export class VerifyEmailOtpResponse {
  @ApiProperty({
    description: 'message',
    example: 'Otp verified successfully',
  })
  message: string;
  @ApiProperty({
    description: 'token',
    example: 'eydrdd...',
  })
  token: string;
}

export class VerifyEmailOtpResponseDto {
  @ApiProperty({
    description: 'Indicates whether the email OTP was successfully verified.',
    example: true,
  })
  @IsBoolean()
  verified: boolean;

  @ApiProperty({
    description:
      'Specifies whether multi-factor authentication (MFA) is required to complete the login process.',
    example: false,
  })
  @IsBoolean()
  isMfaRequired: boolean;

  @ApiProperty({
    description:
      'List of available MFA authenticators required to complete authentication. Returned only when isMfaRequired is true.',
    example: ['OKTA'],
    required: false,
    type: [String],
  })
  @IsOptional()
  @IsArray()
  authenticators?: string[];

  @ApiProperty({
    description:
      'Unique session identifier used to complete MFA verification. Returned only when isMfaRequired is true.',
    example: '2d3d4b05d44ddaf477e25ec697a9468028f8c3221fa16cbd3a1ecda168dd2ec2',
    required: false,
  })
  @IsOptional()
  @IsString()
  sessionId?: string;
}
