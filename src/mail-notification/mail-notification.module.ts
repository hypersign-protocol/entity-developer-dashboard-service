import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MailNotificationService } from './services/mail-notification.service';
@Module({
  imports: [
    BullModule.registerQueue({
      name: 'Entity-Dashboard-Mail-Queue',
    }),
    BullModule.forRoot({
      connection: {
        host: 'redis-stack-service.hypermine-development.svc.cluster.local',
        port: 6379,
      },
    }),
  ],
  providers: [MailNotificationService],
  exports: [MailNotificationService],
})
export class MailNotificationModule { }
