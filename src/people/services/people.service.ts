import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';

import {
  AttachRoleDTO,
  CreateInviteDto,
  TenantLoginDTO,
} from '../dto/create-person.dto';
import { DeletePersonDto } from '../dto/update-person.dto';
import { UserRepository } from 'src/user/repository/user.repository';
import { AdminPeopleRepository } from '../repository/people.repository';
import { RoleRepository } from 'src/roles/repository/role.repository';
import { SocialLoginService } from 'src/social-login/services/social-login.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { MailNotificationService } from 'src/mail-notification/services/mail-notification.service';
import { JobNames } from 'src/utils/time-constant';
import { redisClient } from 'src/utils/redis.provider';
import {
  TENANT_ERRORS,
  TENANT_INVITE_ERRORS,
  TENANT_MESSAGES,
} from '../constant/en';

@Injectable()
export class PeopleService {
  constructor(
    private readonly userService: UserRepository,
    private readonly adminPeopleService: AdminPeopleRepository,
    private readonly roleRepository: RoleRepository,
    private readonly socialLoginService: SocialLoginService,
    private readonly jwt: JwtService,
    private readonly configService: ConfigService,
    private readonly mailNotificationService: MailNotificationService,
  ) {}
  async createInvitation(createPersonDto: CreateInviteDto, adminUserData) {
    const { emailId } = createPersonDto;
    if (emailId === adminUserData?.email) {
      throw new BadRequestException([
        TENANT_INVITE_ERRORS.SELF_INVITATION_NOT_ALLOWED,
      ]);
    }
    const userDetails = await this.userService.findOne({
      email: emailId,
    });

    // if (userDetails == null) {
    //   throw new NotFoundException(
    //     `Cannot invite an non existing user with email: ${emailId}`,
    //     `User not found`,
    //   );
    // }

    const adminPeople = await this.adminPeopleService.findOne({
      userId: userDetails?.userId || emailId,
      adminId: adminUserData.userId,
    });
    if (adminPeople != null) {
      throw new ConflictException([TENANT_INVITE_ERRORS.ALREADY_INVITED]);
    }
    const invitecode = `${Date.now()}-${uuidv4()}`;
    const { roleId } = createPersonDto;
    let roleDetail;
    if (roleId) {
      roleDetail = await this.roleRepository.findOne({ _id: roleId });
      if (!roleDetail) {
        throw new BadRequestException([
          TENANT_INVITE_ERRORS.ROLE_NOT_FOUND(roleId),
        ]);
      }
    } else {
      const roles = await this.roleRepository.findUsingAggregation([
        { $match: { userId: adminUserData.userId } },
        {
          $addFields: {
            permissionsCount: { $size: '$permissions' },
          },
        },
        { $sort: { permissionsCount: 1 } },
        { $limit: 1 },
      ]);
      roleDetail = roles?.[0];
    }
    if (!roleDetail)
      throw new BadRequestException([TENANT_INVITE_ERRORS.NO_ROLE_ASSIGNED]);
    const invite = await this.adminPeopleService.create({
      adminId: adminUserData.userId,
      userId: userDetails?.userId || emailId,
      inviteCode: invitecode,
      accepted: false,
      invitationValidTill: new Date(
        Date.now() + 2 * 24 * 60 * 60 * 1000,
      ).toISOString(),
      roleId: roleDetail._id.toString(),
      roleName: roleDetail.roleName,
      inviteeEmail: emailId,
    });
    this.mailNotificationService.addJobToMailQueue({
      mailName: JobNames.SEND_TEAM_MATE_INVITATION_MAIL,
      teamMateMailId: emailId,
      adminEmailId: adminUserData.email,
      mailSubject: " You're invited to join the Hypersign Dashboard",
      inviteLink: `${this.configService.get(
        'INVITATIONURL',
      )}&code=${invitecode}`,
    });
    return invite;
  }

  async acceptInvite(inviteCode: string, userDetails) {
    const adminPeople = await this.adminPeopleService.findOne({
      // userId: userDetails?.userId,
      inviteCode,
    });
    if (adminPeople == null) {
      throw new BadRequestException(['The invitation code is invalid.']);
    }
    const expiry = new Date(adminPeople.invitationValidTill);
    const now = new Date();

    if (expiry < now) {
      throw new BadRequestException(['The invitation code has expired.']);
    }
    if (adminPeople == null) {
      throw new BadRequestException(['The invitation code is invalid.']);
    }

    if (adminPeople?.accepted) {
      throw new BadRequestException([
        'This invitation has already been accepted.',
      ]);
    }
    const acceptedInvite = await this.adminPeopleService.findOneAndUpdate(
      {
        // userId: userDetails?.userId,
        inviteCode,
      },
      {
        userId: userDetails?.userId,
        accepted: true,
        acceptedAt: new Date().toISOString(),
      },
    );

    return acceptedInvite;
  }

