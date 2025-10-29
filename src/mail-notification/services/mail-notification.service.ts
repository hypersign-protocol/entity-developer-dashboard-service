import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import TeammateTemplate from '../constants/teamMateInvitationTemplate';
import { CreateMailNotificationDto } from '../dto/create-mail-notification.dto';
@Injectable()
export class MailNotificationService {
  constructor(
    @InjectQueue('Entity-Dashboard-Mail-Queue')
    private readonly mailQueue: Queue,
    private readonly config: ConfigService,
  ) {}
  async addJobToMailQueue({
    mailName,
    teamMateMailId,
    adminEmailId,
    mailSubject,
    inviteLink,
  }: CreateMailNotificationDto) {
    Logger.log(
      'addJobsToMailQueue(): to store and add jobs to mailQueue',
      'MailNotificationService',
    );
    let tempMailTemplate = TeammateTemplate;
    tempMailTemplate = tempMailTemplate.replace(
      '@@SenderEmailId@@',
      adminEmailId,
    );
    tempMailTemplate = tempMailTemplate.replace(
      '@@InviteeName@@',
      teamMateMailId.split('@')[0],
    );
    tempMailTemplate = tempMailTemplate.replace('@@InviteLink@@', inviteLink);
    const mailStructure = {
      name: mailName,
      data: {
        serverName: this.config.get('SERVER_NAME'),
        to: teamMateMailId,
        subject: mailSubject,
        message: tempMailTemplate,
      },
    };
    await this.mailQueue.add(mailStructure.name, mailStructure.data);
  }

  async addAJob(
    job: { to: string; subject: string; message: any },
    name: string,
  ) {
    try {
      Logger.debug('Inside addAJob function.....');
      job['serverName'] = this.config.get('SERVER_NAME');
      await this.mailQueue.add(name, job);
      Logger.debug('a jobs is added in the queue');
    } catch (e) {
      Logger.log(e);
    }
  }
}
