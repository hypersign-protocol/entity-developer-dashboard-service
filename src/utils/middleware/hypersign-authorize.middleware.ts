import { Injectable, Logger, NestMiddleware } from '@nestjs/common';

import { NextFunction, Request, Response } from 'express';
@Injectable()
export class HypersignAuthorizeMiddleware implements NestMiddleware {
  async use(req: Request, res: Response, next: NextFunction) {
    Logger.log(
      'Inside HypersignAuthorizeMiddleware; before calling hs auth authenticate()',
      'HypersignAuthorizeMiddleware',
    );
    return globalThis.hypersignAuth.authorize(req, res, next);
  }
}
