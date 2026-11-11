import { Test, TestingModule } from '@nestjs/testing';
import { CustomerOnboardingService } from './customer-onboarding.service';

describe('CustomerOnboardingService', () => {
  let service: CustomerOnboardingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CustomerOnboardingService],
    })
      // Auto-mock constructor dependencies these smoke tests don't exercise.
      .useMocker(() => ({}))
      .compile();

    service = module.get<CustomerOnboardingService>(CustomerOnboardingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
