import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseFilters,
  UsePipes,
  ValidationPipe,
  Req,
  Res,
} from '@nestjs/common';
import { PeopleService } from '../services/people.service';
import {
  AttachRoleDTO,
  CreateInviteDto,
  InviteListResponseDTO,
  InviteResponseDTO,
  PeopleListResponseDTO,
  TenantLoginDTO,
} from '../dto/create-person.dto';
import { DeletePersonDto } from '../dto/update-person.dto';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AllExceptionsFilter } from 'src/utils/utils';
import { ConfigService } from '@nestjs/config';
@UseFilters(AllExceptionsFilter)
@ApiTags('People')
@ApiBearerAuth('Authorization')
@Controller('/api/v1/tenants')
export class PeopleController {
  constructor(
    private readonly peopleService: PeopleService,
    private readonly config: ConfigService,
  ) {}

  @ApiResponse({
    status: 200,
    description: 'Invite a user to your account',
    type: InviteResponseDTO,
  })
  @Post('/invitations')
  @UsePipes(ValidationPipe)
  createInvite(@Body() createInviteDto: CreateInviteDto, @Req() req) {
    const { user } = req;
    return this.peopleService.createInvitation(createInviteDto, user);
  }

  @ApiResponse({
    status: 200,
    description: 'Accept invite',
    type: InviteResponseDTO,
  })
  @Post('/invitations/:inviteCode/accept')
  @UsePipes(ValidationPipe)
  acceptInvite(@Param('inviteCode') inviteCode: string, @Req() req) {
    const { user } = req;
    return this.peopleService.acceptInvite(inviteCode, user);
  }

  @Patch('invitations/:inviteCode')
  @UsePipes(ValidationPipe)
  update(@Param('inviteCode') inviteCode: string, @Req() req) {
    const { user } = req;
    return this.peopleService.update(inviteCode, user);
  }

  @ApiResponse({
    status: 200,
    type: PeopleListResponseDTO,
    isArray: true,
  })
  @Get('/')
  @UsePipes(ValidationPipe)
  async getAllPeople(@Req() req) {
    const { user } = req;
    return this.peopleService.getAllPeople(user);
  }

  @ApiResponse({
    status: 200,
    type: InviteListResponseDTO,
    isArray: true,
  })
  @Get('/invitations')
  @UsePipes(ValidationPipe)
  async getAllInvites(@Req() req) {
    const { user } = req;
    return this.peopleService.getAllInvites(user);
  }

  @Delete('/')
  @UsePipes(ValidationPipe)
  async deletePeople(@Req() req, @Body() body: DeletePersonDto) {
    const { user } = req;
    return this.peopleService.deletePerson(user, body);
  }

  @Post('/roles/attach')
  @UsePipes(ValidationPipe)
  async attachRoles(@Body() body: AttachRoleDTO, @Req() req) {
    const { user } = req;
    return this.peopleService.attachRole(body, user);
  }
  @Post('/access')
  @UsePipes(ValidationPipe)
  async switchTenantAccount(@Body() tenantDto: TenantLoginDTO, @Req() req) {
    const { user, session } = req;
    return await this.peopleService.switchTenantAccount(
      user,
      session,
      tenantDto,
    );
  }
}
