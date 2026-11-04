import { Injectable } from '@nestjs/common';
import { BillingRegion, PAY_PROVIDER } from '../billing.constants';
import { PaymentProvider } from './payment-provider';
import { RazorpayProvider } from './razorpay.provider';

// Picks the provider for a region (ADR §6). An order keeps its provider for
// life, so syncing always goes to the gateway that took the payment.
@Injectable()
export class PaymentRouter {
  private readonly providers: Map<string, PaymentProvider>;

  constructor(razorpay: RazorpayProvider) {
    this.providers = new Map([[razorpay.id, razorpay]]);
  }

  forRegion(region: BillingRegion): PaymentProvider | null {
    const id = PAY_PROVIDER[region];
    return (id && this.providers.get(id)) || null;
  }

  get(id: string): PaymentProvider {
    const provider = this.providers.get(id);
    if (!provider) throw new Error(`Unknown payment provider ${id}`);
    return provider;
  }

  configured(): PaymentProvider[] {
    return [...this.providers.values()].filter((p) => p.isConfigured());
  }
}
