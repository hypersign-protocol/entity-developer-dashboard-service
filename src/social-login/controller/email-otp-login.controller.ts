import { Body, Controller, Logger, Post, UseFilters } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { AllExceptionsFilter } from 'src/utils/utils';
import { GenerateEmailOtpDto } from '../dto/generate-email-otp.dto';
import { EmailOtpLoginService } from '../services/email-otp-login.service';
@UseFilters(AllExceptionsFilter)
@ApiTags('Authentication')
@Controller('/api/v1/auth/otp')
export class EmailOtpLoginController {
  constructor(
    private readonly config: ConfigService,
    private readonly emailOtpService: EmailOtpLoginService,
  ) {}
  @Post('generate')
  async generateEmailOtp(@Body() body: GenerateEmailOtpDto) {
    Logger.log('generateEmailOtp() method starts', 'EmailOtpLoginController');
    return this.emailOtpService.generateEmailOtp(body);
  }
}