  async update(inviteCode: string, adminUserDetails) {
    const adminId = adminUserDetails?.userId;

    const findInvite = await this.adminPeopleService.findOne({
      adminId: adminId,
      inviteCode,
    });
    if (findInvite == null) {
      throw new NotFoundException(['Invitation not found.']);
    }

    const updateInvite = await this.adminPeopleService.findOneAndUpdate(
      {
        adminId: adminId,
        inviteCode,
      },
      {
        invitationValidTill: new Date(
          Date.now() + 10 * 60 * 1000,
        ).toISOString(),
      },
    );

    return updateInvite;
  }

  async getAllPeople(user) {
    return await this.adminPeopleService.findAllPeopleByAdmin(user.userId);
  }

  async getAllInvites(user) {
    return await this.adminPeopleService.findAllAdminByUser(
      user.userId,
      user.email,
    );
  }
  async deletePerson(adminUserData, body: DeletePersonDto) {
    const { emailId } = body;
    const userDetails = await this.userService.findOne({
      email: emailId,
    });
    const adminPeople = await this.adminPeopleService.findOne({
      userId: userDetails?.userId || emailId,
      adminId: adminUserData.userId,
    });
    if (adminPeople == null) {
      throw new ConflictException(['This teammate has already been deleted.']);
    }
    return this.adminPeopleService.findOneAndDelete({
      userId: userDetails?.userId || emailId,
      adminId: adminUserData.userId,
    });
  }

  async attachRole(body: AttachRoleDTO, user) {
    const { userId: adminId } = user;
    const { userId, roleId } = body;
    const adminPeople = await this.adminPeopleService.findOne({
      adminId,
      userId,
    });

    if (adminPeople == null) {
      throw new NotFoundException(['Member not found.']);
    }
    if (adminPeople.accepted == false) {
      throw new BadRequestException(['The invitation is still pending.']);
    }

    const role = await this.roleRepository.findOne({
      _id: roleId,
      userId: adminId,
    });

    if (role == null) {
      throw new NotFoundException(['Role not found.']);
    }

    return await this.adminPeopleService.findOneAndUpdate(
      {
        adminId,
        userId,
      },
      {
        roleId: role._id.toString(),
        roleName: role.roleName,
      },
    );
  }
  async switchTenantAccount(
    userDetail,
    sessionDetail,
    tenantDto: TenantLoginDTO,
  ) {
    const { adminId } = tenantDto;
    // switch back to own account
    if (userDetail.userId === adminId) {
      if (!sessionDetail?.tenantId) {
        throw new BadRequestException([TENANT_ERRORS.ALREADY_IN_TENANT]);
      }
      return this.updateSession({
        sessionDetail,
        message: TENANT_MESSAGES.SWITCH_BACK_SUCCESS,
      });
    }
    // switching to tenant account
    if (adminId === sessionDetail?.tenantId) {
      throw new BadRequestException([TENANT_ERRORS.ALREADY_IN_TENANT]);
    }
    const adminData = await this.userService.findOne({
      userId: adminId,
    });
    if (adminData == null) {
      throw new BadRequestException([TENANT_ERRORS.ADMIN_NOT_FOUND]);
    }
    const tenantDetail = await this.adminPeopleService.findOne({
      adminId,
      userId: userDetail.userId,
    });
    if (!tenantDetail) {
      throw new UnauthorizedException([
        TENANT_ERRORS.NOT_A_MEMBER(adminData.email),
      ]);
    }
    if (!tenantDetail.accepted) {
      throw new BadRequestException([TENANT_ERRORS.INVITATION_NOT_ACCEPTED]);
    }
    const roleDetail = await this.roleRepository.findOne({
      _id: tenantDetail.roleId,
    });
    if (!roleDetail) {
      throw new BadRequestException([TENANT_ERRORS.ROLE_NOT_FOUND]);
    }
    if (!roleDetail.permissions?.length) {
      throw new BadRequestException([TENANT_ERRORS.NO_PERMISSION]);
    }

    return this.updateSession({
      sessionDetail,
      message: TENANT_MESSAGES.SWITCH_SUCCESS,
      tenantId: adminId, // tenantId
      permissions: roleDetail.permissions, // permissions
    });
  }

  private async updateSession({
    sessionDetail,
    message,
    tenantId = null,
    permissions = null,
  }: {
    sessionDetail: any;
    tenantId?: string | null;
    permissions?: any[] | null;
    message: string;
  }) {
    sessionDetail.tenantId = tenantId;
    sessionDetail.tenantUserPermissions = permissions;
    sessionDetail.createdAt = new Date().toISOString();
    const ttl = await redisClient.ttl(`session:${sessionDetail.sessionId}`);
    await redisClient.set(
      `session:${sessionDetail.sessionId}`,
      JSON.stringify(sessionDetail),
      'EX',
      ttl,
    );

    return { message };
  }
}
