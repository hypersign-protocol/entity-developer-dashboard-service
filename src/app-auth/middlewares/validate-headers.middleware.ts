import {
  Injectable,
  NestMiddleware,
  BadRequestException,
} from '@nestjs/common';

@Injectable()
export class ValidateHeadersMiddleware implements NestMiddleware {
  async use(req: any, res: any, next: () => void) {
    const userId = req.headers.userid;
    if (!userId) {
      throw new BadRequestException(['The userId header is required.']);
    }
    req.userId = userId;
    next();
  }
}
