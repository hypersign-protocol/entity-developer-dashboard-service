import { Test, TestingModule } from '@nestjs/testing';
import { WebpageConfigController } from './webpage-config.controller';
import { WebpageConfigService } from './webpage-config.service';

describe('WebpageConfigController', () => {
  let controller: WebpageConfigController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebpageConfigController],
      providers: [WebpageConfigService],
    }).compile();

    controller = module.get<WebpageConfigController>(WebpageConfigController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
