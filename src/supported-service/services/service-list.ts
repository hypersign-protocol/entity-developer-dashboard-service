import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SERVICE_TYPES, SERVICES, SERVICE_INFO } from './iServiceList';
type Serivce = {
  id: string;
  dBSuffix: string;
  name: string;
  domain?: string;
  description: string;
  swaggerAPIDocPath: string;
  accessList: any;
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
        accessList: SERVICES.SSI_API.ACCESS_TYPES,
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
        accessList: SERVICES.CAVACH_API.ACCESS_TYPES,
      },
      {
        id: SERVICE_INFO.DASHBOARD.type,
        dBSuffix: SERVICE_INFO.DASHBOARD.type,
        name: SERVICE_INFO.DASHBOARD.name,
        description: SERVICE_INFO.DASHBOARD.description,
        swaggerAPIDocPath: SERVICE_INFO.DASHBOARD.swaggerAPIDocPath,
        accessList: SERVICES.DASHBOARD.ACCESS_TYPES,
      },
      {
        id: SERVICE_INFO.QUEST.type,
        dBSuffix: SERVICE_INFO.QUEST.type,
        name: SERVICE_INFO.QUEST.name,
        domain: SERVICE_INFO.QUEST.baseDomain,
        description: SERVICE_INFO.QUEST.description,
        swaggerAPIDocPath: SERVICE_INFO.QUEST.swaggerAPIDocPath,
        accessList: SERVICES.QUEST.ACCESS_TYPES,
      },
    ];
  }

  getDefaultServicesAccess(serviceType: SERVICE_TYPES) {
    const defaultServicesAccess = [];

    if (serviceType == SERVICE_TYPES.SSI_API) {
      // Giving access of SSI service by default
      Object.keys(SERVICES[serviceType].ACCESS_TYPES).forEach((access) => {
        if (access == SERVICES[serviceType].ACCESS_TYPES.ALL) {
          const serviceAccess = {
            serviceType: serviceType,
            access: access,
            expiryDate: null, // never expires
          };
          defaultServicesAccess.push(serviceAccess);
        }
      });
    } else if (serviceType == SERVICE_TYPES.CAVACH_API) {
      Object.keys(SERVICES[serviceType].ACCESS_TYPES).forEach((access) => {
        if (access == SERVICES[serviceType].ACCESS_TYPES.ALL) {
          const serviceAccess = {
            serviceType: serviceType,
            access: access,
            expiryDate: null, // never expires
          };
          defaultServicesAccess.push(serviceAccess);
        }
      });
    }
    // else if (serviceType == SERVICE_TYPES.QUEST) {
    //   Object.keys(SERVICES[serviceType].ACCESS_TYPES).forEach((access) => {
    //     if (access == SERVICES[serviceType].ACCESS_TYPES.ALL) {
    //       const serviceAccess = {
    //         serviceType: serviceType,
    //         access: access,
    //         expiryDate: null, // never expires
    //       };
    //       defaultServicesAccess.push(serviceAccess);
    //     }
    //   });
    // }
    else {
      throw new Error('Invalid service type: ' + serviceType);
    }
    return defaultServicesAccess;
  }
}
