export const ERROR_MESSAGE = {
  SESSION_NOT_FOUND: 'Session not found or expired.',
  INVALID_OTP: 'Invalid or expired OTP code.',
  USER_NOT_FOUND: 'User not found.',
  LOGOUT_ISSUE: 'Failed to log out.',
} as const;

export const AUTH_ERRORS = {
  EMPTY_TOKEN: 'Please provide an authorization token in the cookie.',
  SESSION_EXPIRED: 'Your session has expired or you have been logged out.',
  SESSION_MISMATCH: 'The token does not match the current session.',
  TOKEN_DOMAIN_MISMATCH:
    'This token was issued for a different domain than the one making the request.',
  TOKEN_DOMAIN_MISSING: 'The token does not contain a valid domain.',
  INVALID_TOKEN: 'The token is invalid.',
  TENANT_PERMISSION_ISSUE: 'No permissions are assigned to this tenant.',
  ACCESS_REVOKED: 'Your access has been revoked.',
};

export const REFRESH_TOKEN_ERROR = {
  INVALID_REFRESH_TOKEN: 'The refresh token is invalid.',
  REFRESH_TOKEN_NOT_FOUND: 'Refresh token not found or expired.',
  REFRESH_VERSION_MISMATCH: 'Your session has expired. Please log in again.',
};

export const MFA_ERROR = {
  MFA_ALREADY_ENABLED: 'MFA is already enabled for this user.',
  MFA_NOT_VERIFIED: 'Two-factor authentication (2FA) is required.',
  MFA_ALREADY_VERIFIED:
    'MFA already verified. No further verification required.',
  TWO_FA_REQUIRED: 'Two-factor authentication verification is required.',
  INVALID_MFA_METHOD: 'The selected MFA method is invalid for this session.',
  MFA_MAX_RETRY_EXCEEDED:
    'MFA verification failed too many times. Session expired.',
};
