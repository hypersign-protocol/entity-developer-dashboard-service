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
} from '@nestjs/common';
import { PeopleService } from '../services/people.service';
import {
  AdminLoginDTO,
  AttachRoleDTO,
  CreateInviteDto,
  InviteListResponseDTO,
  InviteResponseDTO,
  PeopleListResponseDTO,
} from '../dto/create-person.dto';
import { DeletePersonDto } from '../dto/update-person.dto';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AllExceptionsFilter } from 'src/utils/utils';
@UseFilters(AllExceptionsFilter)
@ApiTags('People')
@ApiBearerAuth('Authorization')
@Controller('/api/v1/people')
export class PeopleController {
  constructor(private readonly peopleService: PeopleService) {}

  @ApiResponse({
    status: 200,
    description: 'Invite a user to your account',
    type: InviteResponseDTO,
  })
  @Post('/invite')
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
  @Post('/invite/accept/:inviteCode')
  @UsePipes(ValidationPipe)
  acceptInvite(@Param('inviteCode') inviteCode: string, @Req() req) {
    const { user } = req;
    return this.peopleService.acceptInvite(inviteCode, user);
  }

  @Patch('invite/:inviteCode')
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
  @Get('/invites')
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

  @Post('/admin/login')
  @UsePipes(ValidationPipe)
  async adminLogin(@Body() body: AdminLoginDTO, @Req() req) {
    const { user } = req;
    return this.peopleService.adminLogin(body, user);
  }
}
