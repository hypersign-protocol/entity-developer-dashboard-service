/* eslint-disable @typescript-eslint/ban-ts-comment */
import {
  Injectable,
  Logger,
  NestMiddleware,
  UnauthorizedException,
} from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { AdminPeopleRepository } from 'src/people/repository/people.repository';
@Injectable()
export class JWTAccessAccountMiddleware implements NestMiddleware {
  constructor(private readonly adminPeople: AdminPeopleRepository) {}
  async use(req: Request, res: Response, next: NextFunction) {
    try {
      // @ts-ignore
      if (req.user?.accessAccount !== undefined) {
        // @ts-ignore

        const userId = req.user.userId;
        // @ts-ignore

        const adminId = req.user.accessAccount.userId;
        if (adminId !== userId) {
          const member = await this.adminPeople.findOne({ adminId, userId });
          if (member == null) {
            throw new Error('Your access has been revoked');
          }
        }
        // @ts-ignore

        req.user.userId = req.user.accessAccount.userId;
        // @ts-ignore

        req.user.accessList = req.user.accessAccount.accessList;
        // @ts-ignore

        req.user.email = req.user.accessAccount.email;
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
