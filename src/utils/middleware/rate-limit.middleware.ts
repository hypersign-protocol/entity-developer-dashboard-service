import {
    Injectable,
    NestMiddleware,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { redisClient } from '../redis.provider';
import { ThrottlerException } from '@nestjs/throttler';

@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
    async use(req: Request, res: Response, next: NextFunction) {
        const ip = req.ip || req.connection.remoteAddress;
        const userId = req.user?.['userId'];
        const key = `rate:${userId}:${ip}`;

        const count = await redisClient.incr(key);
        if (count === 1) {
            await redisClient.expire(key, 60);
        }
        if (count > 10) {
            throw new ThrottlerException('Too many requests. Try again later.');
        }
        next();
    }
}
