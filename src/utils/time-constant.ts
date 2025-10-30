export const TIME = {
  SECOND: 1,
  MINUTE: 60 * 1,
  HOUR: 60 * 60 * 1,
  DAY: 24 * 60 * 60 * 1,
  WEEK: 7 * 24 * 60 * 60 * 1,
};

export const TOKEN_MAX_AGE = {
  AUTH_TOKEN: 4 * TIME.HOUR * 1000, // 4 hours
  REFRESH_TOKEN: 7 * TIME.DAY * 1000, // 7 days
};

export enum JobNames {
  SEND_EMAIL_LOGIN_OTP = 'send-email-login-otp',
  SEND_TEAM_MATE_INVITATION_MAIL = 'sendTeamMatemail'
}