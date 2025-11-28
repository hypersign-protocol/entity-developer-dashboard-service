export const TENANT_ERRORS = {
  ALREADY_IN_TENANT: 'You are already switched to this tenant.',
  ADMIN_NOT_FOUND: 'Tenant admin not found.',
  NOT_A_MEMBER: (email: string) =>
    `You are not a member of the tenant managed by ${email}.`,
  INVITATION_NOT_ACCEPTED:
    'Please accept the tenant invitation before switching.',
  ROLE_NOT_FOUND: 'The assigned role does not exist.',
  NO_PERMISSION: 'The assigned role has no permissions.',
};

export const TENANT_INVITE_ERRORS = {
  SELF_INVITATION_NOT_ALLOWED: 'You cannot send an invitation to yourself.',
  ALREADY_INVITED: 'This user is already associated with your account.',
  ROLE_NOT_FOUND: (roleId: string) =>
    `No role found for the provided roleId: ${roleId}.`,
  NO_ROLE_ASSIGNED: 'Please add a role before inviting a member.',
};

export const TENANT_MESSAGES = {
  SWITCH_SUCCESS: 'Switched to tenant account successfully',
  SWITCH_BACK_SUCCESS: 'Switched back to main account successfully',
};
