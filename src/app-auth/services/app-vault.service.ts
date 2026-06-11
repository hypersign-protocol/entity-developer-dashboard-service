import { Logger } from '@nestjs/common';
import { VaultWalletManager } from '../../edv/services/vaultWalletManager';
import { EdvClientManagerFactoryService } from '../../edv/services/edv.clientFactory';

export async function getAppVault(kmsId, edvId) {
  Logger.log('Inside getAppVault()', 'getAppVault');
  const appMenemonic = await getAppMenemonic(kmsId);
  Logger.log('Inside getAppVault() ...', 'getAppVault');
  const appVaultWallet = await VaultWalletManager.getWallet(appMenemonic);
  const appVault = await EdvClientManagerFactoryService.createEdvClientManger(
    appVaultWallet,
    edvId,
  );
  return appVault;
}

export async function getAppMenemonic(kmsId): Promise<string> {
  Logger.log('Inside getAppMenemonic()', 'getAppVault');
  const { mnemonic } = await global.kmsVault.getDecryptedDocument(kmsId);
  return mnemonic;
}
