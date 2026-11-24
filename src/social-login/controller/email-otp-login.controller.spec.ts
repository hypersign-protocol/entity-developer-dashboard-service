import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { EmailOtpLoginController } from './email-otp-login.controller';
import { EmailOtpLoginService } from '../services/email-otp-login.service';
import { SocialLoginService } from '../services/social-login.service';

jest.mock('src/utils/redis.provider', () => ({ redisClient: {} }));

describe('EmailOtpLoginController validation', () => {
  let app: INestApplication;
  const emailOtpService = {
    generateEmailOtp: jest.fn().mockResolvedValue({ message: 'OTP sent' }),
    verifyEmailOtp: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [EmailOtpLoginController],
      providers: [
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: EmailOtpLoginService, useValue: emailOtpService },
        { provide: SocialLoginService, useValue: {} },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  const domain = (length: number) => {
    // Labels of up to 63 chars joined by dots, ending in ".com".
    const labels: string[] = [];
    let remaining = length - 4;
    while (remaining > 0) {
      const size = Math.min(63, remaining);
      labels.push('b'.repeat(size));
      remaining -= size + 1;
    }
    return labels.join('.') + '.com';
  };
  const emailOfLength = (length: number) => {
    const local = 'a'.repeat(64);
    return `${local}@${domain(length - local.length - 1)}`;
  };

  it('accepts a 254-character email', async () => {
    const email = emailOfLength(254);
    expect(email.length).toBe(254);
    await request(app.getHttpServer())
      .post('/api/v1/auth/email/otp/request')
      .send({ email })
      .expect(201);
    expect(emailOtpService.generateEmailOtp).toHaveBeenCalledWith({ email });
  });

  it.each([
    ['a 255-character email', emailOfLength(255)],
    ['a 65-character local part', `${'a'.repeat(65)}@acme.com`],
    ['a non-email string', 'not-an-email'],
    ['a non-string', { $gt: '' }],
  ])('rejects %s on /request', async (_label, email) => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/email/otp/request')
      .send({ email })
      .expect(400);
    expect(emailOtpService.generateEmailOtp).not.toHaveBeenCalled();
  });

  it('rejects an over-long email on /verify', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/email/otp/verify')
      .send({ email: emailOfLength(255), otp: 'A2CDE3' })
      .expect(400);
    expect(emailOtpService.verifyEmailOtp).not.toHaveBeenCalled();
  });

  it('strips unknown fields', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/email/otp/request')
      .send({ email: 'xyz@acme.com', role: 'SUPER_ADMIN' })
      .expect(201);
    expect(emailOtpService.generateEmailOtp).toHaveBeenCalledWith({
      email: 'xyz@acme.com',
    });
  });
});
