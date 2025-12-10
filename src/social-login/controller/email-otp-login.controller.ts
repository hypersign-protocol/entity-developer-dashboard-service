import {
  BadRequestException,
  Body,
  Controller,
  Logger,
  Post,
  Req,
  Res,
  UseFilters,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AllExceptionsFilter, getCookieOptions } from 'src/utils/utils';
import {
  GenerateEmailOtpDto,
  GenerateEmailOtpResponse,
  VerifyEmailOtpDto,
} from '../dto/generate-email-otp.dto';
import { EmailOtpLoginService } from '../services/email-otp-login.service';
import { AppError } from 'src/app-auth/dtos/fetch-app.dto';
import { Request } from 'express';
import { SocialLoginService } from '../services/social-login.service';
import { UnauthorizedError } from '../dto/response.dto';
import { COOKIE_CONFIG as TOKEN } from 'src/utils/time-constant';
@UseFilters(AllExceptionsFilter)
@ApiTags('Authentication')
@Controller('/api/v1/auth/email/otp')
export class EmailOtpLoginController {
  constructor(
    private readonly config: ConfigService,
    private readonly emailOtpService: EmailOtpLoginService,
    private readonly socialLoginService: SocialLoginService,
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
  @Post('request')
  async generateEmailOtp(@Body() body: GenerateEmailOtpDto) {
    Logger.log('generateEmailOtp() method starts', 'EmailOtpLoginController');
    return this.emailOtpService.generateEmailOtp(body);
  }

  @ApiBadRequestResponse({
    status: 400,
    type: AppError,
  })
  @ApiUnauthorizedResponse({
    status: 401,
    type: UnauthorizedError,
  })
  @Post('verify')
  async verifyEmailOtp(
    @Body() body: VerifyEmailOtpDto,
    @Req() req: Request,
    @Res() res,
  ) {
    Logger.log('verifyEmailOtp() method starts', 'EmailOtpLoginController');
    const email = await this.emailOtpService.verifyEmailOtp(body);
    req['user'] = { email };
    const cookieDomain = this.config.get<string>('COOKIE_DOMAIN');
    Logger.debug(
      `Cookied domain set is ${cookieDomain}`,
      'EmailOtpLoginController',
    );
    try {
      const result = await this.socialLoginService.socialLogin(req);
      if (result.isMfaRequired) {
        res.redirect(this.config.get('MFA_REDIRECT_URL'));
      }
      res.cookie(
        TOKEN.AUTH.name,
        result.accessToken,
        getCookieOptions(TOKEN.AUTH.expiry),
      );
      res.cookie(
        TOKEN.REFRESH.name,
        result.refreshToken,
        getCookieOptions(TOKEN.REFRESH.expiry),
      );
      res.redirect(`${this.config.get('REDIRECT_URL')}`);
    } catch (err) {
      Logger.error(`Login failed: ${err.message}`, 'EmailOtpLoginController');
      throw new BadRequestException(['Failed to complete login']);
    }
  }
}
