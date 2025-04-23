import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, Matches } from 'class-validator';

export class CreateInviteDto {
  @ApiProperty({
    name: 'emailId',
    type: String,
  })
  @IsEmail()
  @Matches(/^.+@gmail\.com$/, {
    message: 'Email must be a valid Gmail address',
  })
  emailId: string;
}

export class InviteResponseDTO {
  @ApiProperty({
    name: 'invitor',
    type: String,
    example: '61e4196c-0ebf-4481-bbde-2f008b1b24f2',
  })
  invitor: string;
  @ApiProperty({
    name: 'invitee',
    type: String,
    example: '61e4196c-0ebf-4481-bbde-2f008b1b24f2',
  })
  invitee: string;
  @ApiProperty({
    name: 'invitationCode',
    type: String,
    example: '61e4196c-0ebf-4481-bbde-2f008b1b24f2',
  })
  invitationCode: string;

  @ApiProperty({
    name: 'accepted',
    type: Boolean,
    example: false,
  })
  accepted: string;

  @ApiProperty({
    name: 'invitationValidTill',
    type: Date,
    example: false,
  })
  invitationValidTill: string;

  @ApiProperty({
    name: 'acceptedAt',
    type: Date,
    example: false,
  })
  acceptedAt: string;
}

export class PeopleListResponseDTO {
  @ApiProperty({
    name: 'adminId',
    type: String,
    example: '61e4196c-0ebf-4481-bbde-2f008b1b24f2',
  })
  adminId: string;

  @ApiProperty({
    name: 'userId',
    type: String,
    example: '9ad664d0-9138-4df8-bbe1-95422b442fe9',
  })
  userId: string;

  @ApiProperty({
    name: 'inviteCode',
    type: String,
    example: 'f6932455-6ad1-477b-b0db-692ad52b3239',
  })
  inviteCode: string;

  @ApiProperty({
    name: 'accepted',
    type: Boolean,
    example: false,
  })
  accepted: string;
  @ApiProperty({
    name: 'invitationValidTill',
    type: Date,
    example: '2024-08-28T14:49:08.149Z',
  })
  invitationValidTill: string;
  @ApiProperty({
    name: 'acceptedAt',
    type: Date,
    example: '2024-08-28T14:49:08.149Z',
  })
  acceptedAt: string;

  @ApiProperty({
    name: 'createdAt',
    type: Date,
    example: '2024-08-28T14:49:08.149Z',
  })
  createdAt: string;

  @ApiProperty({
    name: 'updatedAt',
    type: Date,
    example: '2024-08-28T14:49:08.149Z',
  })
  updatedAt: string;

  @ApiProperty({
    name: 'userEmailId',
    type: String,
    example: 'dcat9816@gmail.com',
  })
  userEmailId: string;
  @ApiProperty({
    name: 'authenticatorEnabled',
    type: Boolean,
    example: false,
  })
  authenticators: boolean;
}

export class InviteListResponseDTO {
  @ApiProperty({
    name: 'adminId',
    type: String,
    example: '61e4196c-0ebf-4481-bbde-2f008b1b24f2',
  })
  adminId: string;

  @ApiProperty({
    name: 'userId',
    type: String,
    example: '9ad664d0-9138-4df8-bbe1-95422b442fe9',
  })
  userId: string;

  @ApiProperty({
    name: 'inviteCode',
    type: String,
    example: 'f6932455-6ad1-477b-b0db-692ad52b3239',
  })
  inviteCode: string;

  @ApiProperty({
    name: 'accepted',
    type: Boolean,
    example: false,
  })
  accepted: string;
  @ApiProperty({
    name: 'invitationValidTill',
    type: Date,
    example: '2024-08-28T14:49:08.149Z',
  })
  invitationValidTill: string;
  @ApiProperty({
    name: 'acceptedAt',
    type: Date,
    example: '2024-08-28T14:49:08.149Z',
  })
  acceptedAt: string;

  @ApiProperty({
    name: 'createdAt',
    type: Date,
    example: '2024-08-28T14:49:08.149Z',
  })
  createdAt: string;

  @ApiProperty({
    name: 'updatedAt',
    type: Date,
    example: '2024-08-28T14:49:08.149Z',
  })
  updatedAt: string;

  @ApiProperty({
    name: 'adminEmailId',
    type: String,
    example: 'dcat9816@gmail.com',
  })
  adminEmailId: string;
}

export class AttachRoleDTO {
  @ApiProperty({
    name: 'roleId',
  })
  @IsString()
  @IsNotEmpty()
  roleId: string;

  @ApiProperty({
    name: 'userId',
  })
  @IsString()
  @IsNotEmpty()
  userId: string;
}

export class AdminLoginDTO {
  @ApiProperty({
    name: 'adminId',
  })
  @IsString()
  @IsNotEmpty()
  adminId: string;
}
