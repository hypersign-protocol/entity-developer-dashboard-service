import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { AppOauthController } from './app-oauth.controller';
import { AppAuthModule } from 'src/app-auth/app-auth.module';
import { JWTAuthorizeMiddleware } from 'src/utils/middleware/jwt-authorization.middleware';
import { UserModule } from 'src/user/user.module';
import { JWTAccessAccountMiddleware } from 'src/utils/middleware/jwt-accessAccount.middlerwere';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminPeopleRepository } from 'src/people/repository/people.repository';
import {
  AdminPeople,
  AdminPeopleSchema,
} from 'src/people/schema/people.schema';
import { RateLimitMiddleware } from 'src/utils/middleware/rate-limit.middleware';
@Module({
  imports: [
    AppAuthModule,
    UserModule,
    MongooseModule.forFeature([
      { name: AdminPeople.name, schema: AdminPeopleSchema },
    ]),
  ],
  controllers: [AppOauthController],
  providers: [AdminPeopleRepository],
})
export class AppOauthModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(JWTAuthorizeMiddleware)
      .exclude({ path: 'api/v1/app/oauth', method: RequestMethod.POST })
      .forRoutes(AppOauthController);
    consumer
      .apply(JWTAccessAccountMiddleware)
      .exclude({ path: 'api/v1/app/oauth', method: RequestMethod.POST })
      .forRoutes(AppOauthController);
    consumer
      .apply(RateLimitMiddleware)
      .exclude({
        path: '/api/v1/app/access-control/token',
        method: RequestMethod.GET,
      })
      .forRoutes(AppOauthController);
  }
}
