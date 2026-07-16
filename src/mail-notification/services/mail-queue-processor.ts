import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { MailNotificationService } from './mail-notification.service';
import { JobNames } from 'src/utils/time-constant';
import { AppRepository } from 'src/app-auth/repositories/app.repository';
import getCreditUsageAlertMail from '../constants/templates/credit-usage-alert.template';
import getCreditExpiryAlertMail from '../constants/templates/credit-expiry-alert.template';
import { CreditNotificationJobNames } from '../dto/create-mail-notification.dto';
import { UserRepository } from 'src/user/repository/user.repository';
import { UserRole } from 'src/user/schema/user.schema';

export type CreditUsageNotificationJob = {
  serviceId: string;
  totalCredits: number;
  usedCredits: number;
  usedPercentage: number;
  threshold: number;
  expiresAt?: string;
  serverName?: string;
};

export type CreditExpiryNotificationJob = {
  serviceId: string;
  totalCredits: number;
  usedCredits: number;
  expiresAt: string;
  remainingDays: number;
  threshold: number;
  serverName?: string;
};

@Processor(
  process.env.DASHBOARD_CREDIT_USAGE_NOTIFICATION_QUEUE ||
    'Credit-Usage-Notification-Queue',
)
export class CreditNotificationProcessor extends WorkerHost {
  constructor(
    private readonly mailNotificationService: MailNotificationService,
    private readonly appAuthRepository: AppRepository,
    private readonly userRepository: UserRepository
  ) {
    super();
  }

  async process(job: {
    name: string;
    data: CreditUsageNotificationJob | CreditExpiryNotificationJob;
  }) {
    try {
      const { serviceId, serverName } = job?.data;

      let to: string;
      let cc: string[] = [];
      let pipeline: any[];

      if (serverName === 'HYPERSIGN_API_SERVICE') {
        const users = await this.userRepository.find({ role: UserRole.SUPER_ADMIN }, { email: 1, _id: 0 });
        const emails = users.map((u) => u.email).filter(Boolean);
        if (!emails.length) {
          Logger.warn('No SUPER_ADMIN email found');
          return;
        }
        to = emails[0];
        cc = emails.slice(1);
      } else {
        pipeline = [
          {
            $match: { appId: serviceId },
          },
          {
            $lookup: {
              from: 'users',
              localField: 'userId',
              foreignField: 'userId',
              as: 'userDetails',
            },
          },
          {
            $unwind: '$userDetails',
          },
          {
            $project: {
              _id: 0,
              adminEmail: '$userDetails.email',
            },
          },
        ];
        const result = await this.appAuthRepository.findAppsByPipeline(pipeline);
        if (!result?.length) {
          Logger.warn(`Admin email not found for serviceId: ${serviceId}`);
          return;
        }
        to = result[0]?.adminEmail;
      }

      let html: string;
      let subject: string;

      switch (job.name) {
        case CreditNotificationJobNames.CREDIT_USAGE: {
          const {
            totalCredits,
            usedCredits,
            usedPercentage,
            threshold,
            expiresAt,
          } = job.data as CreditUsageNotificationJob;

          html = getCreditUsageAlertMail(
            serviceId,
            usedPercentage,
            threshold,
            totalCredits,
            usedCredits,
            expiresAt,
          );

          subject = `⚠️ Credit Usage Alert for Service ${serviceId}`;
          break;
        }

        case CreditNotificationJobNames.CREDIT_EXPIRY: {
          const { totalCredits, usedCredits, remainingDays, expiresAt } =
            job.data as CreditExpiryNotificationJob;

          html = getCreditExpiryAlertMail(
            serviceId,
            remainingDays,
            totalCredits,
            usedCredits,
            expiresAt,
          );

          subject =
            remainingDays === 0
              ? `🚨 Credits Expired for Service ${serviceId}`
              : `⏳ Credits Expiring Soon for Service ${serviceId}`;

          break;
        }

        default:
          Logger.warn(`Unknown notification job: ${job.name}`);
          return;
      }
      const mailJob = {
        to,
        subject,
        message: html,
        ...(cc.length > 0 && { cc }),
      };
      await this.mailNotificationService.addAJob(
        mailJob,
        JobNames.SEND_CREDIT_USAGE_NOTIFICATION,
      );

      Logger.log(
        `${job.name} processed successfully for serviceId: ${serviceId}`,
      );
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      Logger.error(
        `Failed to process notification: ${job.name}`,
        err.stack,
        'CreditNotificationProcessor',
      );
    }
  }
}
