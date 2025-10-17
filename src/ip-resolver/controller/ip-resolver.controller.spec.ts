import { Test, TestingModule } from '@nestjs/testing';
import { IpResolverService } from '../services/ip-resolver.service';
import { IpResolverController } from './ip-resolver.controller';

describe('IpResolverController', () => {
  let controller: IpResolverController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [IpResolverController],
      providers: [IpResolverService],
    }).compile();

    controller = module.get<IpResolverController>(IpResolverController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
