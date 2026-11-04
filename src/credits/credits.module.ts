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
import { CreditBullMqProvider } from './services/credit-bullmq.provider';
import { CreditCommandService } from './services/credit-command.service';
import { CreditEventStore } from './services/credit-event-store.service';
import { CreditLifecycleConsumer } from './services/credit-lifecycle-consumer.service';
import { CreditNotificationService } from './services/credit-notification.service';
import { MailNotificationModule } from 'src/mail-notification/mail-notification.module';
import {
  CreditLedger,
  CreditLedgerSchema,
} from './schemas/credit-ledger.schema';
import { CreditLedgerRepository } from './repositories/credit-ledger.repository';
import { SsiTransactionResultConsumer } from './services/ssi-transaction-result.consumer';
import {
  CreditCommitOutbox,
  CreditCommitOutboxSchema,
} from './schemas/credit-commit-outbox.schema';
import {
  CustomerOnboarding,
  CustomerOnboardingSchema,
} from 'src/customer-onboarding/schemas/customer-onboarding.schema';

const CREDIT_REDIS_URL = Symbol('CREDIT_REDIS_URL');

@Module({
  imports: [
    UserModule,
    MailNotificationModule,
    MongooseModule.forFeature([
      { name: AdminPeople.name, schema: AdminPeopleSchema },
      { name: CreditPlan.name, schema: CreditsSchema },
      { name: CreditLedger.name, schema: CreditLedgerSchema },
      { name: CreditCommitOutbox.name, schema: CreditCommitOutboxSchema },
      { name: CustomerOnboarding.name, schema: CustomerOnboardingSchema },
    ]),
    JwtModule.register({}),
    HidWalletModule,
    forwardRef(() => AppAuthModule),
  ],
  controllers: [CreditsController],
  providers: [
    {
      provide: CREDIT_REDIS_URL,
      useFactory: (): string =>
        process.env.CREDIT_REDIS_URL ||
        process.env.REDIS_URL ||
        `redis://${
          process.env.REDIS_HOST ||
          'redis-stack-service.hypermine-development.svc.cluster.local'
        }:${process.env.REDIS_PORT || '6379'}`,
    },
    {
      provide: CreditBullMqProvider,
      inject: [CREDIT_REDIS_URL],
      useFactory: (redisUrl: string) => {
        const configuredConcurrency = Number(
          process.env.CREDIT_LIFECYCLE_CONCURRENCY || '10',
        );
        if (
          !Number.isSafeInteger(configuredConcurrency) ||
          configuredConcurrency <= 0
        ) {
          throw new Error(
            'CREDIT_LIFECYCLE_CONCURRENCY must be a positive safe integer',
          );
        }
        return new CreditBullMqProvider(redisUrl, configuredConcurrency);
      },
    },
    AdminPeopleRepository,
    CreditRepository,
    CreditLedgerRepository,
    CreditCommandService,
    CreditEventStore,
    CreditNotificationService,
    CreditLifecycleConsumer,
    SsiTransactionResultConsumer,
    CreditService,
  ],
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
