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

@Module({
  imports: [
    UserModule,
    AppAuthModule,
    JwtModule.register({}),
    SupportedServiceModule,
  ],
  controllers: [SocialLoginController],
  providers: [SocialLoginService, GoogleStrategy, SupportedServiceList],
})
export class SocialLoginModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(WhitelistAppCorsMiddleware)
      .exclude({
        path: '/api/v1/login/callback',
        method: RequestMethod.GET,
      })
      .forRoutes(SocialLoginController);
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
      )
      .forRoutes(SocialLoginController);
  }
}
