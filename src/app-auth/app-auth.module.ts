import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';

import { AppAuthService } from './services/app-auth.service';
import { AppAuthController } from './controllers/app-auth.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { App, AppSchema } from './schemas/app.schema';

import { AppRepository } from './repositories/app.repository';
import { HidWalletService } from 'src/hid-wallet/services/hid-wallet.service';
import { HidWalletModule } from 'src/hid-wallet/hid-wallet.module';
import { EdvModule } from 'src/edv/edv.module';
import { AppAuthSecretService } from './services/app-auth-passord.service';
import { JwtModule } from '@nestjs/jwt';
import { AppAuthApiKeyService } from './services/app-auth-apikey.service';
import { TrimMiddleware } from 'src/utils/middleware/trim.middleware';
import { SupportedServiceService } from 'src/supported-service/services/supported-service.service';
import { SupportedServiceList } from 'src/supported-service/services/service-list';
import { JWTAuthorizeMiddleware } from 'src/utils/middleware/jwt-authorization.middleware';
import { UserModule } from 'src/user/user.module';
import { TwoFAAuthorizationMiddleware } from 'src/utils/middleware/2FA-jwt-authorization.middleware';
import { CreditModule } from 'src/credits/credits.module';
import { JWTAccessAccountMiddleware } from 'src/utils/middleware/jwt-accessAccount.middlerwere';
import { AdminPeopleRepository } from 'src/people/repository/people.repository';
import {
  AdminPeople,
  AdminPeopleSchema,
} from 'src/people/schema/people.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: App.name, schema: AppSchema }]),
    MongooseModule.forFeature([
      { name: AdminPeople.name, schema: AdminPeopleSchema },
    ]),
    HidWalletModule,
    EdvModule,
    UserModule,
    JwtModule.register({}),
    CreditModule,
  ],
  providers: [
    AppAuthService,
    AppRepository,
    HidWalletService,
    AppAuthSecretService,
    AppAuthApiKeyService,
    SupportedServiceList,
    SupportedServiceService,
    AdminPeopleRepository,
  ],
  controllers: [AppAuthController],

  exports: [AppAuthService, AppRepository, AppAuthApiKeyService, AppAuthModule],
})
export class AppAuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(TrimMiddleware)
      .exclude(
        { path: 'app', method: RequestMethod.GET },
        { path: 'app', method: RequestMethod.DELETE },
        { path: 'app/:appId', method: RequestMethod.GET },
      )
      .forRoutes(AppAuthController);

    consumer
      .apply(JWTAuthorizeMiddleware)
      .exclude({ path: '/api/v1/app/marketplace', method: RequestMethod.GET })
      .forRoutes(AppAuthController);
    consumer
      .apply(JWTAccessAccountMiddleware)
      .exclude({ path: '/api/v1/app/marketplace', method: RequestMethod.GET })
      .forRoutes(AppAuthController);
    consumer
      .apply(TwoFAAuthorizationMiddleware)
      .exclude({ path: '/api/v1/app/marketplace', method: RequestMethod.GET })
      .forRoutes(AppAuthController);
  }
}
