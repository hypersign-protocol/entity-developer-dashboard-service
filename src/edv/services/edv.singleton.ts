import { IEdvClientManager } from './edvClientManager';
import { EdvClientManagerFactoryService } from './edv.clientFactory';
import { VaultWallet } from './vaultWalletManager';
import { Logger } from '@nestjs/common';

export class EdvClientKeysManager {
  static edvClientKeysManager: EdvClientKeysManager;
  constructor() {
    if (EdvClientKeysManager.edvClientKeysManager) {
      return EdvClientKeysManager.edvClientKeysManager;
    }
    EdvClientKeysManager.edvClientKeysManager = this;
  }

  async createVault(
    vaultwallet: VaultWallet,
    edvId?: string,
  ): Promise<IEdvClientManager> {
    Logger.log('Inside createVault(): to create vault', 'EdvClientKeysManager');
    return EdvClientManagerFactoryService.createEdvClientManger(
      vaultwallet,
      edvId,
    );
  }
}
