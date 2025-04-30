import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-google-oauth20';
import { sanitizeUrl } from 'src/utils/utils';

export enum Providers {
  google = 'google',
}
@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor() {
    super({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL:
        process.env.GOOGLE_CALLBACK_URL ||
        sanitizeUrl(process.env.DEVELOPER_DASHBOARD_SERVICE_PUBLIC_EP) +
          '/api/v1/login/callback',
      scope: ['email', 'profile'],
      session: false,
    });
  }
  async validate(
    accessToken: string,
    refreshToken: string,
    profile: any,
    done,
  ): Promise<any> {
    Logger.log('entered in google strategy');
    const { displayName, emails, provider, id } = profile;
    const user = {
      email: emails[0].value,
      name: displayName,
      accessToken,
      provider,
      id,
      profileIcon: profile?.photos?.[0]?.value,
    };
    done(null, user);
  }
}
