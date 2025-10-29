import { Body, Controller, Logger, Post, UseFilters } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBadRequestResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AllExceptionsFilter } from 'src/utils/utils';
import {
  GenerateEmailOtpDto,
  GenerateEmailOtpResponse,
} from '../dto/generate-email-otp.dto';
import { EmailOtpLoginService } from '../services/email-otp-login.service';
import { AppError } from 'src/app-auth/dtos/fetch-app.dto';
@UseFilters(AllExceptionsFilter)
@ApiTags('Authentication')
@Controller('/api/v1/auth/otp')
export class EmailOtpLoginController {
  constructor(
    private readonly config: ConfigService,
    private readonly emailOtpService: EmailOtpLoginService,
  ) {}
  @ApiOkResponse({
    status: 200,
    description: 'Auth url',
    type: GenerateEmailOtpResponse,
  })
  @ApiBadRequestResponse({
    status: 400,
    type: AppError,
  })
  @Post('generate')
  async generateEmailOtp(@Body() body: GenerateEmailOtpDto) {
    Logger.log('generateEmailOtp() method starts', 'EmailOtpLoginController');
    return this.emailOtpService.generateEmailOtp(body);
  }
}
