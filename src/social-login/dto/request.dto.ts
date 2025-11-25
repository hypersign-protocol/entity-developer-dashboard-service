import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { AuthneticatorType } from './response.dto';
import { ApiProperty } from '@nestjs/swagger';

export class MFACodeVerificationDto {
  @ApiProperty({
    name: 'authenticatorType',
    description: 'Type of authenticator used for 2FA',
    example: AuthneticatorType.google,
    enum: AuthneticatorType,
  })
  @IsEnum(AuthneticatorType)
  authenticatorType: string;
  @ApiProperty({
    name: 'twoFactorAuthenticationCode',
    description: 'Code generated in authenticator app',
    example: '678324',
  })
  @IsString()
  @IsNotEmpty()
  twoFactorAuthenticationCode: string;
}
export class LoginMFACodeVerificationDto extends MFACodeVerificationDto {
  @ApiProperty({
    name: 'sessionId',
    description: 'Id of the session',
    example: '1764056485204-0644acbc-bbc9-4b07-a613-811d2ad1ad4a',
  })
  @IsNotEmpty()
  @IsString()
  sessionId: string;
}

export class Generate2FA {
  @ApiProperty({
    name: 'authenticatorType',
    description: 'Type of authenticator used for 2FA',
    example: AuthneticatorType.google,
    enum: AuthneticatorType,
  })
  @IsEnum(AuthneticatorType)
  authenticatorType: string;
}

export class DeleteMFADto {
  @ApiProperty({
    name: 'authenticatorType',
    description: 'Type of authenticator used for 2FA',
    example: AuthneticatorType.google,
    enum: AuthneticatorType,
  })
  @IsEnum(AuthneticatorType)
  authenticatorType: string;
  @ApiProperty({
    name: 'twoFactorAuthenticationCode',
    description:
      'Code generated in authenticator app of selected authenticatorType',
    example: '678324',
  })
  @IsString()
  @IsNotEmpty()
  twoFactorAuthenticationCode: string;
  @ApiProperty({
    name: 'authenticatorToDelete',
    description: 'Type of authenticator that user want to remove',
    example: AuthneticatorType.okta,
    enum: AuthneticatorType,
  })
  @IsEnum(AuthneticatorType)
  authenticatorToDelete: string;
}
