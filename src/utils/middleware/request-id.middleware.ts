import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    // Always generate the public request ID here instead of trusting a
    // caller-controlled header as an internal correlation identifier.
    const requestId = randomUUID();
    req['requestId'] = requestId;
    res.setHeader('x-request-id', requestId);
    next();
  }
}
