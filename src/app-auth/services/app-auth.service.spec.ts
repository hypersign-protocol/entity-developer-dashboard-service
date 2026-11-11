import { Test, TestingModule } from '@nestjs/testing';
import { AppAuthService } from './app-auth.service';

describe('AppAuthService', () => {
  let service: AppAuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AppAuthService],
    })
      // Auto-mock constructor dependencies these smoke tests don't exercise.
      .useMocker(() => ({}))
      .compile();

    service = module.get<AppAuthService>(AppAuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
