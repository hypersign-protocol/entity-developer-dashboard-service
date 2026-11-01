import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
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
import { InvoiceListQueryDto } from './dto/admin-invoice.dto';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { GetCouponsQueryDto } from './dto/get-coupons-query.dto';
import { PricingSelection } from './pricing/pricing';
import { BillingAccountService } from './services/billing-account.service';
import { CatalogService } from './services/catalog.service';
import { CouponService } from './services/coupon.service';
import { InvoiceService } from './services/invoice.service';
import { QuoteService } from './services/quote.service';

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
    private readonly quotes: QuoteService,
    private readonly invoices: InvoiceService,
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

  @ApiOkResponse({ description: 'The selection priced by the server' })
  @RequireDashboardAccess(SERVICES.DASHBOARD.ACCESS_TYPES.READ_BILLING)
  @UsePipes(billingValidationPipe())
  @HttpCode(HttpStatus.OK)
  @Post('quotes')
  async createQuote(@Body() dto: CreateQuoteDto, @Req() req: any) {
    if (
      (dto.planCode === undefined) ===
      (dto.customAmountMinor === undefined)
    ) {
      throw new BillingException(
        HttpStatus.BAD_REQUEST,
        BillingErrorCode.VALIDATION_FAILED,
        'Send exactly one of planCode and customAmountMinor.',
        { fields: { planCode: 'Send this or customAmountMinor' } },
      );
    }
    const account = await this.accounts.resolve(req.user.userId);
    await this.accounts.assertBillableApp(dto.appId, account);
    // req.user.userId is the owner for team members; the email is the person.
    return this.quotes.create(account, dto, req.user.email || req.user.userId);
  }

  @ApiOkResponse({ description: "The organisation's invoices, newest first" })
  @RequireDashboardAccess(SERVICES.DASHBOARD.ACCESS_TYPES.READ_BILLING)
  @UsePipes(billingValidationPipe())
  @Get('invoices')
  async listInvoices(@Query() query: InvoiceListQueryDto, @Req() req: any) {
    // Invoices stay visible even where self-serve billing is switched off.
    const orgId = await this.accounts.orgIdOf(req.user.userId);
    return this.invoices.listForOrg(orgId, { ...query, orgId: undefined });
  }

  @ApiOkResponse({
    description: 'The full invoice, for the dashboard to render the PDF',
  })
  @RequireDashboardAccess(SERVICES.DASHBOARD.ACCESS_TYPES.READ_BILLING)
  @Get('invoices/:invoiceId')
  async getInvoice(@Param('invoiceId') invoiceId: string, @Req() req: any) {
    const orgId = await this.accounts.orgIdOf(req.user.userId);
    return this.invoices.getForOrg(orgId, invoiceId);
  }
}
