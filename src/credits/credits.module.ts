import {
  forwardRef,
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthZCredits, AuthZCreditsSchema } from './schemas/authz.schema';
import { AuthZCreditsRepository } from './repositories/authz.repository';
import { AuthzCreditService } from './services/credits.service';
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

@Module({
  imports: [
    UserModule,
    MongooseModule.forFeature([
      { name: AuthZCredits.name, schema: AuthZCreditsSchema },
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
  providers: [
    AuthZCreditsRepository,
    AdminPeopleRepository,
    AuthzCreditService,
  ],

  exports: [AuthZCreditsRepository, AuthzCreditService],
})
export class CreditModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(JWTAuthorizeMiddleware)
      .exclude({
        path: '/api/v1/credits/authz/:appId',
        method: RequestMethod.GET,
      })
      .forRoutes(CreditsController);
    consumer.apply(JWTAccessAccountMiddleware).forRoutes(CreditsController);
  }
}
