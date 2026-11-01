import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseFilters,
  UsePipes,
} from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AllExceptionsFilter } from 'src/utils/utils';
import { BillingErrorCode } from './billing.constants';
import { BillingException, billingValidationPipe } from './billing.exception';
import { AdminInvoiceDto, InvoiceListQueryDto } from './dto/admin-invoice.dto';
import { AdminUpdateBillingProfileDto } from './dto/update-billing-profile.dto';
import { BillingProfileService } from './services/billing-profile.service';
import { InvoiceService } from './services/invoice.service';

// Super-admin billing (docs/payment/api-contract.md §5). SuperAdminMiddleware
// guards every route (billing.module.ts).
@UseFilters(AllExceptionsFilter)
@ApiTags('Billing (super admin)')
@Controller('/api/v1/admin/billing')
export class AdminBillingController {
  constructor(
    private readonly invoices: InvoiceService,
    private readonly profiles: BillingProfileService,
  ) {}

  @ApiOkResponse({
    description:
      'The organisation and billing profile behind an app ("Billed to")',
  })
  @Get('profiles')
  getProfile(@Query('appId') appId: string) {
    if (!appId) {
      throw new BillingException(
        HttpStatus.BAD_REQUEST,
        BillingErrorCode.VALIDATION_FAILED,
        'appId is required.',
        { fields: { appId: 'Required' } },
      );
    }
    return this.invoices.adminProfile(appId);
  }

  @ApiOkResponse({ description: 'Billing profile completed or corrected' })
  @UsePipes(billingValidationPipe())
  @Patch('profiles/:orgId')
  updateProfile(
    @Param('orgId') orgId: string,
    @Body() dto: AdminUpdateBillingProfileDto,
    @Req() req: any,
  ) {
    return this.profiles.adminUpdate(orgId, dto, req.user.userId);
  }

  @ApiOkResponse({
    description: 'What the invoice would contain, without issuing it',
  })
  @UsePipes(billingValidationPipe())
  @HttpCode(HttpStatus.OK)
  @Post('invoices/preview')
  preview(@Body() dto: AdminInvoiceDto) {
    return this.invoices.preview(dto);
  }

  @ApiOkResponse({ description: 'Invoice issued and credits granted' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @UsePipes(billingValidationPipe())
  @Post('invoices')
  create(
    @Body() dto: AdminInvoiceDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Req() req: any,
  ) {
    return this.invoices.createAdmin(dto, req.user.userId, idempotencyKey);
  }

  @ApiOkResponse({
    description: 'Invoices of every organisation, newest first',
  })
  @UsePipes(billingValidationPipe())
  @Get('invoices')
  list(@Query() query: InvoiceListQueryDto) {
    return this.invoices.listForAdmin(query);
  }

  @ApiOkResponse({
    description: 'The full invoice, for the dashboard to render the PDF',
  })
  @Get('invoices/:invoiceId')
  get(@Param('invoiceId') invoiceId: string) {
    return this.invoices.getForAdmin(invoiceId);
  }
}
