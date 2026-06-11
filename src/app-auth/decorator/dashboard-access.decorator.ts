import { SetMetadata } from '@nestjs/common';

export const RequireDashboardAccess = (access: string) =>
  SetMetadata('required_access', access);
