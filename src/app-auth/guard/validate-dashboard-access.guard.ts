import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  SERVICES,
  SERVICE_TYPES,
} from 'src/supported-service/services/iServiceList';

export const ACCESS_KEY = 'required_access';

@Injectable()
export class DashboardAccessGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredAccess = this.reflector.get<string>(
      ACCESS_KEY,
      context.getHandler(),
    );

    if (!requiredAccess) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const session = request.session;
    // If this is not a tenant-switched session, skip dashboard access check
    if (!session?.tenantId) {
      return true;
    }
    // For tenant-switched sessions, user.accessList should be present
    if (!user?.accessList) {
      throw new ForbiddenException(
        'You do not have permission for this action.',
      );
    }
    const hasAccess = user.accessList.some((permission) => {
      return (
        permission.serviceType === SERVICE_TYPES.DASHBOARD &&
        (permission.access === SERVICES.DASHBOARD.ACCESS_TYPES.ALL ||
          permission.access === requiredAccess)
      );
    });

    if (!hasAccess) {
      throw new ForbiddenException(
        'You do not have permission for this action.',
      );
    }

    return true;
  }
}
