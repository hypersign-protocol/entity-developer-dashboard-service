import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MailNotificationService } from './services/mail-notification.service';
@Module({
  imports: [
    BullModule.registerQueue({
      name: 'Entity_Dashboard_Queue',
    }),
  ],
  providers: [MailNotificationService],
  exports: [MailNotificationService],
})
export class MailNotificationModule {}
