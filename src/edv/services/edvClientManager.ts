import { HypersignEdvClientEd25519VerificationKey2020 } from 'hypersign-edv-client';
import {
  IResponse,
  IEncryptionRecipents,
} from 'hypersign-edv-client/build/Types';
import { VaultWallet } from './vaultWalletManager';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { dirname } from 'path';

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

const MAX_LOGGED_BODY = 1000;

function stringifyBody(body: unknown): string {
  let text: string;
  try {
    text = typeof body === 'string' ? body : JSON.stringify(body);
  } catch {
    text = String(body);
  }
  return text && text.length > MAX_LOGGED_BODY
    ? text.slice(0, MAX_LOGGED_BODY) + '…(truncated)'
    : text;
}

/**
 * Records the last HTTP reply hypersign-edv-client receives, by hooking the
 * axios copy nested inside that package (not the app's own axios). Best
 * effort: if that axios can't be found, describe() says so.
 */
function captureEdvResponses(): { describe(): string; stop(): void } {
  let last = 'none captured';
  let axios: any;
  try {
    const edvDir = dirname(require.resolve('hypersign-edv-client'));
    axios = require(require.resolve('axios', { paths: [edvDir] }));
    axios = axios?.default ?? axios;
  } catch {
    return {
      describe: () => 'unavailable (could not hook EDV client axios)',
      stop: () => undefined,
    };
  }
  const record = (res: any) =>
    `${res?.config?.method?.toUpperCase()} ${res?.config?.url} -> ` +
    `${res?.status} ${res?.statusText ?? ''} body=${stringifyBody(res?.data)}`;
  const id = axios.interceptors.response.use(
    (res: any) => {
      last = record(res);
      return res;
    },
    (err: any) => {
      last = err?.response
        ? record(err.response)
        : `${err?.config?.method?.toUpperCase()} ${err?.config?.url} -> ` +
          `no response (${err?.code ?? ''} ${err?.message})`;
      return Promise.reject(err);
    },
  );
  return {
    describe: () => last,
    stop: () => axios.interceptors.response.eject(id),
  };
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
    Logger.log('Inside initate() to initiate edv client', 'EdvClientManager');
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

    // registerEdv() hides the EDV server's reply: on an error response it
    // fails with "Cannot read properties of undefined (reading 'id')". Record
    // the raw reply so a startup failure logs what the server actually said.
    const capture = captureEdvResponses();
    try {
      await this.vault.registerEdv(config);
    } catch (e: any) {
      Logger.error(
        `EDV vault registration failed: ${e?.message}. ` +
          `EDV_BASE_URL=${EDV_BASE_URL} edvId=${config.edvId} ` +
          `controller=${config.controller} ` +
          `edvResponse=${capture.describe()}`,
        'EdvClientManager',
      );
      throw e;
    } finally {
      capture.stop();
    }
    return this;
  }

  prepareEdvDocument(
    content: object,
    indexes: Array<{ index: string; unique: boolean }>,
    recipients?: Array<IEncryptionRecipents>,
  ): EDVDocType {
    Logger.log(
      'Inside prepareEdvDocument to prepare document before inserting in edv',
      'EdvClientManager',
    );
    const document: any = {
      document: { content },
      edvId: this.edvId,
      indexs: indexes,
      recipients: recipients ? recipients : this.recipient,
    };
    Logger.debug(document, 'EdvClientManager');
    return document;
  }

  async insertDocument(doc: EDVDocType): Promise<{ id: string }> {
    Logger.log(
      'Inside insertDocument to insert document in edv',
      'EdvClientManager',
    );
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
