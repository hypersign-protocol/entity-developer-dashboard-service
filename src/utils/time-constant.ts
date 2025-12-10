export const TIME = {
  SECOND: 1,
  MINUTE: 60 * 1,
  HOUR: 60 * 60 * 1,
  DAY: 24 * 60 * 60 * 1,
  WEEK: 7 * 24 * 60 * 60 * 1,
};


export const TOKEN = {
  AUTH: {
    name: 'accessToken',
    expiry: 30 * TIME.MINUTE * 1000,
  },
  REFRESH: {
    name: 'refreshToken',
    expiry: 7 * TIME.DAY * 1000,
  },
  VERIFIER_TOKEN: {
    name: 'verifierPageToken',
    expiry: 30 * TIME.MINUTE,
    jwtExpiry: 0.5,
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