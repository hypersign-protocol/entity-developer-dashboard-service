import {
  Controller,
  Get,
  HttpStatus,
  Query,
  Req,
  UseFilters,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { RequireDashboardAccess } from 'src/app-auth/decorator/dashboard-access.decorator';
import { DashboardAccessGuard } from 'src/app-auth/guard/validate-dashboard-access.guard';
import { SERVICES } from 'src/supported-service/services/iServiceList';
import { AllExceptionsFilter } from 'src/utils/utils';
import { BillingErrorCode } from './billing.constants';
import { BillingException, billingValidationPipe } from './billing.exception';
import { GetCouponsQueryDto } from './dto/get-coupons-query.dto';
import { PricingSelection } from './pricing/pricing';
import { BillingAccountService } from './services/billing-account.service';
import { CatalogService } from './services/catalog.service';
import { CouponService } from './services/coupon.service';

// Formats: docs/payment/api-contract.md.
@UseFilters(AllExceptionsFilter)
@ApiTags('Billing')
@Controller('/api/v1/billing')
@UseGuards(DashboardAccessGuard)
export class BillingController {
  constructor(
    private readonly accounts: BillingAccountService,
    private readonly catalog: CatalogService,
    private readonly coupons: CouponService,
  ) {}

  @ApiOkResponse({ description: "Published prices for the caller's region" })
  @RequireDashboardAccess(SERVICES.DASHBOARD.ACCESS_TYPES.READ_BILLING)
  @Get('catalog')
  async getCatalog(@Req() req: any) {
    const account = await this.accounts.resolve(req.user.userId);
    return this.catalog.getCatalog(account);
  }

  @ApiOkResponse({ description: 'Listed coupons the account can use now' })
  @RequireDashboardAccess(SERVICES.DASHBOARD.ACCESS_TYPES.READ_BILLING)
  @UsePipes(billingValidationPipe())
  @Get('coupons')
  async getCoupons(@Query() query: GetCouponsQueryDto, @Req() req: any) {
    if (query.planCode && query.customAmountMinor !== undefined) {
      throw new BillingException(
        HttpStatus.BAD_REQUEST,
        BillingErrorCode.VALIDATION_FAILED,
        'Send either planCode or customAmountMinor, not both.',
        { fields: { customAmountMinor: 'Not allowed together with planCode' } },
      );
    }
    const account = await this.accounts.resolve(req.user.userId);
    await this.accounts.assertBillableApp(query.appId, account);
    const selection: PricingSelection | undefined = query.planCode
      ? { planCode: query.planCode }
      : query.customAmountMinor !== undefined
      ? { customAmountMinor: query.customAmountMinor }
      : undefined;
    return this.coupons.listEligible(account, selection);
  }
}
