/* eslint-disable @typescript-eslint/ban-ts-comment */
import {
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
      if (!session) {
        throw new Error(AUTH_ERRORS.SESSION_EXPIRED);
      }
      if (!session.tenantId) {
        return next();
      }
      const tenantId = req['session'].tenantId;

      if (tenantId !== undefined) {
        // @ts-ignore

        const userId = user.userId;
        // @ts-ignore
        const member = await this.adminPeople.findOne({
          adminId: tenantId,
          userId,
        });
        if (member == null) {
          throw new Error(AUTH_ERRORS.ACCESS_REVOKED);
        }
        // @ts-ignore

        user.userId = tenantId;
        if (
          !session?.tenantUserPermissions ||
          session.tenantUserPermissions.length === 0
        ) {
          throw new Error(AUTH_ERRORS.TENANT_PERMISSION_ISSUE);
        }
        // @ts-ignore
        user.accessList = session?.tenantUserPermissions;
        // @ts-ignore
      }

      Logger.debug(
        'Access account context updated',
        'JWTAccessAccountMiddleware',
      );
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      Logger.error(error.message, error.stack, 'JWTAccessAccountMiddleware');
      throw new UnauthorizedException([error.message]);
    }
    next();
  }
}
