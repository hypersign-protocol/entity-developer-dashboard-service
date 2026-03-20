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
      READ_DID = 'READ_DID',
      WRITE_DID = 'WRITE_DID',
      WRITE_CREDIT = 'WRITE_CREDIT',
      VERIFY_DID_SIGNATURE = 'VERIFY_DID_SIGNATURE',
      READ_CREDIT = 'READ_CREDIT',
      WRITE_SCHEMA = 'WRITE_SCHEMA',
      READ_SCHEMA = 'READ_SCHEMA',
      CHECK_LIVE_STATUS = 'CHECK_LIVE_STATUS',
      READ_TX = 'READ_TX',
      READ_CREDENTIAL = 'READ_CREDENTIAL',
      VERIFY_CREDENTIAL = 'VERIFY_CREDENTIAL',
      WRITE_CREDENTIAL = 'WRITE_CREDENTIAL',
      READ_USAGE = 'READ_USAGE',
      WRITE_PRESENTATION = 'WRITE_PRESENTATION',
      VERIFY_PRESENTATION = 'VERIFY_PRESENTATION',
      ISSUE_DID_JWT = 'ISSUE_DID_JWT',
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
      WRITE_WEBHOOK_CONFIG = 'WRITE_WEBHOOK_CONFIG',
      READ_WEBHOOK_CONFIG = 'READ_WEBHOOK_CONFIG',
      UPDATE_WEBHOOK_CONFIG = 'UPDATE_WEBHOOK_CONFIG',
      DELETE_WEBHOOK_CONFIG = 'DELETE_WEBHOOK_CONFIG',
      READ_VERIFIED_USER = 'READ_VERIFIED_USER',
      READ_ANALYTICS = 'READ_ANALYTICS',
      READ_USAGE = 'READ_USAGE',
      WRITE_CREDIT = 'WRITE_CREDIT',
      READ_CREDIT = 'READ_CREDIT',
      CHECK_LIVE_STATUS = 'CHECK_LIVE_STATUS',
      WRITE_AUTH = 'WRITE_AUTH',

      //kyb access list
      READ_COMPANY = 'READ_COMPANY',
      WRITE_COMPANY = 'WRITE_COMPANY',
      UPDATE_COMPANY = 'UPDATE_COMPANY',
      DELETE_COMPANY = 'DELETE_COMPANY',
      UPDATE_COMPANY_STATUS = 'UPDATE_COMPANY_STATUS',

      READ_COMPANY_EXECUTIVE = 'READ_COMPANY_EXECUTIVE',
      WRITE_COMPANY_EXECUTIVE = 'WRITE_COMPANY_EXECUTIVE',
      UPDATE_COMPANY_EXECUTIVE = 'UPDATE_COMPANY_EXECUTIVE',
      DELETE_COMPANY_EXECUTIVE = 'DELETE_COMPANY_EXECUTIVE',
      RESEND_COMPANY_EXECUTIVE_MAIL = 'RESEND_COMPANY_EXECUTIVE_MAIL',

      UPLOAD_DOCUMENT = 'UPLOAD_DOCUMENT',
      READ_DOCUMENT = 'READ_DOCUMENT',
      DELETE_DOCUMENT = 'DELETE_DOCUMENT',
      VERIFY_DOCUMENT = 'VERIFY_DOCUMENT',

      WRITE_COMPLIANCE = 'WRITE_COMPLIANCE',
      READ_COMPLIANCE = 'READ_COMPLIANCE',
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

export enum Context {
  idDashboard = 'idDashboard',
  customer = 'customer',
}
