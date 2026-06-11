import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
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
    Logger.log(
      'Inside createInvitation() to create new invitation',
      'PeopleService',
    );
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
    Logger.log(
      'Inside acceptInvite() to accept new invitation',
      'PeopleService',
    );
    const inviteeIdentifiers = [userDetails?.userId, userDetails?.email].filter(
      Boolean,
    );
    const inviteFilter = {
      inviteCode,
      $or: [
        { userId: { $in: inviteeIdentifiers } },
        { inviteeEmail: userDetails?.email },
      ],
    };
    const adminPeople = await this.adminPeopleService.findOne(inviteFilter);
    if (adminPeople == null) {
      throw new BadRequestException([
        TENANT_INVITE_ERRORS.INVALID_OR_UNAUTHORIZED_INVITE,
      ]);
    }
    const expiry = new Date(adminPeople.invitationValidTill);
    const now = new Date();

    if (expiry < now) {
      throw new BadRequestException(['The invitation code has expired.']);
    }

    if (adminPeople?.accepted) {
      throw new BadRequestException([
        'This invitation has already been accepted.',
      ]);
    }
    const acceptedInvite = await this.adminPeopleService.findOneAndUpdate(
      inviteFilter,
      {
        userId: userDetails?.userId,
        accepted: true,
        acceptedAt: new Date().toISOString(),
      },
    );

    return acceptedInvite;
  }

  async update(inviteCode: string, adminUserDetails) {
    Logger.log('Inside update() to update invitation detail', 'PeopleService');

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
    Logger.log(
      'Inside getAllPeople() to fetch list of teammate',
      'PeopleService',
    );
    return await this.adminPeopleService.findAllPeopleByAdmin(user.userId);
  }

  async getAllInvites(user) {
    Logger.log(
      'Inside getAllInvites() to fetch invited people',
      'PeopleService',
    );

    return await this.adminPeopleService.findAllAdminByUser(
      user.userId,
      user.email,
    );
  }
  async deletePerson(adminUserData, body: DeletePersonDto) {
    Logger.log(
      'Inside deletePerson() to delete specific people',
      'PeopleService',
    );

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
    Logger.log('Inside attachRole()', 'PeopleService');
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

  async getUsersAccessingAccount(userDetail, sessionDetail) {
    Logger.log(
      `getUsersAccessingAccount() method: starts for userId=${userDetail.userId}`,
      PeopleService.name,
    );
    const tenantId = sessionDetail?.tenantId || userDetail.userId;
    Logger.debug(
      `getUsersAccessingAccount() method: resolving users for tenantId=${tenantId}`,
      PeopleService.name,
    );
    const matchingSessions = await this.findTenantSessions(tenantId);
    const userIds = [
      ...new Set(matchingSessions.map((session) => session.userId)),
    ];
    Logger.debug(
      `getUsersAccessingAccount() method: found ${matchingSessions.length} active session(s) and ${userIds.length} unique user(s) for tenantId=${tenantId}`,
      PeopleService.name,
    );
    const users = userIds.length
      ? await this.userService.find({ userId: { $in: userIds } })
      : [];
    const usersById = new Map(users.map((user) => [user.userId, user]));

    const accessingUsers = matchingSessions
      .map((session) => {
        const user = usersById.get(session.userId);
        return {
          userId: session.userId,
          email: user?.email,
          name: user?.name,
          role: session.role,
          accessActiveSince: session.createdAt,
        };
      })
      .sort((first, second) => {
        const firstCreatedAt = first.accessActiveSince
          ? new Date(first.accessActiveSince).getTime()
          : 0;
        const secondCreatedAt = second.accessActiveSince
          ? new Date(second.accessActiveSince).getTime()
          : 0;
        return secondCreatedAt - firstCreatedAt;
      });

    Logger.log(
      `getUsersAccessingAccount() method: ends with ${accessingUsers.length} user(s) for tenantId=${tenantId}`,
      PeopleService.name,
    );

    return accessingUsers;
  }

  async switchTenantAccount(
    userDetail,
    sessionDetail,
    tenantDto: TenantLoginDTO,
  ) {
    Logger.log(
      'Inside switchTenantAccount() to switch to admin account',
      'PeopleService',
    );
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
    const previousTenantId = sessionDetail.tenantId;
    sessionDetail.tenantId = tenantId;
    sessionDetail.tenantUserPermissions = permissions;
    sessionDetail.createdAt = new Date().toISOString();
    const ttl = await redisClient.ttl(`session:${sessionDetail.sessionId}`);
    const sessionKey = `session:${sessionDetail.sessionId}`;
    if (ttl > 0) {
      await redisClient.set(
        sessionKey,
        JSON.stringify(sessionDetail),
        'EX',
        ttl,
      );
    } else {
      await redisClient.set(sessionKey, JSON.stringify(sessionDetail));
    }
    if (previousTenantId && previousTenantId !== tenantId) {
      await redisClient.srem(
        this.getTenantSessionsKey(previousTenantId),
        sessionDetail.sessionId,
      );
    }

    if (tenantId) {
      const tenantSessionsKey = this.getTenantSessionsKey(tenantId);
      await redisClient.sadd(tenantSessionsKey, sessionDetail.sessionId);
      if (ttl > 0) {
        await redisClient.expire(tenantSessionsKey, ttl);
      }
    }

    return { message };
  }

  private async findTenantSessions(tenantId: string) {
    Logger.log(
      `findTenantSessions() method: starts for tenantId=${tenantId}`,
      PeopleService.name,
    );
    const indexedSessions = await this.findTenantSessionsFromIndex(tenantId);
    const tenantSessionsBackfilledKey =
      this.getTenantSessionsBackfilledKey(tenantId);
    const isBackfilled = await redisClient.exists(tenantSessionsBackfilledKey);
    if (isBackfilled) {
      Logger.debug(
        `findTenantSessions() method: using indexed sessions for tenantId=${tenantId}, count=${indexedSessions.length}`,
        PeopleService.name,
      );
      return indexedSessions;
    }

    Logger.debug(
      `findTenantSessions() method: index not backfilled for tenantId=${tenantId}, scanning session keys`,
      PeopleService.name,
    );
    const tenantSessionsKey = this.getTenantSessionsKey(tenantId);
    const matchingSessions = [];
    const indexedSessionIds = [];
    let cursor = '0';
    let scannedKeysCount = 0;

    do {
      const [nextCursor, keys] = await redisClient.scan(
        cursor,
        'MATCH',
        'session:*',
        'COUNT',
        100,
      );
      cursor = nextCursor;
      scannedKeysCount += keys.length;

      if (!keys.length) {
        continue;
      }

      const sessionValues = await redisClient.mget(keys);
      sessionValues.forEach((sessionValue) => {
        if (!sessionValue) {
          return;
        }

        try {
          const session = JSON.parse(sessionValue);
          if (session?.tenantId === tenantId) {
            matchingSessions.push(session);
            indexedSessionIds.push(session.sessionId);
          }
        } catch (error) {
          Logger.warn(
            `Skipping invalid session value while scanning tenant sessions: ${error.message}`,
            PeopleService.name,
          );
        }
      });
    } while (cursor !== '0');

    if (indexedSessionIds.length) {
      await redisClient.sadd(tenantSessionsKey, ...indexedSessionIds);
      Logger.debug(
        `findTenantSessions() method: backfilled ${indexedSessionIds.length} session id(s) for tenantId=${tenantId}`,
        PeopleService.name,
      );
    }
    await redisClient.set(tenantSessionsBackfilledKey, 'true');

    const sessions = [...indexedSessions, ...matchingSessions].filter(
      (session, index, sessions) =>
        sessions.findIndex(
          (currentSession) => currentSession.sessionId === session.sessionId,
        ) === index,
    );

    Logger.log(
      `findTenantSessions() method: ends for tenantId=${tenantId}, scannedKeys=${scannedKeysCount}, matchedSessions=${sessions.length}`,
      PeopleService.name,
    );

    return sessions;
  }

  private async findTenantSessionsFromIndex(tenantId: string) {
    const tenantSessionsKey = this.getTenantSessionsKey(tenantId);
    const sessionIds = await redisClient.smembers(tenantSessionsKey);
    if (!sessionIds.length) {
      Logger.debug(
        `findTenantSessionsFromIndex() method: no indexed sessions found for tenantId=${tenantId}`,
        PeopleService.name,
      );
      return [];
    }

    Logger.debug(
      `findTenantSessionsFromIndex() method: found ${sessionIds.length} indexed session id(s) for tenantId=${tenantId}`,
      PeopleService.name,
    );
    const sessionKeys = sessionIds.map((sessionId) => `session:${sessionId}`);
    const sessionValues = await redisClient.mget(sessionKeys);
    const matchingSessions = [];
    const staleSessionIds = [];

    sessionValues.forEach((sessionValue, index) => {
      if (!sessionValue) {
        staleSessionIds.push(sessionIds[index]);
        return;
      }

      try {
        const session = JSON.parse(sessionValue);
        if (session?.tenantId === tenantId) {
          matchingSessions.push(session);
        } else {
          staleSessionIds.push(sessionIds[index]);
        }
      } catch (error) {
        staleSessionIds.push(sessionIds[index]);
        Logger.warn(
          `Skipping invalid indexed session value: ${error.message}`,
          PeopleService.name,
        );
      }
    });

    if (staleSessionIds.length) {
      await redisClient.srem(tenantSessionsKey, ...staleSessionIds);
      Logger.debug(
        `findTenantSessionsFromIndex() method: removed ${staleSessionIds.length} stale indexed session id(s) for tenantId=${tenantId}`,
        PeopleService.name,
      );
    }

    Logger.debug(
      `findTenantSessionsFromIndex() method: returning ${matchingSessions.length} indexed session(s) for tenantId=${tenantId}`,
      PeopleService.name,
    );

    return matchingSessions;
  }

  private getTenantSessionsKey(tenantId: string) {
    return `tenant_sessions:${tenantId}`;
  }

  private getTenantSessionsBackfilledKey(tenantId: string) {
    return `tenant_sessions_backfilled:${tenantId}`;
  }
}
