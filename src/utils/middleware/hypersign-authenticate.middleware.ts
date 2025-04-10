import {
  Injectable,
  Logger,
  NestMiddleware,
  UnauthorizedException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { NextFunction, Request, Response } from 'express';
import { UserRepository } from 'src/user/repository/user.repository';
import { User } from 'src/user/schema/user.schema';
@Injectable()
export class HypersignAuthenticateMiddleware implements NestMiddleware {
  constructor(readonly userRepository: UserRepository) {}
  async use(req: Request, res: Response, next: NextFunction) {
    Logger.log(
      'Inside HypersignAuthenticateMiddleware; before calling hs auth authenticate()',
      'HypersignAuthenticateMiddleware',
    );
    const { vp } = req.body;
    const vpObj = JSON.parse(vp);
    const subject = vpObj['verifiableCredential'][0]['credentialSubject'];
    const { email } = subject;
    if (!email) {
      throw new UnauthorizedException('Email no found, invalid presentation');
    }
    const userIndb: User = await this.userRepository.findOne({ email: email });
    let userId;
    if (!userIndb) {
      userId = `${Date.now()}-${uuidv4()}`; // can't generate userId here fetch userId based on email and use that userID
    } else {
      userId = userIndb.userId;
    }

    return globalThis.hypersignAuth.authenticate(req, res, next, userId);
  }
}
