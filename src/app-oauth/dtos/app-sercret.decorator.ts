import {
  BadRequestException,
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';

export const AppSecretHeader = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    if (
      !request.headers['x-api-secret-key'] ||
      request.headers['x-api-secret-key'] == undefined
    ) {
      throw new UnauthorizedException(['x-api-secret-key header is missing']);
    }
    return request.headers['x-api-secret-key'];
  },
);

export const OauthTokenExpiryHeader = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const rawExpiresIn = request.headers['expiresin'];
    if (!rawExpiresIn) {
      return 4;
    }
    const expiresIn = parseInt(rawExpiresIn, 10);
    if (
      isNaN(expiresIn) ||
      expiresIn < 1 ||
      expiresIn.toString() !== rawExpiresIn.trim()
    ) {
      throw new BadRequestException([
        '`expiresIn` must be a whole number greater than or equal to 1.',
      ]);
    }

    return expiresIn;
  },
);

export const AppSubdomainHeader = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    if (
      !request.headers['x-subdomain'] ||
      request.headers['x-subdomain'] == undefined
    ) {
      throw new UnauthorizedException(['x-subdomain header is missing']);
    }
    return request.headers['x-subdomain'];
  },
);
