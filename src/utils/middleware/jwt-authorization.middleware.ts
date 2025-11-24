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
@Injectable()
export class JWTAuthorizeMiddleware implements NestMiddleware {
  constructor(private readonly userRepository: UserRepository) {}
  async use(req: Request, res: Response, next: NextFunction) {
    Logger.log('Inside JWTAuthorizeMiddleware', 'JWTAuthorizeMiddleware');
    const authToken: string = req?.cookies?.accessToken;
    if (!authToken) {
      throw new UnauthorizedException([
        'Please pass authorization token in cookie',
      ]);
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
              throw new Error(
                'This token was issued for a different domain than the one making the request.',
              );
            }
          } else {
            throw new Error('Token does not contain a valid domain.');
          }
        }
        const { sid, sub } = decoded;
        if (!sid || !sub) {
          throw new UnauthorizedException(['Invalid token']);
        }
        const sessionRaw = await redisClient.get(`session:${sid}`);
        if (!sessionRaw) {
          throw new UnauthorizedException(['Session expired or logged out']);
        }
        const session = JSON.parse(sessionRaw);
        if (session.userId !== decoded.sub) {
          throw new UnauthorizedException(['Token does not match session']);
        }
        if (session.mfaEnabled) {
          if (!session.mfaVerified) {
            throw new UnauthorizedException(['2FA verification required']);
          }
        }
        const user = await this.userRepository.findOne({
          userId: decoded.sub,
        });
        if (!user) {
          throw new Error('User not found');
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
