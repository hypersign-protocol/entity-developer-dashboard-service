import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppRepository } from 'src/app-auth/repositories/app.repository';
import getCreditExpiryAlertMail from 'src/mail-notification/constants/templates/credit-expiry-alert.template';
import getCreditUsageAlertMail from 'src/mail-notification/constants/templates/credit-usage-alert.template';
import getAllowanceUsageAlertMail from 'src/mail-notification/constants/templates/allowance-usage-alert.template';
import { MailNotificationService } from 'src/mail-notification/services/mail-notification.service';
import { SERVICE_TYPES } from 'src/supported-service/services/iServiceList';
import { JobNames } from 'src/utils/time-constant';
import { UserRole } from 'src/user/schema/user.schema';
import { UserRepository } from 'src/user/repository/user.repository';
import { CreditRepository } from '../repositories/credit.repository';
import { CreditPlan, CreditStatus } from '../schemas/credit.schema';

const DAY_IN_MS = 24 * 60 * 60 * 1_000;

@Injectable()
export class CreditNotificationService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private expiryScanTimer?: NodeJS.Timeout;
  private readonly creditUsageThresholds: number[];
  private readonly creditExpiryThresholds: number[];

  constructor(
    private readonly creditRepository: CreditRepository,
    private readonly appRepository: AppRepository,
    private readonly userRepository: UserRepository,
    private readonly mailNotificationService: MailNotificationService,
    private readonly configService: ConfigService,
  ) {
    this.creditExpiryThresholds =
      this.configService
        .get<string>('CREDIT_EXPIRY_THRESHOLDS')
        ?.split(',')
        .map((threshold) => Number(threshold.trim()))
        .filter((threshold) => !isNaN(threshold))
        .sort((a, b) => b - a) ?? [];
    this.creditUsageThresholds =
      this.configService
        .get<string>('CREDIT_USAGE_THRESHOLDS')
        ?.split(',')
        .map((threshold) => Number(threshold.trim()))
        .filter((threshold) => !isNaN(threshold))
        .sort((a, b) => a - b) ?? [];
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.scanExpiringCredits();
    this.scheduleNextExpiryScan();
  }

  onApplicationShutdown(): void {
    if (this.expiryScanTimer) clearTimeout(this.expiryScanTimer);
  }

  async notifyUsageThreshold(plan: CreditPlan): Promise<void> {
    if (plan.apiCredit.total <= 0) return;

    const usedPercentage = Math.floor(
      (plan.apiCredit.used / plan.apiCredit.total) * 100,
    );
    const threshold = [...this.creditUsageThresholds]
      .reverse()
      .find((value) => usedPercentage >= value);
    if (threshold === undefined) return;

    const planId = this.planId(plan);
    const claimedPlan = await this.creditRepository.findOneAndUpdate(
      {
        _id: planId,
        $or: [
          { 'notification.lastNotifiedUsageThreshold': { $exists: false } },
          { 'notification.lastNotifiedUsageThreshold': { $lt: threshold } },
        ],
      },
      { $set: { 'notification.lastNotifiedUsageThreshold': threshold } },
    );
    if (!claimedPlan) return;

    const recipient = await this.resolveRecipient(plan.serviceId);
    if (!recipient) return;

    await this.mailNotificationService.addAJob(
      {
        to: recipient.to,
        ...(recipient.cc.length && { cc: recipient.cc }),
        subject: `⚠️ Credit Usage Alert for Service ${plan.serviceId}`,
        message: getCreditUsageAlertMail(
          plan.serviceId,
          usedPercentage,
          threshold,
          plan.apiCredit.total,
          plan.apiCredit.used,
          plan.expiresAt?.toISOString(),
          recipient.isSuperAdminNotification,
        ),
      },
      JobNames.SEND_CREDIT_USAGE_NOTIFICATION,
    );
  }

  async notifyAllowanceUsageThreshold(plan: CreditPlan): Promise<void> {
    if (plan.serviceType !== SERVICE_TYPES.SSI_API) return;

    const allowance = plan.onChainAllowance;
    if (!allowance || allowance.amount <= 0) return;

    const usedAmount = allowance.usedAmount ?? 0;
    const usedPercentage = Math.floor((usedAmount / allowance.amount) * 100);
    const threshold = [...this.creditUsageThresholds]
      .reverse()
      .find((value) => usedPercentage >= value);
    if (threshold === undefined) return;

    const planId = this.planId(plan);
    const claimedPlan = await this.creditRepository.findOneAndUpdate(
      {
        _id: planId,
        $or: [
          {
            'notification.lastNotifiedAllowanceUsageThreshold': {
              $exists: false,
            },
          },
          {
            'notification.lastNotifiedAllowanceUsageThreshold': {
              $lt: threshold,
            },
          },
        ],
      },
      {
        $set: {
          'notification.lastNotifiedAllowanceUsageThreshold': threshold,
        },
      },
    );
    if (!claimedPlan) return;

    const recipient = await this.resolveRecipient(plan.serviceId);
    if (!recipient?.isSuperAdminNotification) return;

    await this.mailNotificationService.addAJob(
      {
        to: recipient.to,
        ...(recipient.cc.length && { cc: recipient.cc }),
        subject: `⚠️ Allowance Usage Alert for Service ${plan.serviceId}`,
        message: getAllowanceUsageAlertMail(
          plan.serviceId,
          usedPercentage,
          allowance.amount,
          usedAmount,
          allowance.denom,
          plan.expiresAt?.toISOString(),
        ),
      },
      JobNames.SEND_CREDIT_USAGE_NOTIFICATION,
    );
  }

  async scanExpiringCredits(): Promise<void> {
    const now = new Date();
    const plans = await this.creditRepository.findCreditDetailList({
      status: CreditStatus.ACTIVE,
      expiresAt: {
        $exists: true,
        $lte: new Date(
          now.getTime() + this.creditExpiryThresholds[0] * DAY_IN_MS,
        ),
      },
    });

    for (const plan of plans) {
      if (!plan.expiresAt) continue;
      const remainingDays = Math.max(
        0,
        Math.ceil((plan.expiresAt.getTime() - now.getTime()) / DAY_IN_MS),
      );
      const threshold = this.creditExpiryThresholds
        .filter((value) => remainingDays <= value)
        .pop();
      if (threshold === undefined) continue;

      const claimedPlan = await this.creditRepository.findOneAndUpdate(
        {
          _id: this.planId(plan),
          $or: [
            { 'notification.expiryThresholdsSent': { $exists: false } },
            { 'notification.expiryThresholdsSent': { $gt: threshold } },
          ],
        },
        { $set: { 'notification.expiryThresholdsSent': threshold } },
      );
      if (!claimedPlan) continue;

      const recipient = await this.resolveRecipient(plan.serviceId);
      if (!recipient) continue;

      await this.mailNotificationService.addAJob(
        {
          to: recipient.to,
          ...(recipient.cc.length && { cc: recipient.cc }),
          subject:
            threshold === 0
              ? `🚨 Credits Expired for Service ${plan.serviceId}`
              : `⏳ Credits Expiring Soon for Service ${plan.serviceId}`,
          message: getCreditExpiryAlertMail(
            plan.serviceId,
            remainingDays,
            plan.apiCredit.total,
            plan.apiCredit.used,
            plan.expiresAt.toISOString(),
            recipient.isSuperAdminNotification,
          ),
        },
        JobNames.SEND_CREDIT_USAGE_NOTIFICATION,
      );
    }
  }

  private async resolveRecipient(serviceId: string): Promise<{
    to: string;
    cc: string[];
    isSuperAdminNotification: boolean;
  } | null> {
    const app = await this.appRepository.findOne({ appId: serviceId });
    const isSsiService = app?.services?.some(
      (service) => service.id === SERVICE_TYPES.SSI_API,
    );

    if (isSsiService) {
      const superAdmins = await this.userRepository.find(
        { role: UserRole.SUPER_ADMIN },
        { email: 1, _id: 0 },
      );
      const emails = superAdmins.map((user) => user.email).filter(Boolean);
      if (!emails.length) {
        Logger.warn(`No super-admin recipient found for ${serviceId}`);
        return null;
      }
      return {
        to: emails[0],
        cc: emails.slice(1),
        isSuperAdminNotification: true,
      };
    }

    const result = await this.appRepository.findAppsByPipeline([
      { $match: { appId: serviceId } },
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: 'userId',
          as: 'userDetails',
        },
      },
      { $unwind: '$userDetails' },
      { $project: { _id: 0, adminEmail: '$userDetails.email' } },
    ]);
    const email = result[0]?.adminEmail;
    if (!email) {
      Logger.warn(`No admin recipient found for ${serviceId}`);
      return null;
    }
    return { to: email, cc: [], isSuperAdminNotification: false };
  }

  private planId(plan: CreditPlan): string {
    return String((plan as unknown as { _id: unknown })._id);
  }

  private scheduleNextExpiryScan(): void {
    const now = new Date();
    const nextMidnightUtc = new Date(now);
    nextMidnightUtc.setUTCHours(24, 0, 0, 0);
    this.expiryScanTimer = setTimeout(async () => {
      try {
        await this.scanExpiringCredits();
      } catch (error) {
        Logger.error('Daily credit expiry scan failed', error);
      } finally {
        this.scheduleNextExpiryScan();
      }
    }, nextMidnightUtc.getTime() - now.getTime());
  }
}
