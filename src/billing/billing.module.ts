import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { CreditModule } from 'src/credits/credits.module';
import { CreditPlan, CreditsSchema } from 'src/credits/schemas/credit.schema';
import { SuperAdminMiddleware } from 'src/utils/middleware/super-admin.middleware';
import { AdminBillingController } from './admin-billing.controller';
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
import { Quote, QuoteSchema } from './schemas/quote.schema';
import {
  Order,
  OrderSchema,
  PaymentAttempt,
  PaymentAttemptSchema,
} from './schemas/order.schema';
import { PaymentRouter } from './payments/payment-router';
import { RazorpayProvider } from './payments/razorpay.provider';
import { CouponReservationService } from './services/coupon-reservation.service';
import { OrderService } from './services/order.service';
import { PaymentLinkService } from './services/payment-link.service';
import { PaymentReconciliationService } from './services/payment-reconciliation.service';
import {
  BillingCounter,
  BillingCounterSchema,
  Invoice,
  InvoiceSchema,
} from './schemas/invoice.schema';
import { InvoiceService } from './services/invoice.service';
import { BillingAccountService } from './services/billing-account.service';
import { CatalogService } from './services/catalog.service';
import { CouponService } from './services/coupon.service';
import { BillingProfileService } from './services/billing-profile.service';
import { QuoteService } from './services/quote.service';

// Self-serve credit top-up and invoicing (docs/payment/credits-top-up-payment.md).
@Module({
  imports: [
    UserModule,
    CreditModule,
    MongooseModule.forFeature([
      { name: PriceBook.name, schema: PriceBookSchema },
      { name: Coupon.name, schema: CouponSchema },
      { name: CouponAccount.name, schema: CouponAccountSchema },
      { name: CouponRedemption.name, schema: CouponRedemptionSchema },
      { name: Quote.name, schema: QuoteSchema },
      { name: Invoice.name, schema: InvoiceSchema },
      { name: BillingCounter.name, schema: BillingCounterSchema },
      { name: Order.name, schema: OrderSchema },
      { name: PaymentAttempt.name, schema: PaymentAttemptSchema },
      { name: CreditPlan.name, schema: CreditsSchema },
      { name: CustomerOnboarding.name, schema: CustomerOnboardingSchema },
      { name: App.name, schema: AppSchema },
      { name: AdminPeople.name, schema: AdminPeopleSchema },
    ]),
  ],
  controllers: [BillingController, AdminBillingController],
  providers: [
    AdminPeopleRepository,
    BillingAccountService,
    CatalogService,
    CouponService,
    QuoteService,
    BillingProfileService,
    InvoiceService,
    RazorpayProvider,
    PaymentRouter,
    CouponReservationService,
    OrderService,
    PaymentLinkService,
    PaymentReconciliationService,
  ],
  exports: [BillingProfileService],
})
export class BillingModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // The shared RateLimitMiddleware (10 requests a minute) would block the popup,
    // which re-quotes on every change; quotes limit rejected coupon codes instead.
    consumer
      .apply(JWTAuthorizeMiddleware, JWTAccessAccountMiddleware)
      .forRoutes(BillingController);
    consumer
      .apply(JWTAuthorizeMiddleware, SuperAdminMiddleware)
      .forRoutes(AdminBillingController);
  }
}
