import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { App, AppSchema } from 'src/app-auth/schemas/app.schema';
import {
  CustomerOnboarding,
  CustomerOnboardingSchema,
} from 'src/customer-onboarding/schemas/customer-onboarding.schema';
import { AdminPeopleRepository } from 'src/people/repository/people.repository';
import {
  AdminPeople,
  AdminPeopleSchema,
} from 'src/people/schema/people.schema';
import { UserModule } from 'src/user/user.module';
import { JWTAccessAccountMiddleware } from 'src/utils/middleware/jwt-accessAccount.middlerwere';
import { JWTAuthorizeMiddleware } from 'src/utils/middleware/jwt-authorization.middleware';
import { BillingController } from './billing.controller';
import {
  Coupon,
  CouponAccount,
  CouponAccountSchema,
  CouponRedemption,
  CouponRedemptionSchema,
  CouponSchema,
} from './schemas/coupon.schema';
import { PriceBook, PriceBookSchema } from './schemas/price-book.schema';
import { BillingAccountService } from './services/billing-account.service';
import { CatalogService } from './services/catalog.service';
import { CouponService } from './services/coupon.service';

// Self-serve credit top-up and invoicing (docs/payment/credits-top-up-payment.md).
@Module({
  imports: [
    UserModule,
    MongooseModule.forFeature([
      { name: PriceBook.name, schema: PriceBookSchema },
      { name: Coupon.name, schema: CouponSchema },
      { name: CouponAccount.name, schema: CouponAccountSchema },
      { name: CouponRedemption.name, schema: CouponRedemptionSchema },
      { name: CustomerOnboarding.name, schema: CustomerOnboardingSchema },
      { name: App.name, schema: AppSchema },
      { name: AdminPeople.name, schema: AdminPeopleSchema },
    ]),
  ],
  controllers: [BillingController],
  providers: [
    AdminPeopleRepository,
    BillingAccountService,
    CatalogService,
    CouponService,
  ],
})
export class BillingModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Catalog and coupon listing take no codes, so no rate limit yet; quotes
    // (which accept coupon codes) get one.
    consumer
      .apply(JWTAuthorizeMiddleware, JWTAccessAccountMiddleware)
      .forRoutes(BillingController);
  }
}
