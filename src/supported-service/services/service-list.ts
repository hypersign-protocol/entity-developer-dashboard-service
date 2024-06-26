import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SERVICE_TYPES, SERVICES, SERVICE_INFO } from './iServiceList';
type Serivce = {
  id: string;
  dBSuffix: string;
  name: string;
  domain: string;
  description: string;
  swaggerAPIDocPath: string;
};

@Injectable()
export class SupportedServiceList {
  constructor(private readonly config: ConfigService) {}
  getServices(): Array<Serivce> {
    return [
      {
        id: SERVICE_INFO.SSI_API.type,
        dBSuffix: SERVICE_INFO.SSI_API.type,
        name: SERVICE_INFO.SSI_API.name,
        domain:
          this.config.get('SSI_API_DOMAIN') || SERVICE_INFO.SSI_API.baseDomain,
        description: SERVICE_INFO.SSI_API.description,
        swaggerAPIDocPath: SERVICE_INFO.SSI_API.swaggerAPIDocPath,
      },
      {
        id: SERVICE_INFO.CAVACH_API.type,
        dBSuffix: SERVICE_INFO.CAVACH_API.type,
        name: SERVICE_INFO.CAVACH_API.name,
        domain:
          this.config.get('CAVACH_API_DOMAIN') ||
          SERVICE_INFO.CAVACH_API.baseDomain,
        description: SERVICE_INFO.CAVACH_API.description,
        swaggerAPIDocPath: SERVICE_INFO.CAVACH_API.swaggerAPIDocPath,
      },
    ];
  }

  getDefaultServicesAccess(serviceType: SERVICE_TYPES) {
    const defaultServicesAccess = [];

    if (serviceType == SERVICE_TYPES.SSI_API) {
      // Giving access of SSI service by default
      Object.keys(SERVICES[serviceType].ACCESS_TYPES).forEach((access) => {
        const serviceAccess = {
          serviceType: serviceType,
          access: access,
          expiryDate: null, // never expires
        };
        defaultServicesAccess.push(serviceAccess);
      });
    } else if (serviceType == SERVICE_TYPES.CAVACH_API) {
      Object.keys(SERVICES[serviceType].ACCESS_TYPES).forEach((access) => {
        if (access == SERVICES[serviceType].ACCESS_TYPES.READ_SESSION) {
          return;
        } else if (access == SERVICES[serviceType].ACCESS_TYPES.ALL) {
          return;
        } else {
          const serviceAccess = {
            serviceType: serviceType,
            access: access,
            expiryDate: null, // never expires
          };
          defaultServicesAccess.push(serviceAccess);
        }
      });
    } else {
      throw new Error('Invalid service type: ' + serviceType);
    }
    return defaultServicesAccess;
  }
}
