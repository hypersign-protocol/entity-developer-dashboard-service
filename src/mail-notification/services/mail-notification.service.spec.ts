import { Test, TestingModule } from '@nestjs/testing';
import { MailNotificationService } from './mail-notification.service';

describe('MailNotificationService', () => {
  let service: MailNotificationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MailNotificationService],
    })
      // Auto-mock constructor dependencies these smoke tests don't exercise.
      .useMocker(() => ({}))
      .compile();

    service = module.get<MailNotificationService>(MailNotificationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
