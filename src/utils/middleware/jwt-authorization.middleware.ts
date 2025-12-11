import {
  HttpException,
  Injectable,
  Logger,
  NestMiddleware,
  UnauthorizedException,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { NextFunction, Request, Response } from 'express';
import { UserRepository } from 'src/user/repository/user.repository';
import { sanitizeUrl } from '../utils';
import { redisClient } from '../redis.provider';
import {
  AUTH_ERRORS,
  ERROR_MESSAGE,
  MFA_ERROR,
  REFRESH_TOKEN_ERROR,
} from 'src/social-login/constants/en';
@Injectable()
export class JWTAuthorizeMiddleware implements NestMiddleware {
  constructor(private readonly userRepository: UserRepository) {}
  async use(req: Request, res: Response, next: NextFunction) {
    Logger.log('Inside JWTAuthorizeMiddleware', 'JWTAuthorizeMiddleware');
    const authToken: string = req?.cookies?.accessToken;
    if (!authToken) {
      throw new UnauthorizedException([AUTH_ERRORS.EMPTY_TOKEN]);
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
      decoded = jwt.verify(authToken, process.env.JWT_SECRET);
      if (decoded) {
        // verifying the domain of frontend and token domain
        const requestOrigin =
          req?.headers?.origin || req?.headers?.referer || req?.headers?.host;
        if (!skipDomainValidation) {
          if (decoded.aud) {
            const ifDomainValid = sanitizeUrl(requestOrigin, false).includes(
              sanitizeUrl(decoded.aud, false),
            );
            if (!ifDomainValid) {
              throw new Error(AUTH_ERRORS.TOKEN_DOMAIN_MISMATCH);
            }
          } else {
            throw new Error(AUTH_ERRORS.TOKEN_DOMAIN_MISSING);
          }
        }
        const { sid, sub } = decoded;
        if (!sid || !sub) {
          throw new UnauthorizedException([AUTH_ERRORS.INVALID_TOKEN]);
        }
        const sessionRaw = await redisClient.get(`session:${sid}`);
        if (!sessionRaw) {
          throw new UnauthorizedException([AUTH_ERRORS.SESSION_EXPIRED]);
        }
        const session = JSON.parse(sessionRaw);
        if (session.userId !== decoded.sub) {
          throw new UnauthorizedException([AUTH_ERRORS.SESSION_MISMATCH]);
        }
        if (session.refreshVersion !== decoded.refreshVersion) {
          throw new UnauthorizedException([
            REFRESH_TOKEN_ERROR.REFRESH_VERSION_MISMATCH,
          ]);
        }

        if (session.isTwoFactorAuthenticated) {
          if (!session.isTwoFactorVerified) {
            throw new UnauthorizedException([MFA_ERROR.TWO_FA_REQUIRED]);
          }
        }
        const user = await this.userRepository.findOne({
          userId: decoded.sub,
        });
        if (!user) {
          throw new Error(ERROR_MESSAGE.USER_NOT_FOUND);
        }
        req['user'] = user;
        req['session'] = session;
      }
    } catch (e) {
      Logger.error(
        `JWTAuthorizeMiddleware: Error ${e}`,
        'JWTAuthorizeMiddleware',
      );
      if (e instanceof HttpException) {
        throw e;
      }
      throw new UnauthorizedException([e.message]);
    }
    next();
  }
}
