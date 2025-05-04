import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsString } from 'class-validator';

export class UnauthorizedError {
  @ApiProperty({
    description: 'statusCode',
    example: 401,
  })
  @IsNumber()
  statusCode: number;

  @ApiProperty({
    description: 'message',
    example: ['error message 1'],
  })
  @IsString()
  message: Array<string>;

  @ApiProperty({
    description: 'error',
    example: 'Unauthorized Request',
  })
  @IsString()
  error: string;
}

export class LoginResponse {
  @ApiProperty({
    description: 'authUrl',
    example: 'https://accounts.google.com/.........',
  })
  authUrl: string;
}

export class Message {
  @ApiProperty({
    description: 'userId',
    example: 'ccc234_hrk959y_uwo',
  })
  userId: string;
  @ApiProperty({
    description: 'email',
    example: 'xyz@gmail.com',
  })
  email: string;
  @ApiProperty({
    description: 'name',
    example: 'varsha',
  })
  name: string;
}
export class AuthResponse {
  @ApiProperty({
    description: 'status',
    example: '200',
  })
  status: number;
  @ApiProperty({
    description: 'message',
    type: Message,
  })
  message: Message;
  @ApiProperty({
    description: 'error',
    example: null,
  })
  error: string;
}
export class Generate2FARespDto {
  @ApiProperty({
    name: 'twoFADataUrl',
    description: 'QR Data',
    example: 'data:image/png;base64,iV......',
  })
  @IsString()
  twoFADataUrl: string;
}
export class Verify2FARespDto {
  @ApiProperty({
    name: 'isVerified',
    description: 'COde verification result',
    example: true,
  })
  @IsBoolean()
  isVerified: boolean;
  @ApiProperty({
    name: 'accessToken',
    description: '2FA based accessToken',
    example: 'eyJh.....',
  })
  @IsString()
  accessToken: string;
}
export class DeleteMFARespDto {
  @ApiProperty({
    name: 'message',
    description: 'A success message',
    example: 'Removed authenticator successfully',
  })
  @IsString()
  message: string;
}
export enum AuthneticatorType {
  google = 'google',
  okta = 'okta',
}

export class LogoutRespDto {
  @ApiProperty({
    example: 'Logged out successfully',
  })
  message: string;
}
