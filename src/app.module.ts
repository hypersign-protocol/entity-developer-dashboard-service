import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { AppAuthModule } from './app-auth/app-auth.module';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { EdvModule } from './edv/edv.module';
import { AllExceptionsFilter } from './utils/utils';
import { APP_FILTER } from '@nestjs/core';

import { AppAuthSecretService } from './app-auth/services/app-auth-passord.service';
import { AppOauthModule } from './app-oauth/app-oauth.module';
import { UserModule } from './user/user.module';
import { SupportedServiceModule } from './supported-service/supported-service.module';
import { SocialLoginModule } from './social-login/social-login.module';
import { HypersignauthLoginModule } from './hypersignauth-login/hypersignauth-login.module';
import { CreditModule } from './credits/credits.module';
import { TeamModule } from './roles/role.module';
import { PeopleModule } from './people/people.module';
import { MailNotificationModule } from './mail-notification/mail-notification.module';
import { AllowedOriginMiddleware } from './utils/middleware/allowedOrigin.middleware';
import { IpResolverModule } from './ip-resolver/ip-resolver.module';
import { WebpageConfigModule } from './webpage-config/webpage-config.module';

@Module({
  imports: [
    AppAuthModule,
    CreditModule,
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    MongooseModule.forRoot(process.env.DATABASE_CONNECTION_PATH),
    EdvModule,
    AppOauthModule,
    UserModule,
    SupportedServiceModule,
    SocialLoginModule,
    HypersignauthLoginModule,
    TeamModule,
    PeopleModule,
    MailNotificationModule,
    IpResolverModule,
    WebpageConfigModule,
  ],
  controllers: [],
  providers: [
    AppAuthSecretService,
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AllowedOriginMiddleware)
      .exclude(
        {
          path: '/api/v1/login/callback',
          method: RequestMethod.GET,
        },
        { path: '/api/v1/app/oauth', method: RequestMethod.POST },
        { path: '/api/v1/ip-resolver', method: RequestMethod.POST },
        { path: '/api/v1/ip-resolver/stats', method: RequestMethod.POST },
      )
      .forRoutes('*');
  }
}
