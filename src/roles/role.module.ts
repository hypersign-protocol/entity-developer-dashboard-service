import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { RoleService } from './role.service';
import { TeamController } from './controllers/role.controller';
import { JWTAuthorizeMiddleware } from 'src/utils/middleware/jwt-authorization.middleware';
import { UserModule } from 'src/user/user.module';
import { UserRepository } from 'src/user/repository/user.repository';
import { MongooseModule } from '@nestjs/mongoose';
import { Role, RoleSchema } from './schemas/role.schema';
import { User, UserSchema } from 'src/user/schema/user.schema';
import { RoleRepository } from './repository/role.repository';
import { RateLimitMiddleware } from 'src/utils/middleware/rate-limit.middleware';
import {
  CustomerOnboarding,
  CustomerOnboardingSchema,
} from 'src/customer-onboarding/schemas/customer-onboarding.schema';
import { CustomerOnboardingRepository } from 'src/customer-onboarding/repositories/customer-onboarding.repositories';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Role.name, schema: RoleSchema }]),
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    MongooseModule.forFeature([
      { name: CustomerOnboarding.name, schema: CustomerOnboardingSchema },
    ]),

    UserModule,
  ],
  controllers: [TeamController],
  providers: [
    RoleService,
    UserRepository,
    RoleRepository,
    CustomerOnboardingRepository,
  ],
  exports: [RoleRepository],
})
export class TeamModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(JWTAuthorizeMiddleware).forRoutes(TeamController);
    consumer.apply(RateLimitMiddleware).forRoutes(TeamController);
  }
}
