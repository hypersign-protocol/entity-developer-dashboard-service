export const MFA_MESSAGE = {
  SESSION_NOT_FOUND: 'Session not found or expired.',
  MFA_ALREADY_ENABLED: 'MFA is already enabled for this user.',
  INVALID_OTP: 'Invalid or expired OTP code.',
} as const;

export const AUTH_ERRORS = {
  SESSION_EXPIRED: 'Session expired or logged out',
  SESSION_MISMATCH: 'Token does not match session',
  TWO_FA_REQUIRED: '2FA verification required',
};
