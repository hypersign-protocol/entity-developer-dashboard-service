import {
  Injectable,
  NestMiddleware,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { UserRole } from 'src/user/schema/user.schema';

@Injectable()
export class SuperAdminMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    Logger.log('Inside SuperAdminMiddleware', 'SuperAdminMiddleware');
    const user = req['user'];
    if (!user) {
      throw new ForbiddenException(['User not found in request']);
    }
    if (user['role'] !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException([
        'You are not authorized to access this resource',
      ]);
    }
    next();
  }
}
