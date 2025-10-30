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

@Module({
  imports: [
    UserModule,
    PeopleModule,
    MailNotificationModule,
    MongooseModule.forFeature([
      { name: CustomerOnboarding.name, schema: CustomerOnboardingSchema },
    ]),
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
      .apply(JWTAccessAccountMiddleware)
      .forRoutes(CustomerOnboardingController);
    consumer
      .apply(TwoFAAuthorizationMiddleware)
      .forRoutes(CustomerOnboardingController);
    consumer.apply(RateLimitMiddleware).forRoutes(CustomerOnboardingController);
  }
}
