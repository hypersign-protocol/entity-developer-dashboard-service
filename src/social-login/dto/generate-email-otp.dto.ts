import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

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
