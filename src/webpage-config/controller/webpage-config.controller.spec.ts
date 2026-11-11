import { Test, TestingModule } from '@nestjs/testing';
import { WebpageConfigController } from './webpage-config.controller';
import { WebpageConfigService } from '../services/webpage-config.service';

describe('WebpageConfigController', () => {
  let controller: WebpageConfigController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebpageConfigController],
      providers: [WebpageConfigService],
    })
      // Auto-mock constructor dependencies these smoke tests don't exercise.
      .useMocker(() => ({}))
      .compile();

    controller = module.get<WebpageConfigController>(WebpageConfigController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
