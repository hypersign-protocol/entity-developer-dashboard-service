import {
  forwardRef,
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CreditPlan, CreditsSchema } from './schemas/credit.schema';
import { CreditService } from './services/credits.service';
import { CreditsController } from './controllers/credits.controller';
import { JWTAuthorizeMiddleware } from 'src/utils/middleware/jwt-authorization.middleware';
import { UserModule } from 'src/user/user.module';
import { JWTAccessAccountMiddleware } from 'src/utils/middleware/jwt-accessAccount.middlerwere';
import { AdminPeopleRepository } from 'src/people/repository/people.repository';
import {
  AdminPeople,
  AdminPeopleSchema,
} from 'src/people/schema/people.schema';
import { JwtModule } from '@nestjs/jwt';
import { HidWalletModule } from 'src/hid-wallet/hid-wallet.module';
import { AppAuthModule } from 'src/app-auth/app-auth.module';
import { RateLimitMiddleware } from 'src/utils/middleware/rate-limit.middleware';
import { SuperAdminMiddleware } from 'src/utils/middleware/super-admin.middleware';
import { CreditRepository } from './repositories/credit.repository';

@Module({
  imports: [
    UserModule,
    MongooseModule.forFeature([
      { name: CreditPlan.name, schema: CreditsSchema },
    ]),
    MongooseModule.forFeature([
      { name: AdminPeople.name, schema: AdminPeopleSchema },
    ]),
    JwtModule.register({}),
    HidWalletModule,
    forwardRef(() => AppAuthModule),
    HidWalletModule,
  ],
  controllers: [CreditsController],
  providers: [AdminPeopleRepository, CreditRepository, CreditService],
  exports: [CreditService],
})
export class CreditModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(JWTAuthorizeMiddleware)
      .exclude({ path: 'api/v1/app/:appId/credits', method: RequestMethod.GET })
      .forRoutes(CreditsController);
    consumer
      .apply(JWTAccessAccountMiddleware)
      .exclude({ path: 'api/v1/app/:appId/credits', method: RequestMethod.GET })
      .forRoutes(CreditsController);
    consumer
      .apply(SuperAdminMiddleware)
      .exclude(
        { path: 'api/v1/app/:appId/credits', method: RequestMethod.GET },
        {
          path: 'api/v1/app/:appId/credits/:creditId/activate',
          method: RequestMethod.POST,
        },
      )
      .forRoutes(CreditsController);
    consumer.apply(RateLimitMiddleware).forRoutes(CreditsController);
  }
}
