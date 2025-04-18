import { Test, TestingModule } from '@nestjs/testing';
import { MailNotificationService } from './mail-notification.service';

describe('MailNotificationService', () => {
  let service: MailNotificationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MailNotificationService],
    }).compile();

    service = module.get<MailNotificationService>(MailNotificationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
