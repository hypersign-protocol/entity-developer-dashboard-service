import { Test, TestingModule } from '@nestjs/testing';
import { SocialLoginController } from './social-login.controller';
import { SocialLoginService } from '../services/social-login.service';

describe('SocialLoginController', () => {
  let controller: SocialLoginController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SocialLoginController],
      providers: [SocialLoginService],
    })
      // Auto-mock constructor dependencies these smoke tests don't exercise.
      .useMocker(() => ({}))
      .compile();

    controller = module.get<SocialLoginController>(SocialLoginController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
