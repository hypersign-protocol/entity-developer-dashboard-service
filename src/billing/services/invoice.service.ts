import {
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { Connection, FilterQuery, Model, Types } from 'mongoose';
import { App, AppDocument } from 'src/app-auth/schemas/app.schema';
import { TimeUnit } from 'src/customer-onboarding/constants/enum';
import {
  CustomerOnboarding,
  CustomerOnboardingDocument,
} from 'src/customer-onboarding/schemas/customer-onboarding.schema';
import {
  CreditPlan,
  CreditPlanDocument,
  CreditSourceEnum,
  CreditStatus,
} from 'src/credits/schemas/credit.schema';
import { CreditService } from 'src/credits/services/credits.service';
import { SERVICE_TYPES } from 'src/supported-service/services/iServiceList';
import { BillingErrorCode, BillingRegion } from '../billing.constants';
import { BillingException } from '../billing.exception';
import { AdminInvoiceDto, InvoiceListQueryDto } from '../dto/admin-invoice.dto';
import {
  buildAdminInvoice,
  buildLinkPaidInvoice,
  buildSelfServeInvoice,
  InvoiceFields,
  priceAdminInvoice,
} from '../invoices/build-invoice';
import { formatInvoiceNumber, invoiceSeries } from '../invoices/invoice-number';
import { readSupplier, Supplier, supplierProblems } from '../invoices/supplier';
import { buildBillingProfile } from '../profile/billing-profile';
import {
  BillingCounter,
  BillingCounterDocument,
  Invoice,
  InvoiceDocument,
} from '../schemas/invoice.schema';
import { Order } from '../schemas/order.schema';
import {
  PriceBook,
  PriceBookDocument,
  PriceBookStatus,
} from '../schemas/price-book.schema';

const PROFILE_FIELDS = {
  companyName: 1,
  customerEmail: 1,
  country: 1,
  billing: 1,
  userId: 1,
};
const MAX_PAGE_SIZE = 100;

@Injectable()
export class InvoiceService implements OnModuleInit {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Invoice.name)
    private readonly invoiceModel: Model<InvoiceDocument>,
    @InjectModel(BillingCounter.name)
    private readonly counterModel: Model<BillingCounterDocument>,
    @InjectModel(CustomerOnboarding.name)
    private readonly onboardingModel: Model<CustomerOnboardingDocument>,
    @InjectModel(App.name) private readonly appModel: Model<AppDocument>,
    @InjectModel(CreditPlan.name)
    private readonly creditPlanModel: Model<CreditPlanDocument>,
    @InjectModel(PriceBook.name)
    private readonly priceBookModel: Model<PriceBookDocument>,
    private readonly creditService: CreditService,
  ) {}

  onModuleInit() {
    // Logged rather than thrown: a missing setting must not take the whole
    // dashboard down. Invoice calls answer 503 BILLING_NOT_CONFIGURED instead.
    const problems = supplierProblems(readSupplier());
    if (problems.length) {
      Logger.warn(
        `Invoices can't be issued until the BILLING_* settings are fixed: ${problems.join(
          '; ',
        )}`,
        'InvoiceService',
      );
    }
  }

  /** Pay refuses to take money we couldn't invoice. */
  assertConfigured() {
    this.supplier();
  }

  private supplier(): Supplier {
    const supplier = readSupplier();
    const problems = supplierProblems(supplier);
    if (problems.length) {
      throw new BillingException(
        HttpStatus.SERVICE_UNAVAILABLE,
        BillingErrorCode.BILLING_NOT_CONFIGURED,
        'Invoicing is not configured yet.',
        { problems },
      );
    }
    return supplier;
  }

  /** The ID Service app and its organisation, for a super admin. */
  private async appAndOrg(appId: string) {
    const app = await this.appModel
      .findOne(
        { appId },
        { appId: 1, appName: 1, userId: 1, orgId: 1, services: 1 },
      )
      .lean();
    if (!app) {
      throw new BillingException(
        HttpStatus.NOT_FOUND,
        BillingErrorCode.APP_NOT_FOUND,
        'App not found.',
      );
    }
    if (app.services?.[0]?.id !== SERVICE_TYPES.CAVACH_API) {
      throw new BillingException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        BillingErrorCode.APP_NOT_BILLABLE,
        'Only ID Service apps are invoiced. Use the existing recharge for SSI apps.',
      );
    }
    const org = await this.onboardingModel
      .findOne(
        app.orgId ? { _id: app.orgId } : { userId: app.userId },
        PROFILE_FIELDS,
      )
      .lean();
    if (!org) {
      throw new BillingException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        BillingErrorCode.ONBOARDING_NOT_FOUND,
        'The app owner has no organisation.',
      );
    }
    return { app, org, profile: buildBillingProfile(org) };
  }

  /** GET /admin/billing/profiles?appId (the "Billed to" card). */
  async adminProfile(appId: string) {
    const { app, org, profile } = await this.appAndOrg(appId);
    return {
      app: {
        appId: app.appId,
        appName: app.appName,
        serviceId: app.services[0].id,
      },
      org: { orgId: String(org._id), companyName: org.companyName },
      profile,
    };
  }

  /** `collect`: Collect payment (isPaid false) is handled by the caller. */
  private checkRequest(dto: AdminInvoiceDto, collect = false) {
    if (dto.amountMinor === 0) return;
    const fields: Record<string, string> = {};
    if (dto.isPaid === undefined)
      fields.isPaid = 'Required when amountMinor is above 0';
    if (dto.isPaid === false && !collect) {
      throw new BillingException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        BillingErrorCode.PAYMENTS_NOT_AVAILABLE,
        'Collecting payment needs a payment gateway, which is not connected yet.',
      );
    }
    if (dto.isPaid && !dto.payment)
      fields.payment = 'Required when isPaid is true';
    if (dto.payment) {
      const paidAt = new Date(`${dto.payment.paidAt}T00:00:00.000Z`);
      if (Number.isNaN(paidAt.getTime()))
        fields['payment.paidAt'] = 'Not a valid date';
      else if (paidAt.getTime() > Date.now())
        fields['payment.paidAt'] = 'Cannot be in the future';
    }
    if (Object.keys(fields).length) {
      throw new BillingException(
        HttpStatus.BAD_REQUEST,
        BillingErrorCode.VALIDATION_FAILED,
        'The request is not valid.',
        { fields },
      );
    }
  }

  private requireCompleteProfile(
    profile: ReturnType<typeof buildBillingProfile>,
  ) {
    if (!profile.complete) {
      throw new BillingException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        BillingErrorCode.BILLING_PROFILE_INCOMPLETE,
        "The customer's billing details are incomplete.",
        { missingFields: profile.missingFields, source: profile.source },
      );
    }
  }

  /** POST /admin/billing/invoices/preview: what create would issue, without writing. */
  async preview(dto: AdminInvoiceDto) {
    this.checkRequest(dto, true);
    const collect = dto.amountMinor > 0 && dto.isPaid === false;
    const supplier = this.supplier();
    const { profile } = await this.appAndOrg(dto.appId);
    this.requireCompleteProfile(profile);
    const { tax, totals } = priceAdminInvoice(
      dto.amountMinor,
      profile.region,
      profile.gstStateCode,
      supplier.stateCode,
    );
    const hasActivePlan = await this.creditPlanModel.exists({
      serviceId: dto.appId,
      status: CreditStatus.ACTIVE,
    });
    return {
      currency: profile.currency,
      credits: dto.credits,
      validityDays: dto.validityDays,
      totalBeforeTaxMinor: totals.taxableMinor,
      tax: { amountMinor: totals.taxMinor, lines: tax },
      totalMinor: totals.totalMinor,
      // Collect payment: a payment link now; the invoice once it's paid.
      willIssueAs: collect
        ? { status: 'AWAITING_PAYMENT', settlement: 'GATEWAY' }
        : {
            status: 'PAID',
            settlement: dto.amountMinor === 0 ? 'COMPLIMENTARY' : 'OFFLINE',
          },
      // A new plan waits while another is active (today's credit behaviour).
      creditsActive: collect
        ? 'WHEN_PAID'
        : hasActivePlan
        ? 'AFTER_CURRENT_PLAN'
        : 'IMMEDIATELY',
    };
  }

  /**
   * Collect payment: everything the payment link and its later invoice need,
   * checked as for an invoice. Nothing is written.
   */
  async paymentLinkDraft(dto: AdminInvoiceDto) {
    this.checkRequest(dto, true);
    const supplier = this.supplier();
    const { app, org, profile } = await this.appAndOrg(dto.appId);
    this.requireCompleteProfile(profile);
    const { tax, totals } = priceAdminInvoice(
      dto.amountMinor,
      profile.region,
      profile.gstStateCode,
      supplier.stateCode,
    );
    const book = await this.priceBookModel
      .findOne(
        { region: profile.region, status: PriceBookStatus.PUBLISHED },
        { addOns: 1 },
      )
      .lean();
    return {
      app: { appId: app.appId, appName: app.appName },
      org: { orgId: String(org._id), companyName: org.companyName },
      profile,
      tax,
      totals,
      addOnLines: (book?.addOns || []).map(({ code, title }) => ({
        code,
        title,
      })),
    };
  }

  /**
   * POST /admin/billing/invoices: Free credits (amount 0) or Already paid.
   * Issues the invoice (number + insert in one transaction), then grants the
   * credits with referenceId 'invoice:<id>', so a retry never grants twice.
   */
  async createAdmin(
    dto: AdminInvoiceDto,
    superAdminUserId: string,
    idempotencyKey: string,
  ) {
    if (!idempotencyKey?.trim()) {
      throw new BillingException(
        HttpStatus.BAD_REQUEST,
        BillingErrorCode.VALIDATION_FAILED,
        'The Idempotency-Key header is required.',
        { fields: { 'Idempotency-Key': 'Required' } },
      );
    }
    const key = idempotencyKey.trim();
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          appId: dto.appId,
          credits: dto.credits,
          validityDays: dto.validityDays,
          amountMinor: dto.amountMinor,
          isPaid: dto.isPaid ?? null,
          payment: dto.payment ?? null,
        }),
      )
      .digest('hex');

    const previous = await this.invoiceModel
      .findOne({ createdBy: superAdminUserId, idempotencyKey: key })
      .lean();
    if (previous) {
      if (previous.requestHash !== requestHash) {
        throw new BillingException(
          HttpStatus.CONFLICT,
          BillingErrorCode.IDEMPOTENCY_KEY_REUSED,
          'This Idempotency-Key was used for a different invoice.',
        );
      }
      // A retry: finish the grant if the first attempt didn't.
      return this.adminResult(
        await this.grantCredits(previous, superAdminUserId),
      );
    }

    this.checkRequest(dto);
    const supplier = this.supplier();
    const { app, org, profile } = await this.appAndOrg(dto.appId);
    this.requireCompleteProfile(profile);

    const book = await this.priceBookModel
      .findOne(
        { region: profile.region, status: PriceBookStatus.PUBLISHED },
        { addOns: 1 },
      )
      .lean();
    const now = new Date();
    const fields: InvoiceFields = buildAdminInvoice({
      credits: dto.credits,
      validityDays: dto.validityDays,
      amountMinor: dto.amountMinor,
      payment: dto.payment && {
        method: dto.payment.method,
        reference: dto.payment.reference.trim(),
        paidAt: new Date(`${dto.payment.paidAt}T00:00:00.000Z`),
      },
      profile,
      supplier,
      app: { appId: app.appId, appName: app.appName },
      addOnLines: book?.addOns || [],
      now,
    });

    const invoice = await this.issue(
      {
        ...fields,
        orgId: String(org._id),
        appId: app.appId,
        createdBy: superAdminUserId,
        idempotencyKey: key,
        requestHash,
        note: dto.note?.trim() || undefined,
      },
      profile.region as BillingRegion,
      supplier.invoicePrefix,
      now,
    );

    // The first invoice fixes the tax details printed on invoices.
    await this.onboardingModel.updateOne(
      { _id: org._id, 'billing.lockedAt': { $exists: false } },
      { $set: { 'billing.lockedAt': now } },
    );
    Logger.log(
      `Invoice ${invoice.invoiceNumber} (${invoice.settlement}) issued by ${superAdminUserId} for app ${app.appId}`,
      'InvoiceService',
    );
    return this.adminResult(await this.grantCredits(invoice, superAdminUserId));
  }

  /** Number + insert in one transaction, so a rolled-back insert frees its number. */
  private async issue(
    doc: Partial<Invoice>,
    region: BillingRegion,
    prefix: string,
    now: Date,
  ): Promise<Invoice & { _id: Types.ObjectId }> {
    const series = invoiceSeries(
      region === BillingRegion.IN ? 'IN' : 'GLOBAL',
      now,
    );
    const session = await this.connection.startSession();
    try {
      let created;
      await session.withTransaction(async () => {
        const counter = await this.counterModel.findOneAndUpdate(
          { _id: series.counterId },
          { $inc: { seq: 1 } },
          { upsert: true, new: true, session },
        );
        [created] = await this.invoiceModel.create(
          [
            {
              ...doc,
              invoiceNumber: formatInvoiceNumber(prefix, series, counter.seq),
              series: series.series,
              financialYear: series.financialYear,
            },
          ],
          { session },
        );
      });
      return created.toObject();
    } finally {
      await session.endSession();
    }
  }

  /** Grants the invoice's credits once, and links the plan and the invoice. */
  private async grantCredits(
    invoice: Invoice & { _id: unknown },
    creditedBy: string,
    source = CreditSourceEnum.MANUAL_RECHARGE,
  ) {
    if (invoice.creditPlanId) return invoice;
    const invoiceId = String(invoice._id);
    const referenceId = `invoice:${invoiceId}`;
    try {
      await this.creditService.grantCredit(
        invoice.appId,
        {
          amount: String(invoice.credits),
          validityPeriod: invoice.validityDays,
          validityPeriodUnit: TimeUnit.Days,
          amountDenom: 'credits',
        },
        creditedBy,
        source,
        referenceId,
      );
    } catch (error) {
      Logger.error(
        `Invoice ${invoice.invoiceNumber} issued but credits not granted: ${error?.message}`,
        error?.stack,
        'InvoiceService',
      );
      throw new InternalServerErrorException([
        `Invoice ${invoice.invoiceNumber} was issued, but the credits could not be granted yet. Retry with the same Idempotency-Key.`,
      ]);
    }
    const plan = await this.creditPlanModel.findOneAndUpdate(
      { serviceId: invoice.appId, referenceId },
      { $set: { invoiceId } },
      { new: true, projection: { _id: 1 } },
    );
    const creditPlanId = plan ? String(plan._id) : undefined;
    if (creditPlanId) {
      await this.invoiceModel.updateOne(
        { _id: invoice._id },
        { $set: { creditPlanId } },
      );
    }
    return { ...invoice, creditPlanId };
  }

  /**
   * A paid self-serve order: issues its invoice once (the unique orderId index
   * stops a second one), then grants the credits once. Safe to call again.
   */
  async issueForOrder(order: Order & { _id: unknown }) {
    const orderId = String(order._id);
    let invoice = await this.invoiceModel.findOne({ orderId }).lean();
    if (!invoice) {
      const supplier = this.supplier();
      const now = new Date();
      const payment = {
        provider: order.provider,
        paymentId: order.payment.paymentId,
        method: order.payment.method,
        paidAt: order.payment.paidAt,
      };
      const app = { appId: order.appId, appName: order.appName };
      const fields =
        order.source === 'ADMIN'
          ? buildLinkPaidInvoice({
              credits: order.quote.credits,
              validityDays: order.quote.validityDays,
              amountMinor: order.quote.lines.totalBeforeTaxMinor,
              payment,
              orderNumber: order.orderNumber,
              profile: order.customer,
              supplier,
              app,
              addOnLines: order.quote.lines.addOns,
              now,
            })
          : buildSelfServeInvoice({
              orderNumber: order.orderNumber,
              lines: order.quote.lines,
              tax: order.tax,
              credits: order.quote.credits,
              validityDays: order.quote.validityDays,
              payment,
              profile: order.customer,
              supplier,
              app,
              now,
            });
      try {
        invoice = await this.issue(
          {
            ...fields,
            orgId: order.orgId,
            appId: order.appId,
            orderId,
            ...(order.source === 'ADMIN' && {
              createdBy: order.createdBy,
              note: order.note,
            }),
          },
          order.region,
          supplier.invoicePrefix,
          now,
        );
        Logger.log(
          `Invoice ${invoice.invoiceNumber} issued for order ${order.orderNumber}`,
          'InvoiceService',
        );
      } catch (error) {
        if (error?.code !== 11000) throw error;
        invoice = await this.invoiceModel.findOne({ orderId }).lean();
        if (!invoice) throw error;
      }
      await this.onboardingModel.updateOne(
        { _id: order.orgId, 'billing.lockedAt': { $exists: false } },
        { $set: { 'billing.lockedAt': now } },
      );
    }
    const creditsActive = invoice.creditPlanId
      ? undefined
      : (await this.creditPlanModel.exists({
          serviceId: order.appId,
          status: CreditStatus.ACTIVE,
        }))
      ? ('AFTER_CURRENT_PLAN' as const)
      : ('IMMEDIATELY' as const);
    const granted = await this.grantCredits(
      invoice,
      order.createdBy,
      CreditSourceEnum.PAYMENT,
    );
    return { invoice: granted, creditsActive };
  }

  private adminResult(invoice: Invoice & { _id: unknown }) {
    return { invoice: this.toSummary(invoice), paymentLink: null };
  }

  private listFilter(query: InvoiceListQueryDto, base: FilterQuery<Invoice>) {
    const filter: FilterQuery<Invoice> = { ...base };
    if (query.appId) filter.appId = query.appId;
    if (query.status) filter.status = query.status as Invoice['status'];
    if (query.source) filter.source = query.source as Invoice['source'];
    if (query.settlement)
      filter.settlement = query.settlement as Invoice['settlement'];
    if (query.from || query.to) {
      filter.issuedAt = {
        ...(query.from && { $gte: new Date(`${query.from}T00:00:00.000Z`) }),
        ...(query.to && { $lte: new Date(`${query.to}T23:59:59.999Z`) }),
      };
    }
    return filter;
  }

  private async list(filter: FilterQuery<Invoice>, query: InvoiceListQueryDto) {
    const page = query.page || 1;
    const limit = Math.min(query.limit || 10, MAX_PAGE_SIZE);
    const [data, total] = await Promise.all([
      this.invoiceModel
        .find(filter)
        .sort({ issuedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      this.invoiceModel.countDocuments(filter),
    ]);
    return { data, page, limit, total };
  }

  /** GET /billing/invoices: the caller's organisation, newest first. */
  async listForOrg(orgId: string, query: InvoiceListQueryDto) {
    const result = await this.list(this.listFilter(query, { orgId }), query);
    return { ...result, data: result.data.map((i) => this.toSummary(i)) };
  }

  /** GET /admin/billing/invoices: any organisation. */
  async listForAdmin(query: InvoiceListQueryDto) {
    const result = await this.list(
      this.listFilter(query, query.orgId ? { orgId: query.orgId } : {}),
      query,
    );
    const names = await this.companyNames(result.data.map((i) => i.orgId));
    return {
      ...result,
      data: result.data.map((i) => ({
        ...this.toSummary(i),
        org: { orgId: i.orgId, companyName: names.get(i.orgId) ?? null },
      })),
    };
  }

  /** GET /billing/invoices/:id: only the caller's organisation's invoices. */
  async getForOrg(orgId: string, invoiceId: string) {
    return this.toDocument(await this.findInvoice({ orgId }, invoiceId));
  }

  /** GET /admin/billing/invoices/:id. */
  async getForAdmin(invoiceId: string) {
    const invoice = await this.findInvoice({}, invoiceId);
    const names = await this.companyNames([invoice.orgId]);
    return {
      ...this.toDocument(invoice),
      org: {
        orgId: invoice.orgId,
        companyName: names.get(invoice.orgId) ?? null,
      },
    };
  }

  private async findInvoice(scope: FilterQuery<Invoice>, invoiceId: string) {
    const invoice = Types.ObjectId.isValid(invoiceId)
      ? await this.invoiceModel.findOne({ ...scope, _id: invoiceId }).lean()
      : null;
    if (!invoice) {
      throw new BillingException(
        HttpStatus.NOT_FOUND,
        BillingErrorCode.INVOICE_NOT_FOUND,
        'Invoice not found.',
      );
    }
    return invoice;
  }

  private async companyNames(orgIds: string[]) {
    const ids = [...new Set(orgIds)].filter((id) => Types.ObjectId.isValid(id));
    const orgs = await this.onboardingModel
      .find({ _id: { $in: ids } }, { companyName: 1 })
      .lean();
    return new Map(orgs.map((o) => [String(o._id), o.companyName]));
  }

  /** InvoiceSummary (docs/payment/api-contract.md §4). */
  toSummary(i: Invoice & { _id: unknown }) {
    return {
      invoiceId: String(i._id),
      invoiceNumber: i.invoiceNumber,
      source: i.source,
      status: i.status,
      settlement: i.settlement ?? null,
      appId: i.appId,
      appName: i.app?.appName ?? null,
      issuedAt: i.issuedAt,
      paidAt: i.paidAt,
      dueAt: i.dueAt,
      currency: i.currency,
      totalMinor: i.totals.totalMinor,
      amountPaidMinor: i.totals.amountPaidMinor,
      balanceDueMinor: i.totals.balanceDueMinor,
      credits: i.credits,
      validityDays: i.validityDays,
      creditPlanId: i.creditPlanId ?? null,
      payment: i.payment
        ? {
            method: i.payment.method,
            reference: i.payment.reference,
            provider: i.payment.provider,
          }
        : null,
      payNowUrl: i.payNowUrl,
    };
  }

  /** InvoiceDocument (docs/payment/api-contract.md §4): everything printed. */
  toDocument(i: Invoice & { _id: unknown }) {
    return {
      invoiceId: String(i._id),
      invoiceNumber: i.invoiceNumber,
      templateVersion: i.templateVersion,
      series: i.series,
      financialYear: i.financialYear,
      source: i.source,
      status: i.status,
      settlement: i.settlement ?? null,
      issuedAt: i.issuedAt,
      paidAt: i.paidAt,
      dueAt: i.dueAt,
      currency: i.currency,
      supplier: i.supplier,
      customer: i.customer,
      placeOfSupply: i.placeOfSupply,
      app: i.app,
      orderNumber: i.orderNumber,
      lines: i.lines,
      addOnLines: i.addOnLines,
      discounts: i.discounts,
      tax: i.tax,
      taxNote: i.taxNote,
      totals: i.totals,
      credits: i.credits,
      validityDays: i.validityDays,
      payment: i.payment,
      payNowUrl: i.payNowUrl,
      voidedAt: i.voidedAt,
      voidReason: i.voidReason,
    };
  }
}
