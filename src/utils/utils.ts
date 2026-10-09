import * as fs from 'fs';
import {
  ClassSerializerInterceptor,
  InternalServerErrorException,
  PlainLiteralObject,
  Type,
} from '@nestjs/common';
import { ClassTransformOptions, plainToClass } from 'class-transformer';
import { Document } from 'mongoose';
import {
  ExceptionFilter,
  Catch,
  HttpException,
  ArgumentsHost,
  HttpStatus,
} from '@nestjs/common';
import {
  Context,
  SERVICE_TYPES,
  SERVICES,
} from 'src/supported-service/services/iServiceList';
import {
  CAVACH_KYC_ACCESS_MATRIX,
  CAVACH_KYB_ACCESS_MATRIX,
  QUEST_ACCESS_MATRIX,
  SSI_ACCESS_MATRIX,
  TokenModule,
} from 'src/config/access-matrix';
import { createHash } from 'crypto';
import { IsMongoId } from 'class-validator';
import type { CreditCatalog } from '@hypersign-protocol/credit-middleware';
export const existDir = (dirPath) => {
  if (!dirPath) throw new Error('Directory path undefined');
  return fs.existsSync(dirPath);
};

export const createDir = (dirPath) => {
  if (!dirPath) throw new Error('Directory path undefined');
  return fs.mkdirSync(dirPath, {
    recursive: true,
  });
};
export const store = (data, filePath) => {
  if (!data) throw new Error('Data undefined');
  fs.writeFileSync(filePath, JSON.stringify(data));
};

export const retrive = (filePath) => {
  return fs.readFileSync(filePath, 'utf8');
};

export const deleteFile = (filePath) => {
  return fs.unlink(filePath, (err) => {
    if (err) console.error(`Could not delete file: ${filePath}`, err);
    console.info(`Deleted file: ${filePath}`);
  });
};
export function MongooseClassSerializerInterceptor(
  classToIntercept: Type,
  options: ClassTransformOptions,
): typeof ClassSerializerInterceptor {
  return class Interceptor extends ClassSerializerInterceptor {
    private changePlainObjectToClass(document: PlainLiteralObject) {
      if (!(document instanceof Document)) {
        return document;
      }
      return plainToClass(classToIntercept, document.toJSON(), options);
    }
    private prepareResponse(
      response: PlainLiteralObject | PlainLiteralObject[],
    ) {
      if (Array.isArray(response)) {
        return response.map(this.changePlainObjectToClass);
      }
      return this.changePlainObjectToClass(response);
    }
    serialize(
      response: PlainLiteralObject | PlainLiteralObject[],
      options: ClassTransformOptions,
    ) {
      return super.serialize(this.prepareResponse(response), options);
    }
  };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    let status;
    let message;
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      message = exception.getResponse();
    } else {
      const msg = [];
      const error: Error = exception as Error;
      if (error.name) {
        msg.push(error.name);
      }
      if (error.message) {
        msg.push(error.message);
      }

      status = HttpStatus.INTERNAL_SERVER_ERROR;

      msg.push('Internal server error');

      message = {
        statusCode: status,
        timestamp: new Date().toISOString(),
        path: request.url,
        message: msg,
      };
    }

    response.status(status).json(message);
  }
}

export function sanitizeUrl(url, shouldEndWithSlash = false) {
  if (!url) {
    throw new Error('Please pass a valid url');
  }

  const isUrlEndsWithSlash = url.substr(url.length - 1) === '/';

  if (shouldEndWithSlash) {
    if (!isUrlEndsWithSlash) {
      return url + '/';
    }
  } else {
    if (isUrlEndsWithSlash) {
      return url.substr(0, url.length - 1);
    }
  }
  return url;
}

export function mapUserAccessList(userAccessList) {
  if (userAccessList?.length == 0) {
    return [];
  }
  // const allowedAccess = [SERVICES[SERVICE_TYPES.CAVACH_API].ACCESS_TYPES.ALL];
  // const data = userAccessList
  //   .filter((eachAccess) => allowedAccess.includes(eachAccess.access))
  //   .map((eachAccess) => ({
  //     serviceType: eachAccess.serviceType,
  //     access: eachAccess.access,
  //   }));
  //return data;

  return [
    {
      serviceType: SERVICE_TYPES.CAVACH_API,
      access: SERVICES[SERVICE_TYPES.CAVACH_API].ACCESS_TYPES.ALL,
    },
    {
      serviceType: SERVICE_TYPES.SSI_API,
      access: SERVICES[SERVICE_TYPES.SSI_API].ACCESS_TYPES.ALL,
    },
  ];
}

