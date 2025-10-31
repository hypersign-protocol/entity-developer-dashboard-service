import { Test, TestingModule } from '@nestjs/testing';
import { CustomerOnboardingController } from '../customer-onboarding.controller';
import { CustomerOnboardingService } from '../services/customer-onboarding.service';

describe('CustomerOnboardingController', () => {
  let controller: CustomerOnboardingController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CustomerOnboardingController],
      providers: [CustomerOnboardingService],
    }).compile();

    controller = module.get<CustomerOnboardingController>(
      CustomerOnboardingController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
