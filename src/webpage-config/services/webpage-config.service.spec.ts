import { Test, TestingModule } from '@nestjs/testing';
import { WebpageConfigService } from './webpage-config.service';

describe('WebpageConfigService', () => {
  let service: WebpageConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WebpageConfigService],
    })
      // Auto-mock constructor dependencies these smoke tests don't exercise.
      .useMocker(() => ({}))
      .compile();

    service = module.get<WebpageConfigService>(WebpageConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