export function getCookieOptions(
  maxAge?: number,
  isClear = false,
  httpOnly = true,
) {
  const cookieDomain = process.env.COOKIE_DOMAIN;
  const isProd = process.env.NODE_ENV || 'production';
  return {
    httpOnly: isProd === 'production' ? httpOnly : false,
    secure: isProd === 'production' ? true : false,
    sameSite: isProd === 'production' ? 'None' : 'Lax',
    domain: isProd === 'production' ? cookieDomain : undefined,
    path: '/',
    ...(isClear ? {} : { maxAge }),
  };
}

export const REDIS_KEYS = {
  SESSION: 'session:',
  REFRESH_TOKEN: 'refreshToken:',
  VERIFIER_PAGE_TOKEN: 'verifierPageToken:',
};
export function getAccessListForModule(
  module: TokenModule,
  serviceType: SERVICE_TYPES,
  grantType?: string,
) {
  switch (serviceType) {
    case SERVICE_TYPES.CAVACH_API:
      return grantType === 'access_service_kyb'
        ? CAVACH_KYB_ACCESS_MATRIX[module] || []
        : CAVACH_KYC_ACCESS_MATRIX[module] || [];
    case SERVICE_TYPES.SSI_API:
      return SSI_ACCESS_MATRIX[module] || [];
    case SERVICE_TYPES.QUEST:
      return QUEST_ACCESS_MATRIX[module] || [];
  }
}
export const evaluateAccessPolicy = (
  defaultAccessList: string[],
  serviceType: SERVICE_TYPES,
  userAccessList?: {
    serviceType: SERVICE_TYPES;
    access: string;
    expiryDate?: Date;
  }[],
  context?: string,
): string[] => {
  if (!context) {
    return defaultAccessList;
  }
  if (context === Context.idDashboard) {
    // No user access info → Return NO access
    if (!userAccessList?.length) {
      return [];
    }
    const userServiceAccess = userAccessList
      .filter((a) => a.serviceType === serviceType)
      .map((a) => a.access);

    // User With ALL access
    if (userServiceAccess.includes('ALL')) {
      return defaultAccessList;
    }
    // Intersection rule
    return defaultAccessList.filter((p) => userServiceAccess.includes(p));
  }
  return defaultAccessList;
};

export function generateHash(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export const DNS_RESOLVER_URL = 'https://dns.google/resolve';
export class VerifierParamsDto {
  @IsMongoId({ message: 'Invalid verifier id' })
  id: string;
}

export const ONBOARDING_CONFIG = {
  TOTAL_VERIFICATION: 50,
  EXPIRY: 15, // in days
  AADHAAR_VERIFICATION_ROUTES: [
    '/api/v1/aadhaar/otp/verify',
    '/api/v1/aadhaar/otp/generate',
    '/api/v1/aadhaar/face/match',
  ],
  KYC_VERIFICATION_ROUTES: [
    '/api/v1/e-kyc/verification/session',
    '/api/v1/e-kyc/verification/user-consent',
    '/api/v1/e-kyc/verification/passive-liveliness',
    '/api/v2/documents/extract',
    '/api/v2/biometrics/verify',
    '/api/v1/e-kyc/verification/auth',
  ],
  SSI_CREDENTIAL_ISSUE_ROUTES: ['/api/v1/credential/issue'],
  SSI_DID_ROUTES: ['/api/v1/did/create', '/api/v1/did/register/v2'],
};

export function sumCatalogCreditCost(
  catalog: CreditCatalog,
  method: string,
  routePaths: string[],
  creditType: string,
): number {
  return routePaths.reduce((total, routePath) => {
    const route = catalog.routes.find(
      (catalogRoute) =>
        catalogRoute.method.toUpperCase() === method.toUpperCase() &&
        catalogRoute.path === routePath,
    );
    if (!route) {
      throw new InternalServerErrorException(
        `Credit catalog ${catalog.serviceType}@${
          catalog.version
        } is missing ${method.toUpperCase()} ${routePath}`,
      );
    }

    const routeCharges = route.charges.filter(
      (charge) => charge.creditType === creditType,
    );
    if (routeCharges.length === 0) return total;

    const routeCost = routeCharges.reduce(
      (amount, charge) => amount + charge.amount,
      0,
    );
    if (!Number.isSafeInteger(routeCost) || routeCost < 0) {
      throw new InternalServerErrorException(
        `Credit catalog ${catalog.serviceType}@${
          catalog.version
        } has an invalid ${creditType} amount for ${method.toUpperCase()} ${routePath}`,
      );
    }
    return total + routeCost;
  }, 0);
}
