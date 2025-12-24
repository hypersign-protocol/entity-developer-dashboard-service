import { Module } from '@nestjs/common';
import { SupportedServiceService } from './services/supported-service.service';
import { SupportedServiceController } from './controller/supported-service.controller';
import { SupportedServiceList } from './services/service-list';

@Module({
  controllers: [SupportedServiceController],
  providers: [SupportedServiceService, SupportedServiceList],
})
export class SupportedServiceModule {}
