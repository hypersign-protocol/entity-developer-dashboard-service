import { Injectable, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';
@Injectable()
export class AppAuthSecretService {
  async hashSecrets(secret: string): Promise<string> {
    Logger.log('hashSecrets() method: starts....', 'AppAuthSecretService');

    const hashdSecret = await argon2.hash(secret);
    return hashdSecret;
  }

  async comapareSecret(secret: string, hash: string): Promise<boolean> {
    Logger.log('comapareSecret() method: starts....', 'AppAuthSecretService');
    if (!secret || !hash) {
      throw new Error('Secret or hash is missing');
    }
    const isValid = await argon2.verify(hash, secret);
    Logger.debug(
      `compareSecret() method: isValid: ${isValid}`,
      'AppAuthSecretService',
    );
    return isValid;
  }
}
