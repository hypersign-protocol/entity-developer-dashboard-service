import { Module } from '@nestjs/common';
import { HidWalletService } from './services/hid-wallet.service';
@Module({
  controllers: [],
  providers: [HidWalletService],
  exports: [HidWalletService],
})
export class HidWalletModule {}
