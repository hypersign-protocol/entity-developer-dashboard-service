export enum SERVICE_TYPES {
  SSI_API = 'SSI_API',
  CAVACH_API = 'CAVACH_API',
  DASHBOARD = 'DASHBOARD',
  QUEST = 'QUEST',
}

export enum APP_ENVIRONMENT {
  prod = 'prod',
  dev = 'dev',
}

export const SSI_API_SERVICE_INFO = Object.freeze({
  type: SERVICE_TYPES.SSI_API,
  description: 'A SSI API service built on multi tenant architeacture',
  name: 'SSI API Service',
  swaggerAPIDocPath: '/',
  baseDomain: 'https://api.entity.hypersign.id',
});

export const CAVACH_API_SERVICE_INFO = Object.freeze({
  type: SERVICE_TYPES.CAVACH_API,
  description: 'A generic service interface for kyc verification',
  name: 'KYC API Service',
  swaggerAPIDocPath: '/api',
  baseDomain: 'https://api.cavach.hypersign.id',
});

export const DASHBOARD_INFO = Object.freeze({
  type: SERVICE_TYPES.DASHBOARD,
  description: 'Entity Dashboard Service',
  name: 'Dashboard',
  swaggerAPIDocPath: '/api',
  baseDomain: 'https://api.entity.dashoboard.hypersign.id',
});
export const QUEST_SERVICE_INFO = Object.freeze({
  type: SERVICE_TYPES.QUEST,
  description: 'Verify on-chain and off-chain tasks of your users',
  name: 'Quest API Service',
  swaggerAPIDocPath: '/api',
  baseDomain: 'https://api.eiko.zone',
});

export const SERVICE_INFO = Object.freeze({
  SSI_API: SSI_API_SERVICE_INFO,
  CAVACH_API: CAVACH_API_SERVICE_INFO,
  DASHBOARD: DASHBOARD_INFO,
  QUEST: QUEST_SERVICE_INFO,
});

// eslint-disable-next-line
export namespace SERVICES {
  // eslint-disable-next-line
  export namespace SSI_API {
    export enum ACCESS_TYPES {
      ALL = 'ALL',
      'CREATE_DID' = 'CREATE_DID',
      'REGISTER_DID' = 'REGISTER_DID',
      'RESOLVE_DID' = 'RESOLVE_DID',
      'ISSUE_CREDENTIAL' = 'ISSUE_CREDENTIAL',
      'VERIFY_CREDENTIAL' = 'VERIFY_CREDENTIAL',
      'REGISTER_CREDENTIAL_STATUS' = 'REGISTER_CREDENTIAL_STATUS',
      'RESOLVE_CREDENTIAL_STATUS' = 'RESOLVE_CREDENTIAL_STATUS',
      'RESOLVE_SCHEMA' = 'RESOLVE_SCHEMA',
      'REGISTER_SCHEMA' = 'REGISTER_SCHEMA',
    }
  }

  // eslint-disable-next-line
  export namespace CAVACH_API {
    export enum ACCESS_TYPES {
      ALL = 'ALL',
      READ_USER_CONSENT = 'READ_USER_CONSENT',
      WRITE_USER_CONSENT = 'WRITE_USER_CONSENT',
      READ_SESSION = 'READ_SESSION',
      WRITE_SESSION = 'WRITE_SESSION',
      WRITE_PASSIVE_LIVELINESS = 'WRITE_PASSIVE_LIVELINESS',
      WRITE_DOC_OCR = 'WRITE_DOC_OCR',
      READ_WIDGET_CONFIG = 'READ_WIDGET_CONFIG',
      WRITE_WIDGET_CONFIG = 'WRITE_WIDGET_CONFIG',
      UPDATE_WIDGET_CONFIG = 'UPDATE_WIDGET_CONFIG',
    }
  }

  // eslint-disable-next-line
  export namespace DASHBOARD {
    export enum ACCESS_TYPES {
      ALL = 'ALL',
      READ_SERVICE = 'READ_SERVICE',
      WRITE_SERVICE = 'WRITE_SERVICE',
      UPDATE_SERVICE = 'UPDATE_SERVICE',
    }
  }
  // eslint-disable-next-line
  export namespace QUEST {
    export enum ACCESS_TYPES {
      ALL = 'ALL',
      VERIFY_USER = 'VERIFY_USER',
    }
  }
}
