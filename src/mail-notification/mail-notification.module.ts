import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MailNotificationService } from './services/mail-notification.service';
import * as dotenv from 'dotenv';
import { CreditNotificationProcessor } from './services/mail-queue-processor';
import { AppAuthModule } from 'src/app-auth/app-auth.module';
import { UserModule } from 'src/user/user.module';
dotenv.config();
@Module({
  imports: [
    AppAuthModule,
    UserModule,
    BullModule.registerQueue({
      name: process.env.MAIL_QUEUE || 'Entity-Dashboard-Mail-Queue',
    }),
    BullModule.registerQueue({
      name:
        process.env.DASHBOARD_CREDIT_USAGE_NOTIFICATION_QUEUE ||
        'Credit-Usage-Notification-Queue',
    }),
    BullModule.forRoot({
      connection: {
        host:
          process.env.REDIS_HOST ||
          'redis-stack-service.hypermine-development.svc.cluster.local',
        port: 6379,
      },
    }),
  ],
  providers: [MailNotificationService, CreditNotificationProcessor],
  exports: [MailNotificationService],
})
export class MailNotificationModule {}
