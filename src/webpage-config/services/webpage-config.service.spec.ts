import { Test, TestingModule } from '@nestjs/testing';
import { WebpageConfigService } from './webpage-config.service';

describe('WebpageConfigService', () => {
  let service: WebpageConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WebpageConfigService],
    }).compile();

    service = module.get<WebpageConfigService>(WebpageConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
