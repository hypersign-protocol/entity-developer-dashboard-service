import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { SocialLoginService } from './services/social-login.service';
import { SocialLoginController } from './controller/social-login.controller';
import { GoogleStrategy } from './strategy/social.strategy';
import { UserModule } from 'src/user/user.module';
import { JwtModule } from '@nestjs/jwt';
import { WhitelistAppCorsMiddleware } from 'src/app-auth/middlewares/cors.middleware';
import { AppAuthModule } from 'src/app-auth/app-auth.module';
import { JWTAuthorizeMiddleware } from 'src/utils/middleware/jwt-authorization.middleware';
import { SupportedServiceModule } from 'src/supported-service/supported-service.module';
import { SupportedServiceList } from 'src/supported-service/services/service-list';
import { TwoFAAuthorizationMiddleware } from 'src/utils/middleware/2FA-jwt-authorization.middleware';
import { RateLimitMiddleware } from 'src/utils/middleware/rate-limit.middleware';
import { EmailOtpLoginController } from './controller/email-otp-login.controller';
import { EmailOtpLoginService } from './services/email-otp-login.service';
import { MailNotificationModule } from 'src/mail-notification/mail-notification.module';

@Module({
  imports: [
    UserModule,
    AppAuthModule,
    JwtModule.register({}),
    SupportedServiceModule,
    MailNotificationModule,
  ],
  controllers: [SocialLoginController, EmailOtpLoginController],
  providers: [
    SocialLoginService,
    GoogleStrategy,
    SupportedServiceList,
    EmailOtpLoginService,
  ],
  exports: [SocialLoginService],
})
export class SocialLoginModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(WhitelistAppCorsMiddleware)
      .exclude({
        path: '/api/v1/login/callback',
        method: RequestMethod.GET,
      })
      .forRoutes(SocialLoginController, EmailOtpLoginController);
    consumer
      .apply(JWTAuthorizeMiddleware)
      .exclude(
        {
          path: '/api/v1/login',
          method: RequestMethod.GET,
        },
        {
          path: '/api/v1/login/callback',
          method: RequestMethod.GET,
        },
        {
          path: '/api/v1/auth/refresh',
          method: RequestMethod.POST,
        },
      )
      .forRoutes(SocialLoginController);
    consumer
      .apply(TwoFAAuthorizationMiddleware)
      .exclude(
        {
          path: '/api/v1/login',
          method: RequestMethod.GET,
        },
        {
          path: '/api/v1/login/callback',
          method: RequestMethod.GET,
        },
        {
          path: '/api/v1/auth/mfa/generate',
          method: RequestMethod.POST,
        },
        {
          path: '/api/v1/auth/mfa/verify',
          method: RequestMethod.POST,
        },
        {
          path: '/api/v1/auth',
          method: RequestMethod.POST,
        }, // either do this or send the user data in auth api with a message 2FA is required
        {
          path: '/api/v1/auth/refresh',
          method: RequestMethod.POST,
        },
      )
      .forRoutes(SocialLoginController);
    consumer
      .apply(RateLimitMiddleware)
      .exclude(
        {
          path: '/api/v1/login',
          method: RequestMethod.GET,
        },
        {
          path: '/api/v1/login/callback',
          method: RequestMethod.GET,
        },
        {
          path: '/api/v1/auth',
          method: RequestMethod.POST,
        },
      )
      .forRoutes(SocialLoginController);
  }
}
