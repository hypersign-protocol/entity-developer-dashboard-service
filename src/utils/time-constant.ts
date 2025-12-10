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
  SEND_TEAM_MATE_INVITATION_MAIL = 'sendTeamMatemail',
}

export enum TIME_UNIT {
  SECOND = 's',
  MINUTE = 'm',
  HOUR = 'h',
  DAY = 'd',
}
export const getSecondsFromUnit = (time: number, unit: TIME_UNIT) => {
  return time * TIME[unit.toUpperCase()];
};

export const EXPIRY_CONFIG = {
  VERIFIER_ACCESS: {
    jwtTime: 30,
    jwtUnit: TIME_UNIT.MINUTE,
    redisExpiryTime: 30 * TIME.MINUTE,
  },
  ONBOARDING_ACCESS: {
    jwtTime: 10,
    jwtUnit: TIME_UNIT.MINUTE,
  },
  SERVICE_ACCESS: {
    jwtTime: 12,
    jwtUnit: TIME_UNIT.HOUR,
    redisExpiryTime: TIME.WEEK,
  },
  CREDIT_TOKEN: {
    jwtTime: 5,
    jwtUnit: TIME_UNIT.MINUTE,
    redisExpiryTime: 5 * TIME.MINUTE,
  },
  LOGIN: {
    redisExpiryTime: TIME.WEEK,
  },
} as const;
