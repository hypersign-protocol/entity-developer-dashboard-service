import { Test, TestingModule } from '@nestjs/testing';
import { HidWalletService } from '../services/hid-wallet.service';
import { ConfigService } from '@nestjs/config';

describe('HidWalletService', () => {
  let service: HidWalletService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [HidWalletService, ConfigService],
    }).compile();

    // HidWalletService is request-scoped, so it must be resolved, not fetched.
    service = await module.resolve<HidWalletService>(HidWalletService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('Should generate Wallet', async () => {
    const mnemonictest =
      'swift leader primary gun tool furnace gasp bless kid ceiling maid disagree bike tube enemy wish affair water faith blouse meadow traffic oval stay';
    const accountAddr = 'hid1g05260ny2c486274qtwey3sr2pl3kwjve4tfh4';
    const { address } = await service.generateWallet(mnemonictest);
    expect(accountAddr).toBe(address);
  });
});
