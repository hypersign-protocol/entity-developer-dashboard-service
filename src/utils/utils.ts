import * as fs from 'fs';
import {
  ClassSerializerInterceptor,
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
import { Did } from 'hs-ssi-sdk';
import {
  SERVICE_TYPES,
  SERVICES,
} from 'src/supported-service/services/iServiceList';

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
    if (err) console.log(`Could not delete the file err ${err}`);
    console.log(`${filePath} is successfully deleted.`);
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
  const allowedAccess = [SERVICES[SERVICE_TYPES.CAVACH_API].ACCESS_TYPES.ALL];
  const data = userAccessList
    .filter((eachAccess) => allowedAccess.includes(eachAccess.access))
    .map((eachAccess) => ({
      serviceType: eachAccess.serviceType,
      access: eachAccess.access,
    }));
  return data;
}
