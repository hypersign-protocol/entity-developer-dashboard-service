import { Test, TestingModule } from '@nestjs/testing';
import { SupportedServiceController } from './supported-service.controller';
import { SupportedServiceService } from '../services/supported-service.service';

describe('SupportedServiceController', () => {
  let controller: SupportedServiceController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SupportedServiceController],
      providers: [SupportedServiceService],
    })
      // Auto-mock constructor dependencies these smoke tests don't exercise.
      .useMocker(() => ({}))
      .compile();

    controller = module.get<SupportedServiceController>(
      SupportedServiceController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
