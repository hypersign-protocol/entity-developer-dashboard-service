/* eslint-disable @typescript-eslint/ban-ts-comment */
import {
  BadRequestException,
  Injectable,
  Logger,
  NestMiddleware,
  UnauthorizedException,
} from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { AdminPeopleRepository } from 'src/people/repository/people.repository';
import { AUTH_ERRORS } from 'src/social-login/constants/en';
@Injectable()
export class JWTAccessAccountMiddleware implements NestMiddleware {
  constructor(private readonly adminPeople: AdminPeopleRepository) {}
  async use(req: Request, res: Response, next: NextFunction) {
    try {
      // @ts-ignore
      const user = req.user;
      const session = req['session'];
      if (!session.tenantId) {
        return next();
      }
      const tenantId = req['session'].tenantId;

      if (tenantId !== undefined) {
        // @ts-ignore

        const userId = user.userId;
        const tenantId = req['session'].tenantId;
        // @ts-ignore
        const member = await this.adminPeople.findOne({
          adminId: tenantId,
          userId,
        });
        if (member == null) {
          throw new Error('Your access has been revoked');
        }
        // @ts-ignore

        user.userId = tenantId;
        if (
          !session?.tenantUserPermissions ||
          session.tenantUserPermissions.length === 0
        ) {
          throw new BadRequestException([AUTH_ERRORS.TENANT_PERMISSION_ISSUE]);
        }
        // @ts-ignore
        user.accessList = session?.tenantUserPermissions;
        // @ts-ignore
      }

      Logger.log(JSON.stringify(req.user), 'JWTAccessAccountMiddleware');
    } catch (e) {
      Logger.error(
        `JWTAccessAccountMiddleware: Error ${e}`,
        'JWTAccessAccountMiddleware',
      );
      throw new UnauthorizedException([e]);
    }
    next();
  }
}
