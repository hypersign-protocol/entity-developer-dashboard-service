import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { MailNotificationService } from './mail-notification.service';
import { JobNames } from 'src/utils/time-constant';
import { AppRepository } from 'src/app-auth/repositories/app.repository';
import getCreditUsageAlertMail from '../constants/templates/credit-usage-alert.template';

export type CreditUsageNotificationJob = {
  serviceId: string;
  totalCredits: number;
  usedCredits: number;
  usedPercentage: number;
  threshold: number;
  expiresAt?: string;
};

@Processor(
  process.env.DASHBOARD_CREDIT_USAGE_NOTIFICATION_QUEUE ||
    'Credit-Usage-Notification-Queue',
)
export class CreditUsageNotificationProcessor extends WorkerHost {
  constructor(
    private readonly mailNotificationService: MailNotificationService,
    private readonly appAuthRepository: AppRepository,
  ) {
    super();
  }
  async process(job: { data: CreditUsageNotificationJob }) {
    try {
      const {
        serviceId,
        totalCredits,
        usedCredits,
        usedPercentage,
        threshold,
        expiresAt,
      } = job.data;
      const pipeline = [
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
          $unwind: '$userDetails', // flatten the array
        },
        {
          $project: {
            _id: 0,
            serviceId: 1,
            adminEmail: '$userDetails.email', // only email from user
          },
        },
      ];
      const result = await this.appAuthRepository.findAppsByPipeline(pipeline);
      const adminEmail = result?.[0]?.adminEmail;
      if (!adminEmail) {
        Logger.warn(`Admin email not found for serviceId: ${serviceId}`);
        return;
      }
      const html = getCreditUsageAlertMail(
        serviceId,
        usedPercentage,
        threshold,
        totalCredits,
        usedCredits,
        expiresAt,
      );

      // Prepare mail job
      await this.mailNotificationService.addAJob(
        {
          to: adminEmail,
          subject: `⚠️ Credit Usage Alert for Service ${serviceId}`,
          message: html,
        },
        JobNames.SEND_CREDIT_USAGE_NOTIFICATION,
      );

      Logger.log(
        `Credit usage notification processed for serviceId: ${serviceId}`,
      );
    } catch (error) {
      Logger.error(
        'Failed to process credit usage notification',
        error?.stack || error,
      );
    }
  }
}
