import {
  Injectable,
  Logger,
  NestMiddleware,
  UnauthorizedException,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { NextFunction, Request, Response } from 'express';
import { UserRepository } from 'src/user/repository/user.repository';
import { sanitizeUrl } from '../utils';
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
      const publicEp = sanitizeUrl(
        process.env.DEVELOPER_DASHBOARD_SERVICE_PUBLIC_EP,
        false,
      );
      const origin = req?.headers?.origin;
      const referer = req?.headers?.referer;
      const userAgent = req?.headers['user-agent'] || '';

      const isToolRequest =
        (!origin && !referer) ||
        userAgent.toLowerCase().includes('postman') ||
        userAgent.toLowerCase().includes('insomnia');
      const skipDomainValidation =
        isToolRequest ||
        (req.headers.origin && req.headers.origin.includes(publicEp)) ||
        (req.headers.referer && req.headers.referer.includes(publicEp));
      decoded = jwt.verify(tokenParts[1], process.env.JWT_SECRET);
      if (decoded) {
        // verifying the domain of frontend and token domain
        const requestOrigin =
          req?.headers?.origin || req?.headers?.referer || req?.headers?.host;
        if (!skipDomainValidation) {
          if (decoded.domain) {
            const ifDomainValid = sanitizeUrl(requestOrigin, false).includes(
              sanitizeUrl(decoded.domain, false),
            );
            if (!ifDomainValid) {
              throw new Error(
                'This token was issued for a different domain than the one making the request.',
              );
            }
          } else {
            throw new Error('Token does not contain a valid domain.');
          }
        }
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
      throw new UnauthorizedException([e.message]);
    }
    next();
  }
}
