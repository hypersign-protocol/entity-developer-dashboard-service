import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { WebpageConfigService } from './services/webpage-config.service';
import { WebpageConfigController } from './controller/webpage-config.controller';
import { AppAuthModule } from 'src/app-auth/app-auth.module';
import {
  WebPageConfig,
  WebPageConfigSchema,
} from './schema/webpage-config.schema';
import { MongooseModule } from '@nestjs/mongoose';
import { WebPageConfigRepository } from './repositories/webpage-config.repository';
import { RateLimitMiddleware } from 'src/utils/middleware/rate-limit.middleware';
import { TrimMiddleware } from 'src/utils/middleware/trim.middleware';
import { JWTAuthorizeMiddleware } from 'src/utils/middleware/jwt-authorization.middleware';
import { JWTAccessAccountMiddleware } from 'src/utils/middleware/jwt-accessAccount.middlerwere';
import { TwoFAAuthorizationMiddleware } from 'src/utils/middleware/2FA-jwt-authorization.middleware';
import { UserModule } from 'src/user/user.module';
import { JwtModule } from '@nestjs/jwt';
import { AdminPeopleRepository } from 'src/people/repository/people.repository';
import {
  AdminPeople,
  AdminPeopleSchema,
} from 'src/people/schema/people.schema';

@Module({
  imports: [
    AppAuthModule,
    UserModule,
    MongooseModule.forFeature([
      { name: WebPageConfig.name, schema: WebPageConfigSchema },
    ]),
    MongooseModule.forFeature([
      { name: AdminPeople.name, schema: AdminPeopleSchema },
    ]),
  ],
  controllers: [WebpageConfigController],
  providers: [
    WebpageConfigService,
    WebPageConfigRepository,
    AdminPeopleRepository,
  ],
})
export class WebpageConfigModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TrimMiddleware).forRoutes(WebpageConfigController);

    consumer.apply(JWTAuthorizeMiddleware).forRoutes(WebpageConfigController);
    consumer
      .apply(JWTAccessAccountMiddleware)
      .forRoutes(WebpageConfigController);
    consumer
      .apply(TwoFAAuthorizationMiddleware)
      .forRoutes(WebpageConfigController);
    consumer.apply(RateLimitMiddleware).forRoutes(WebpageConfigController);
  }
}
