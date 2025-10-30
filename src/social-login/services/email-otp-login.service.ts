import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import { MailNotificationService } from 'src/mail-notification/services/mail-notification.service';
import { redisClient } from 'src/utils/redis.provider';
import {
  GenerateEmailOtpDto,
  VerifyEmailOtpDto,
} from '../dto/generate-email-otp.dto';
import getEmailOtpMail from 'src/mail-notification/constants/templates/email-otp.template';
import { ConfigService } from '@nestjs/config';
import { JobNames, TIME } from 'src/utils/time-constant';
@Injectable()
export class EmailOtpLoginService {
  constructor(
    private readonly mailNotificationService: MailNotificationService,
    private readonly config: ConfigService,
  ) { }

  /**
   * Generates and sends a one-time email OTP.
   * Checks cooldown and hourly request limits, stores the OTP in Redis,
   * and sends it to the user's email.
   *
   * @param generateEmailOtpDto - Object containing the user's email
   * @returns Confirmation message that OTP was sent
   * @throws BadRequestException if cooldown or hourly limit is exceeded
   */
  async generateEmailOtp(generateEmailOtpDto: GenerateEmailOtpDto) {
    const { email } = generateEmailOtpDto;
    Logger.log(
      `generateEmailOtp(): Generating OTP for ${email}`,
      'EmailOtpLoginService',
    );
    const otpCoolDownMinute = this.config.get<number>(
      'OTP_COOLDOWN_MINUTES',
      1,
    );
    const OtpExpiryMinute = this.config.get<number>('OTP_EXPIRY_MINUTES', 5);
    const cooldownKey = `otp:cooldown:${email}`;
    const cooldownExists = await redisClient.exists(cooldownKey);
    if (cooldownExists) {
      throw new BadRequestException(
        'Please wait a minute before requesting another OTP',
      );
    }
    // Set cooldown key for 60 seconds
    await redisClient.set(
      cooldownKey,
      '1',
      'EX',
      otpCoolDownMinute * TIME.MINUTE,
    );
    //Check hourly request limit (max 10 per hour)
    const otpHourlyLimit = this.config.get<number>('OTP_HOURLY_LIMIT', 10);
    const countKey = `otp:count:${email}`;
    const count = await redisClient.incr(countKey);
    if (count === 1) {
      await redisClient.expire(countKey, TIME.HOUR);
    }
    if (count > otpHourlyLimit) {
      throw new BadRequestException(
        'Too many OTP requests. Try again after 1 hour',
      );
    }

    // Generate secure 6-character alphanumeric OTP
    const otp = randomBytes(3).toString('hex').toUpperCase();
    // Hash OTP using SHA-256
    const otpHash = createHash('sha256').update(otp).digest('hex');
    const otpKey = `otp:${email}`;
    await redisClient.set(otpKey, otpHash, 'EX', TIME.MINUTE * OtpExpiryMinute);
    const message = getEmailOtpMail(
      otp,
      OtpExpiryMinute,
      'Your One-Time Password (OTP) for Login',
    );
    const subject = 'Your One-Time Password (OTP) for Login';
    await this.sendEmail(email, subject, message);
    return { message: 'OTP sent successfully' };
  }
  /**
   * Adds an email sending job to the mail queue.
   *
   * @param email - Recipient's email address
   * @param subject - Subject of the email
   * @param message - Email body/content
   *
   */
  private sendEmail(email: string, subject: string, message: any): void {
    this.mailNotificationService.addAJob(
      {
        to: email,
        subject,
        message,
      },
      JobNames.SEND_EMAIL_LOGIN_OTP,
    );
  }
  /**
   * Verifies the email OTP for the given email.
   * Checks the OTP against Redis, tracks invalid attempts,
   * and deletes the OTP after successful verification.
   *
   * @param verifyOtpDto - Object containing `email` and `otp`
   * @returns The verified email if OTP is valid
   * @throws BadRequestException if OTP is expired or missing
   * @throws UnauthorizedException if OTP is invalid
   */
  async verifyEmailOtp(verifyOtpDto: VerifyEmailOtpDto) {
    Logger.log(
      'Inside verifyEmailOtp() to verify email otp',
      'EmailOtpLoginService',
    );
    const { email, otp } = verifyOtpDto;
    const otpKey = `otp:${email}`;
    const attemptsKey = `otp:attempts:${email}`;
    const storedHash = await redisClient.get(otpKey);
    if (!storedHash) {
      throw new BadRequestException('OTP expired');
    }
    const OtpExpiryMinute = this.config.get<number>('OTP_EXPIRY_MINUTES', 5);
    const maxAttempts = this.config.get<number>('MAX_RETRIE_ATTEMPT', 3);
    const providedHash = createHash('sha256').update(otp).digest('hex');
    const isValid = timingSafeEqual(
      Buffer.from(storedHash),
      Buffer.from(providedHash),
    );
    if (!isValid) {
      const currentAttempts = (await redisClient.get(attemptsKey)) || '0';
      const attemptsCount = parseInt(currentAttempts, 10) + 1;
      if (attemptsCount >= maxAttempts) {
        await redisClient.del(otpKey);
        await redisClient.del(attemptsKey);
      } else {
        await redisClient.set(
          attemptsKey,
          attemptsCount.toString(),
          'EX',
          OtpExpiryMinute * TIME.MINUTE,
        );
      }
      throw new UnauthorizedException('Invalid OTP');
    }
    // OTP is valid → delete it (one-time use if success)
    await redisClient.del(otpKey);
    await redisClient.del(attemptsKey);
    return email;
  }
}
