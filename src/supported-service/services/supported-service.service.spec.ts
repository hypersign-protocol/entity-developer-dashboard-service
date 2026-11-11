import { Test, TestingModule } from '@nestjs/testing';
import { SupportedServiceService } from './supported-service.service';

describe('SupportedServiceService', () => {
  let service: SupportedServiceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SupportedServiceService],
    })
      // Auto-mock constructor dependencies these smoke tests don't exercise.
      .useMocker(() => ({}))
      .compile();

    service = module.get<SupportedServiceService>(SupportedServiceService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
