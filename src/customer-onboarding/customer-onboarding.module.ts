import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { CustomerOnboardingService } from './services/customer-onboarding.service';
import { CustomerOnboardingController } from './controllers/customer-onboarding.controller';
import { CustomerOnboardingRepository } from './repositories/customer-onboarding.repositories';
import {
  CustomerOnboarding,
  CustomerOnboardingSchema,
} from './schemas/customer-onboarding.schema';
import { MongooseModule } from '@nestjs/mongoose';
import { TrimMiddleware } from 'src/utils/middleware/trim.middleware';
import { JWTAuthorizeMiddleware } from 'src/utils/middleware/jwt-authorization.middleware';
import { RateLimitMiddleware } from 'src/utils/middleware/rate-limit.middleware';
import { JWTAccessAccountMiddleware } from 'src/utils/middleware/jwt-accessAccount.middlerwere';
import { TwoFAAuthorizationMiddleware } from 'src/utils/middleware/2FA-jwt-authorization.middleware';
import { UserModule } from 'src/user/user.module';
import { PeopleModule } from 'src/people/people.module';
import { MailNotificationModule } from 'src/mail-notification/mail-notification.module';
import { SuperAdminMiddleware } from 'src/utils/middleware/super-admin.middleware';
import { AppAuthModule } from 'src/app-auth/app-auth.module';
import { JwtModule } from '@nestjs/jwt';
import { TeamModule } from 'src/roles/role.module';
import { WebpageConfigModule } from 'src/webpage-config/webpage-config.module';

@Module({
  imports: [
    UserModule,
    PeopleModule,
    MailNotificationModule,
    JwtModule.register({}),
    MongooseModule.forFeature([
      { name: CustomerOnboarding.name, schema: CustomerOnboardingSchema },
    ]),
    AppAuthModule,
    TeamModule,
    WebpageConfigModule,
  ],
  controllers: [CustomerOnboardingController],
  providers: [CustomerOnboardingService, CustomerOnboardingRepository],
  exports: [CustomerOnboardingService, CustomerOnboardingRepository],
})
export class CustomerOnboardingModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TrimMiddleware).forRoutes(CustomerOnboardingController);
    consumer
      .apply(JWTAuthorizeMiddleware)
      .forRoutes(CustomerOnboardingController);
    consumer
      .apply(SuperAdminMiddleware)
      .exclude(
        { path: 'api/v1/customer-onboarding/:id', method: RequestMethod.GET },
        { path: 'api/v1/customer-onboarding', method: RequestMethod.POST },
        { path: 'api/v1/customer-onboarding', method: RequestMethod.GET },
      )
      .forRoutes(CustomerOnboardingController);
    consumer
      .apply(JWTAccessAccountMiddleware)
      .forRoutes(CustomerOnboardingController);
    consumer
      .apply(TwoFAAuthorizationMiddleware)
      .forRoutes(CustomerOnboardingController);
    consumer.apply(RateLimitMiddleware).forRoutes(CustomerOnboardingController);
  }
}
