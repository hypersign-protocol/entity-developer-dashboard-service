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
