import {
  Injectable,
  Logger,
  NestMiddleware,
  UnauthorizedException,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { NextFunction, Request, Response } from 'express';
import { UserRepository } from 'src/user/repository/user.repository';
@Injectable()
export class JWTAuthorizeMiddleware implements NestMiddleware {
  constructor(private readonly userRepository: UserRepository) {}
  async use(req: Request, res: Response, next: NextFunction) {
    Logger.log('Inside JWTAuthorizeMiddleware', 'JWTAuthorizeMiddleware');
    if (!req.header('authorization') || req.headers['authorization'] === '') {
      throw new UnauthorizedException([
        'Please pass authorization token in the header',
      ]);
    }
    const authToken = req.header('authorization');
    const tokenParts: Array<string> = authToken.split(' ');
    if (tokenParts[0] !== 'Bearer') {
      Logger.log('Bearer authToken is not passed in header');
      throw new UnauthorizedException(['Please pass Bearer auth token']);
    }
    let decoded;
    try {
      decoded = jwt.verify(tokenParts[1], process.env.JWT_SECRET);
      if (decoded) {
        const user = await this.userRepository.findOne({
          userId: decoded.appUserID,
        });
        if (!user) {
          throw new Error('User not found');
        }
        req['user'] = user;

        if (decoded.isTwoFactorEnabled !== undefined) {
          req['user']['isTwoFactorEnabled'] = decoded.isTwoFactorEnabled;
        }

        if (decoded.isTwoFactorAuthenticated !== undefined) {
          req['user']['isTwoFactorAuthenticated'] =
            decoded.isTwoFactorAuthenticated;
        }

        if (decoded.accessAccount !== undefined) {
          req['user']['accessAccount'] = decoded.accessAccount;
        }

        Logger.log(JSON.stringify(req.user), 'JWTAuthorizeMiddleware');
      }
    } catch (e) {
      Logger.error(
        `JWTAuthorizeMiddleware: Error ${e}`,
        'JWTAuthorizeMiddleware',
      );
      throw new UnauthorizedException([e]);
    }
    next();
  }
}
