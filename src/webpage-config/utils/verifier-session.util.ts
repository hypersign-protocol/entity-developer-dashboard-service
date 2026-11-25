import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { redisClient } from 'src/utils/redis.provider';
import { generateHash } from 'src/utils/utils';
import { EXPIRY_CONFIG, TIME } from 'src/utils/time-constant';

// Verifier page tokens are public: anyone who opens a published page gets
// them. Each token request therefore gets its own random, short-lived Redis
// session instead of the old shared hash(appId) key, so sessions can be told
// apart and revoked per page.

// Longest verifier session TTL; the per-page index must outlive its members.
const MAX_VERIFIER_SESSION_TTL = Math.max(
  EXPIRY_CONFIG.VERIFIER_CUSTOMER_APP_ACCESS.redisExpiryTime,
  EXPIRY_CONFIG.VERIFIER_CUSTOMER_KYB_APP_ACCESS.redisExpiryTime,
);

const pageSessionIndexKey = (pageId: string) => `verifier:sessions:${pageId}`;

export const newVerifierSessionId = (): string => generateHash(randomUUID());

export async function trackVerifierSessions(
  pageId: string,
  sessionIds: string[],
): Promise<void> {
  const key = pageSessionIndexKey(pageId);
  await redisClient.sadd(key, ...sessionIds);
  await redisClient.expire(key, MAX_VERIFIER_SESSION_TTL);
}

// Deletes every live session issued for the page, so its tokens stop working
// at once (the KYC service rejects a token whose session is gone).
export async function revokeVerifierSessions(pageId: string): Promise<void> {
  const key = pageSessionIndexKey(pageId);
  const sessionIds = await redisClient.smembers(key);
  if (sessionIds.length) {
    await redisClient.del(...sessionIds);
  }
  await redisClient.del(key);
  Logger.debug(
    `Revoked ${sessionIds.length} verifier sessions for page ${pageId}`,
    'VerifierSession',
  );
}

// Fixed-window counter; returns the count after this hit.
export async function hitCounter(
  key: string,
  windowSeconds: number,
): Promise<number> {
  const count = await redisClient.incr(key);
  if (count === 1) {
    await redisClient.expire(key, windowSeconds);
  }
  return count;
}

export const VERIFIER_TOKEN_RATE_LIMIT = {
  // Per client IP per page: a real visitor loads a page a few times a minute.
  PER_IP_PER_MINUTE: 10,
  // Per page across all visitors.
  PER_PAGE_PER_MINUTE: 300,
  WINDOW: TIME.MINUTE,
};

export const pageIpRateKey = (pageId: string, ip: string) =>
  `rate:verifier:${pageId}:${ip}`;
export const pageRateKey = (pageId: string) => `rate:verifier:${pageId}`;
export const pageDailyKey = (pageId: string, day: string) =>
  `verifier:tokens:${pageId}:${day}`;
