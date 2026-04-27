import { HttpException, HttpStatus } from '@nestjs/common';

export class AppNotFoundException extends HttpException {
  constructor(/*status?: number, options?: HttpExceptionOptions, response?: string | Record<string, any>*/) {
    super(
      {
        message: ['Application not found.'],
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}
