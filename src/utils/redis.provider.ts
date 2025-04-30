import Redis from 'ioredis';
export const redisClient = new Redis({
  host: 'redis-stack-service.hypermine-development.svc.cluster.local',
  port: 6379,
});
