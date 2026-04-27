import {
  Injectable,
  Logger,
  NestMiddleware,
  UnauthorizedException,
} from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { AppRepository } from 'src/app-auth/repositories/app.repository';
@Injectable()
export class WhitelistAppCorsMiddleware implements NestMiddleware {
  constructor(private readonly appRepositiory: AppRepository) {}
  async use(req: Request, res: Response, next: NextFunction) {
    Logger.log(
      'WhitelistAppCorsMiddleware: checking whether the request is from a whitelisted domain',
      'Middleware',
    );
    const whitelistedOrigins = process.env.WHITELISTED_CORS;
    const apiSecretKey = req.headers['x-api-secret-key'] as string;
    const origin = req.header('Origin');
    Logger.debug(
      'WhitelistAppCorsMiddleware: received a request from an origin header',
      'Middleware',
    );
    if (whitelistedOrigins.includes(origin)) {
      return next();
    } else if (apiSecretKey !== '' && apiSecretKey != undefined) {
      const apikeyIndex = apiSecretKey?.split('.')[0];
      const appDetail = await this.appRepositiory.findOne({
        apiKeyPrefix: apikeyIndex,
      });
      if (!appDetail) {
        throw new UnauthorizedException(['access_denied']);
      }
      if (appDetail.whitelistedCors.includes('*')) {
        return next();
      }
      if (!appDetail.whitelistedCors.includes(origin)) {
        Logger.error(
          'WhitelistAppCorsMiddleware: origin mismatch',
          'Middleware',
        );
        throw new UnauthorizedException(['The request origin is not allowed.']);
      }
      return next();
    } else {
      throw new UnauthorizedException([
        'This endpoint is only available to approved domains.',
      ]);
    }
  }
}
