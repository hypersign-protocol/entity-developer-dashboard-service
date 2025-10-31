import { Test, TestingModule } from '@nestjs/testing';
import { CustomerOnboardingService } from './customer-onboarding.service';

describe('CustomerOnboardingService', () => {
  let service: CustomerOnboardingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CustomerOnboardingService],
    }).compile();

    service = module.get<CustomerOnboardingService>(CustomerOnboardingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
