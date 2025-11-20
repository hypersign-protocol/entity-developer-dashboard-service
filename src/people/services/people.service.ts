import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';

import {
  AdminLoginDTO,
  AttachRoleDTO,
  CreateInviteDto,
} from '../dto/create-person.dto';
import { DeletePersonDto } from '../dto/update-person.dto';
import { UserRepository } from 'src/user/repository/user.repository';
import { AdminPeopleRepository } from '../repository/people.repository';
import { RoleRepository } from 'src/roles/repository/role.repository';
import { SocialLoginService } from 'src/social-login/services/social-login.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { MailNotificationService } from 'src/mail-notification/services/mail-notification.service';
import { UserRole } from 'src/user/schema/user.schema';
import { JobNames } from 'src/utils/time-constant';

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
      throw new BadRequestException(['Self invitation is not available']);
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
      throw new ConflictException([
        'User already exists to your account',
        'Already Invited',
      ]);
    }

    // const isInvitedAlready = await this.inviteRepository.findOne({
    //   invitor: adminUserData.userId,
    //   invitee: userDetails.userId,
    // });

    // if (isInvitedAlready !== null) {
    //   return isInvitedAlready;
    // }

    const invite = await this.adminPeopleService.create({
      adminId: adminUserData.userId,
      userId: userDetails?.userId || emailId,
      inviteCode: `${Date.now()}-${uuidv4()}`,
      accepted: false,
      invitationValidTill: new Date(
        Date.now() + 2 * 24 * 60 * 60 * 1000,
      ).toISOString(),
    });
    this.mailNotificationService.addJobToMailQueue({
      mailName: JobNames.SEND_TEAM_MATE_INVITATION_MAIL,
      teamMateMailId: emailId,
      adminEmailId: adminUserData.email,
      mailSubject: " You're invited to join Hypersign Dashboard",
      inviteLink: `${this.configService.get('INVITATIONURL')}`,
    });
    return invite;
  }

  async acceptInvite(inviteCode: string, userDetails) {
    const adminPeople = await this.adminPeopleService.findOne({
      // userId: userDetails?.userId,
      inviteCode,
    });
    if (adminPeople == null) {
      throw new BadRequestException(['Wrong invitation code']);
    }
    const expiry = new Date(adminPeople.invitationValidTill);
    const now = new Date();

    if (expiry < now) {
      throw new BadRequestException(['Invite code expired']);
    }
    if (adminPeople == null) {
      throw new BadRequestException([
        `Wrong invite code ${inviteCode}`,
        `Invitation doesnot exists`,
      ]);
    }

    if (adminPeople?.accepted) {
      throw new BadRequestException(['Invite has been accepted already']);
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
      throw new NotFoundException(['Invite not found']);
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
      throw new ConflictException(['User doesnot exists', 'Already Deleted']);
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
      throw new NotFoundException(['Member not found']);
    }
    if (adminPeople.accepted == false) {
      throw new BadRequestException(['Invitation is pending']);
    }

    const role = await this.roleRepository.findOne({
      _id: roleId,
      userId: adminId,
    });

    if (role == null) {
      throw new NotFoundException(['Role not found']);
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
  async adminLogin(body: AdminLoginDTO, user: any) {
    const rawUrl = this.configService.get('INVITATIONURL');
    const url = new URL(rawUrl);
    const domain = url.origin;
    const { adminId } = body;
    const adminData = await this.userService.findOne({
      userId: adminId,
    });
    if (adminData == null) {
      throw new BadRequestException(['Admin user not found']);
    }
    const userId = user.userId;
    let adminPeople = user;
    let role;
    if (userId !== adminId) {
      adminPeople = await this.adminPeopleService.findOne({
        adminId,
        userId,
      });

      if (adminPeople == null) {
        throw new NotFoundException([
          'You are not the member of ' + adminData.email,
        ]);
      }

      if (adminPeople.roleId == null) {
        throw new BadRequestException([
          'You do not have any role to access admin account',
        ]);
      }

      role = await this.roleRepository.findOne({
        _id: adminPeople.roleId,
      });
    }
    // const jwt = await this.socialLoginService.socialLogin({
    //   user: {
    //     email: adminData.email,
    //   },
    // });

    delete adminData.accessList;
    delete adminData['_id'];
    delete adminData.authenticators;

    const accessAccount = {
      ...adminData,
      accessList: role?.permissions || adminPeople.accessList,
    };
    const payload = {
      appUserID: user.userId,
      ...user,
      aud: domain,
    };
    delete payload._id;

    delete payload.userId;

    payload.accessAccount = accessAccount;
    payload.role = adminData?.role || UserRole.ADMIN;
    const token = await this.socialLoginService.generateAuthToken(payload);
    const refreshToken = await this.socialLoginService.generateRefreshToken(
      payload,
    );
    return {
      authToken: token,
      refreshToken,
      adminEmail: adminData.email,
    };
  }
}
