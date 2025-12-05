export const ERROR_MESSAGE = {
  SESSION_NOT_FOUND: 'Session not found or expired.',
  INVALID_OTP: 'Invalid or expired OTP code.',
  USER_NOT_FOUND: 'User not found',
  LOGOUT_ISSUE: 'Logout failed on server',
} as const;

export const AUTH_ERRORS = {
  EMPTY_TOKEN: 'Please pass authorization token in cookie',
  SESSION_EXPIRED: 'Session expired or logged out',
  SESSION_MISMATCH: 'Token does not match session',
  TOKEN_DOMAIN_MISMATCH:
    'This token was issued for a different domain than the one making the request.',
  TOKEN_DOMAIN_MISSING: 'Token does not contain a valid domain.',
  INVALID_TOKEN: 'Invalid token',
  TENANT_PERMISSION_ISSUE: 'Tenant does not have any assigned permissions',
  ACCESS_REVOKED: 'Your access has been revoked',
};

export const REFRESH_TOKEN_ERROR = {
  INVALID_REFRESH_TOKEN: 'Invalid refresh token',
  REFRESH_TOKEN_NOT_FOUND: 'Refresh token not found or expired.',
  REFRESH_VERSION_MISMATCH: 'Your session has expired. Please log in again.',
};

export const MFA_ERROR = {
  MFA_ALREADY_ENABLED: 'MFA is already enabled for this user.',
  MFA_NOT_VERIFIED: 'Two-factor authentication (2FA) is required.',
  MFA_ALREADY_VERIFIED:
    'MFA already verified. No further verification required.',
  TWO_FA_REQUIRED: '2FA verification required',
  INVALID_MFA_METHOD: 'Invalid MFA method selected for this session.',
  MFA_MAX_RETRY_EXCEEDED:
    'MFA verification failed too many times. Session expired.',
};
