import { IsEmail, IsString } from 'class-validator';

export class CreateMailNotificationDto {
  mailName: string;
  @IsEmail()
  teamMateMailId: string;
  @IsEmail()
  adminEmailId: string;
  @IsString()
  mailSubject: string;
  @IsString()
  inviteLink: string;
}
