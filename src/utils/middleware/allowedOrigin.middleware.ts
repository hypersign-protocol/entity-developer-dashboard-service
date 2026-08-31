import {
  ForbiddenException,
  Injectable,
  Logger,
  NestMiddleware,
} from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { urlSanitizer } from '../sanitizeUrl.validator';

@Injectable()
export class AllowedOriginMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    Logger.log(
      'Inside AllowedOriginMiddleware to validate origin',
      'AllowedOriginMiddleware',
    );
    const allowedOrigin = (
      process.env.ALLOWED_ORIGIN || 'https://entity.dashboard.hypersign.id'
    )
      .split(',')
      .map((origin) => urlSanitizer(origin.trim(), false));
    const requestOrigin = req.headers.origin;
    const referer = req.headers.referer;
    const forwardedProtocol = req.headers['x-forwarded-proto'];
    const protocol =
      typeof forwardedProtocol === 'string'
        ? forwardedProtocol.split(',')[0].trim()
        : req.protocol;
    const requestOriginUrl = req.get('host')
      ? urlSanitizer(`${protocol}://${req.get('host')}`, false)
      : undefined;
    const isAllowed = (value: string | string[] | undefined) => {
      if (!value) {
        return true;
      }

      if (typeof value !== 'string') {
        return false;
      }

      const sanitizedUrl = urlSanitizer(value, false);
      return [...allowedOrigin, requestOriginUrl]
        .filter(Boolean)
        .some(
          (origin) =>
            sanitizedUrl === origin || sanitizedUrl.startsWith(`${origin}/`),
        );
    };
    const isOriginAllowed = isAllowed(requestOrigin);
    const isRefererAllowed = isAllowed(referer);

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
