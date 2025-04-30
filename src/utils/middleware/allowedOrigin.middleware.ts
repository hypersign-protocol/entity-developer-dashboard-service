import {
  ForbiddenException,
  Injectable,
  Logger,
  NestMiddleware,
} from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { sanitizeUrl } from '../utils';

@Injectable()
export class AllowedOriginMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    Logger.log(
      'Inside AllowedOriginMiddleware to validate origin',
      'AllowedOriginMiddleware',
    );
    const allowedOrigin = (process.env.ALLOWED_ORIGIN || '')
      .split(',')
      .map((origin) => sanitizeUrl(origin.trim(), false));
    const requestOrigin = req.headers.origin;
    const referer = req.headers.referer;
    const isOriginAllowed =
      !requestOrigin || allowedOrigin.some((o) => requestOrigin.startsWith(o));
    const isRefererAllowed =
      !referer || allowedOrigin.some((o) => referer.startsWith(o));

    if (isOriginAllowed && isRefererAllowed) {
      return next();
    }
    Logger.warn('Blocked request from:', {
      origin: requestOrigin,
      referer,
    });
    throw new ForbiddenException(['Origin not allowed']);
  }
}
