import { SERVICE_TYPES } from 'src/supported-service/services/iServiceList';

export const ONBORDING_CONSTANT_DATA = {
  TEAM_ROLE_NAME: 'Admin',
  ROLE_DESCRIPTION: 'Admin role with all permissions',
  ROLE_PERMISSIONS: [
    {
      access: 'ALL',
      serviceType: SERVICE_TYPES.SSI_API,
    },
    {
      access: 'ALL',
      serviceType: SERVICE_TYPES.CAVACH_API,
    },
    {
      access: 'ALL',
      serviceType: SERVICE_TYPES.QUEST,
    },
  ],
};
