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
      'WhitelistAppCorsMiddleware: checking if call is form whitelisted domain starts',
      'Middleware',
    );
    const whitelistedOrigins = process.env.WHITELISTED_CORS;
    const apiSecretKey = req.headers['x-api-secret-key'] as string;
    const origin = req.header('Origin');
    Logger.debug(
      `WhitelistAppCorsMiddleware: request is comming from ${origin}`,
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
          'WhitelistAppCorsMiddleware: Error: origin mismatch',
          'Middleware',
        );
        throw new UnauthorizedException(['Origin mismatch']);
      }
      return next();
    } else {
      throw new UnauthorizedException([
        'This is CORS-enabled for a whitelisted domain.',
      ]);
    }
  }
}
