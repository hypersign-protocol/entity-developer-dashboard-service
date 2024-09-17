import { HypersignEdvClientEd25519VerificationKey2020 } from 'hypersign-edv-client';
import {
  IResponse,
  IEncryptionRecipents,
} from 'hypersign-edv-client/build/Types';
import { VaultWallet } from './vaultWalletManager';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type EDVDocType = {
  document: object;
  documentId?: string;
  sequence?: number;
  metadata?: object;
  edvId: string;
  recipients?: Array<IEncryptionRecipents>;
  indexs?: Array<{ index: string; unique: boolean }>;
};

export interface IEdvClientManager {
  didDocument: object;
  edvId?: string;
  initate(): Promise<IEdvClientManager>;
  insertDocument(doc: EDVDocType): any;
  updateDocument(): any;
  deleteDocument(id: string): any;
  deleteVault(id: string): any;
  getDecryptedDocument(id: string): Promise<any>;
  getDocument(id: string): Promise<IResponse>;
  prepareEdvDocument(
    content: object,
    indexes: Array<{ index: string; unique: boolean }>,
    recipients?: Array<IEncryptionRecipents>,
  ): EDVDocType;
}

export class EdvClientManger implements IEdvClientManager {
  didDocument: any;
  edvId?: string;
  private keyResolver: any;
  private vault: any;
  private recipient: any;
  private vaultWallet: VaultWallet;
  private config: ConfigService;
  constructor(vaultWallet: VaultWallet, edvId?: string) {
    this.vaultWallet = vaultWallet;
    this.edvId = edvId;
    this.didDocument = this.vaultWallet.didDocument;
    this.keyResolver = this.vaultWallet.keyResolver;
    this.config = new ConfigService();
  }

  async initate(): Promise<IEdvClientManager> {
    const ed25519 = this.vaultWallet.ed25519Signer;
    const x25519 = this.vaultWallet.ed25519Signer;
    const keyAgreementKey = this.vaultWallet.keyAgreementKey;

    this.recipient = [
      {
        ...keyAgreementKey,
        publicKeyMultibase: x25519.publicKeyMultibase,
      },
    ];

    const EDV_BASE_URL = this.config.get('EDV_BASE_URL');
    this.vault = new HypersignEdvClientEd25519VerificationKey2020({
      keyResolver: this.keyResolver,
      url: EDV_BASE_URL,
      ed25519VerificationKey2020: ed25519,
      x25519KeyAgreementKey2020: x25519,
    });

    const config = {
      url: EDV_BASE_URL,
      keyAgreementKey,
      controller: this.vaultWallet.authenticationKey.id,
      edvId: this.edvId
        ? this.edvId
        : 'urn:uuid:6e8bc430-9c3a-11d9-9669-0800200c9a66',
    };

    const res = await this.vault.registerEdv(config);
    return this;
  }

  prepareEdvDocument(
    content: object,
    indexes: Array<{ index: string; unique: boolean }>,
    recipients?: Array<IEncryptionRecipents>,
  ): EDVDocType {
    const document: any = {
      document: { content },
      edvId: this.edvId,
      indexs: indexes,
      recipients: recipients ? recipients : this.recipient,
    };
    return document;
  }

  async insertDocument(doc: EDVDocType): Promise<{ id: string }> {
    if (!doc['recipients']) {
      doc['recipients'] = [];
    }

    if (doc['recipients'] && doc['recipients'].length == 0) {
      doc['recipients'] = this.recipient;
    }
    const resp: IResponse = await this.vault.insertDoc({ ...doc });
    return {
      id: resp.document.id,
    };
  }

  updateDocument(): any {
    throw new Error('not implemented');
  }
  async deleteDocument(id: string) {
    Logger.log(
      'deleteDocument() method: starts, deleting docs from edvClient',
      'EdvService',
    );
    const resp: IResponse = await this.vault.deleteDoc({
      edvId: this.edvId,
      documentId: id,
    });
    return resp;
  }

  async deleteVault(edvId: string) {
    Logger.log(
      'deletVault() method: starts, deleting entire vault',
      'EdvService',
    );
    const resp = await this.vault.deleteVaultData({ edvId: edvId });
    return resp;
  }
  async getDocument(id: string): Promise<IResponse> {
    Logger.log(
      'getDocument() method: starts, fetching docs from edvClient',
      'EdvService',
    );
    const resp: IResponse = await this.vault.fetchDoc({
      edvId: this.edvId,
      documentId: id,
    });
    return resp;
  }

  async getDecryptedDocument(id: string): Promise<any> {
    Logger.log('getDecryptedDocument() method: starts....', 'EdvService');

    Logger.log(
      'getDecryptedDocument() method: fetching doc from edvCLient',
      'EdvService',
    );

    const doc: IResponse = await this.getDocument(id);
    if (!doc.document) {
      throw new Error(doc.message);
    }

    Logger.log(
      'getDecryptedDocument() method: decrypting doc using edvClient',
      'EdvService',
    );

    const { content } = await this.vault.decryptObject({
      keyAgreementKey: this.vaultWallet.x25519Signer,
      jwe: doc.document.jwe,
    });
    Logger.log('getDecryptedDocument() method: ends....', 'EdvService');

    return content;
  }
}
