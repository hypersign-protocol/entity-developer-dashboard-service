import Redis from 'ioredis';
import * as dotenv from 'dotenv';
dotenv.config();
export const redisClient = new Redis({
  host:
    process.env.REDIS_HOST ||
    'redis-stack-service.hypermine-development.svc.cluster.local',
  port: 6379,
});
