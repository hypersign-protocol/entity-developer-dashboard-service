import { Injectable } from '@nestjs/common';
import { SupportedServiceList } from './service-list';
@Injectable()
export class SupportedServiceService {
  constructor(private readonly serviceList: SupportedServiceList) {}
  fetchServiceList() {
    return this.serviceList.getServices();
  }

  fetchServiceById(id: string) {
    return this.serviceList
      .getServices()
      .find((service) => service['id'] === id);
  }
}
