export const TIME = {
  SECOND: 1,
  MINUTE: 60 * 1,
  HOUR: 60 * 60 * 1,
  DAY: 24 * 60 * 60 * 1,
  WEEK: 7 * 24 * 60 * 60 * 1,
};

export const COOKIE_CONFIG = {
  AUTH: {
    name: 'accessToken',
    expiry: 30 * TIME.MINUTE * 1000,
    redisExpiryTime: TIME.WEEK,
  },
  REFRESH: {
    name: 'refreshToken',
    expiry: 7 * TIME.DAY * 1000,
    redisExpiryTime: TIME.WEEK,
  },
};

export enum JobNames {
  SEND_EMAIL_LOGIN_OTP = 'send-email-login-otp',
  SEND_TEAM_MATE_INVITATION_MAIL = 'send-team-mate-invitation-mail',
  SEND_CREDIT_USAGE_NOTIFICATION = 'send-credit-usage-notification',
}

export enum TIME_UNIT {
  SECOND = 's',
  MINUTE = 'm',
  HOUR = 'h',
  DAY = 'd',
}
export const getSecondsFromUnit = (time: number, unit: TIME_UNIT) => {
  const key = Object.keys(TIME_UNIT).find(
    (k) => TIME_UNIT[k as keyof typeof TIME_UNIT] === unit,
  ) as keyof typeof TIME;

  return time * TIME[key];
};

/**
 *  EXPIRY_CONFIG defines the expiry times for different types of tokens and Redis cache entries used across the system.
 */
export const EXPIRY_CONFIG = {
  // KYC and SSI Token for context - verifier Page and Customer App

  VERIFIER_CUSTOMER_APP_ACCESS: {
    jwtTime: 30,
    jwtUnit: TIME_UNIT.MINUTE,
    redisExpiryTime: 30 * TIME.MINUTE,
  },

  // All Tokens generated during onboarding flow

  ONBOARDING_ACCESS: {
    jwtTime: 10,
    jwtUnit: TIME_UNIT.MINUTE,
  },

  // KYC and SSI tokens for context - ID and SSI Dashboard
  DASHBOARD_ACCESS: {
    jwtTime: 12,
    jwtUnit: TIME_UNIT.HOUR,
    redisExpiryTime: TIME.WEEK,
  },

  // Token generated for providing credit for SSI and KYC service
  CREDIT_TOKEN: {
    jwtTime: 5,
    jwtUnit: TIME_UNIT.MINUTE,
    redisExpiryTime: 5 * TIME.MINUTE,
  },
  // Used for storing login flow–related data in Redis

  LOGIN: {
    redisExpiryTime: TIME.WEEK,
  },
} as const;
