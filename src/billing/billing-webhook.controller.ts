import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseFilters,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { AllExceptionsFilter } from 'src/utils/utils';
import { PaymentWebhookService } from './services/payment-webhook.service';

/** The path main.ts keeps the raw body for (the signature covers those bytes). */
export const BILLING_WEBHOOK_PATH = '/api/v1/billing/webhooks/';

// Called by the gateway, not the dashboard: no JWT and no origin check. The
// signature is the authentication. See docs/payment/api-contract.md §6.5.
@UseFilters(AllExceptionsFilter)
@ApiExcludeController()
@Controller('/api/v1/billing/webhooks')
export class BillingWebhookController {
  constructor(private readonly webhooks: PaymentWebhookService) {}

  // Razorpay Dashboard → Webhooks: this URL, the RAZORPAY_WEBHOOK_SECRET value,
  // and the payment, order and payment_link events.
  @Post('razorpay')
  @HttpCode(HttpStatus.OK)
  razorpay(
    @Req() req: { rawBody?: Buffer },
    @Headers('x-razorpay-signature') signature: string,
    @Headers('x-razorpay-event-id') eventId: string,
    @Body() body: unknown,
  ) {
    return this.webhooks.receive('razorpay', {
      rawBody: req.rawBody,
      signature,
      eventId,
      body,
    });
  }
}
