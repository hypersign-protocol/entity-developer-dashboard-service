import { Test, TestingModule } from '@nestjs/testing';
import { IpResolverService } from './ip-resolver.service';

describe('IpResolverService', () => {
  let service: IpResolverService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [IpResolverService],
    }).compile();

    service = module.get<IpResolverService>(IpResolverService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
