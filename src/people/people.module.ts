import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { PeopleService } from './services/people.service';
import { PeopleController } from './controller/people.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminPeople, AdminPeopleSchema } from './schema/people.schema';
import { JWTAuthorizeMiddleware } from 'src/utils/middleware/jwt-authorization.middleware';
import { UserModule } from 'src/user/user.module';
import { UserService } from 'src/user/services/user.service';
import { AdminPeopleRepository } from './repository/people.repository';
import { RoleRepository } from 'src/roles/repository/role.repository';
import { Role, RoleSchema } from 'src/roles/schemas/role.schema';
import { SocialLoginModule } from 'src/social-login/social-login.module';
import { JwtModule } from '@nestjs/jwt';
import { MailNotificationModule } from 'src/mail-notification/mail-notification.module';
import { RateLimitMiddleware } from 'src/utils/middleware/rate-limit.middleware';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AdminPeople.name, schema: AdminPeopleSchema },
    ]),
    MongooseModule.forFeature([{ name: Role.name, schema: RoleSchema }]),
    SocialLoginModule,
    UserModule,
    JwtModule,
    MailNotificationModule,
  ],
  controllers: [PeopleController],
  providers: [
    PeopleService,
    UserService,
    AdminPeopleRepository,
    RoleRepository,
  ],
  exports: [AdminPeopleRepository],
})
export class PeopleModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(JWTAuthorizeMiddleware).forRoutes(PeopleController);
    consumer.apply(RateLimitMiddleware).forRoutes(PeopleController);
  }
}
