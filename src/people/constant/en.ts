export const TENANT_ERRORS = {
  ALREADY_IN_TENANT: 'You are already using this tenant.',
  ADMIN_NOT_FOUND: 'Tenant administrator could not be found.',
  NOT_A_MEMBER: (email: string) =>
    `You are not a member of the tenant managed by ${email}.`,
  INVITATION_NOT_ACCEPTED:
    'You must accept the tenant invitation before switching.',
  ROLE_NOT_FOUND: 'The specified role does not exist.',
  NO_PERMISSION: 'The assigned role has no available permissions.',
};
export const TENANT_INVITE_ERRORS = {
  SELF_INVITATION_NOT_ALLOWED: 'You cannot invite your own account.',
  ALREADY_INVITED: 'This user is already associated with your tenant.',
  ROLE_NOT_FOUND: (roleId: string) =>
    `No role exists for the provided role ID: ${roleId}.`,
  NO_ROLE_ASSIGNED: 'A role must be assigned before inviting a member.',
};
export const TENANT_MESSAGES = {
  SWITCH_SUCCESS: 'Switched to the tenant successfully.',
  SWITCH_BACK_SUCCESS: 'Returned to the primary account successfully.',
};
