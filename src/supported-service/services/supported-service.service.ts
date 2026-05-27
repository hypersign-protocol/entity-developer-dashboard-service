import { Injectable, Logger } from '@nestjs/common';
import { SupportedServiceList } from './service-list';
@Injectable()
export class SupportedServiceService {
  constructor(private readonly serviceList: SupportedServiceList) {}
  fetchServiceList() {
    Logger.log('Inside fetchServiceList()', 'SupportedServiceService');
    return this.serviceList.getServices();
  }

  fetchServiceById(id: string) {
    Logger.log(
      'Inside fetchServiceById() to fetch particular service',
      'SupportedServiceService',
    );

    return this.serviceList
      .getServices()
      .find((service) => service['id'] === id);
  }
}
