export const ERROR_MESSAGE = {
  SESSION_NOT_FOUND: 'Session not found or expired.',
  MFA_ALREADY_ENABLED: 'MFA is already enabled for this user.',
  INVALID_OTP: 'Invalid or expired OTP code.',
  MFA_NOT_VERIFIED: 'Two-factor authentication (2FA) is required.',
  USER_NOT_FOUND: 'User not found',
} as const;

export const AUTH_ERRORS = {
  EMPTY_TOKEN: 'Please pass authorization token in cookie',
  SESSION_EXPIRED: 'Session expired or logged out',
  SESSION_MISMATCH: 'Token does not match session',
  TWO_FA_REQUIRED: '2FA verification required',
  TOKEN_DOMAIN_MISMATCH:
    'This token was issued for a different domain than the one making the request.',
  TOKEN_DOMAIN_MISSING: 'Token does not contain a valid domain.',
  INVALID_TOKEN: 'Invalid token',
};

export const REFRESH_TOKEN_ERROR = {
  INVALID_REFRESH_TOKEN: 'Invalid refresh token',
  REFRESH_TOKEN_NOT_FOUND: 'Refresh token not found or expired.',
  REFRESH_VERSION_MISMATCH: 'Your session has expired. Please log in again.',
};
