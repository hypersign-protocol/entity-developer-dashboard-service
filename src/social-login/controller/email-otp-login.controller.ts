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
  VerifyEmailOtpResponseDto,
} from '../dto/generate-email-otp.dto';
import { EmailOtpLoginService } from '../services/email-otp-login.service';
import { AppError } from 'src/app-auth/dtos/fetch-app.dto';
import { Request } from 'express';
import { SocialLoginService } from '../services/social-login.service';
import { UnauthorizedError } from '../dto/response.dto';
import {
  InSecureCookie,
  COOKIE_CONFIG as TOKEN,
} from 'src/utils/time-constant';
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
  @ApiOkResponse({
    description: 'Email otp verified successfully',
    type: VerifyEmailOtpResponseDto,
  })
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
    const detail = await this.emailOtpService.verifyEmailOtp(body);
    req['user'] = { email: detail.email };
    const cookieDomain = this.config.get<string>('COOKIE_DOMAIN');
    Logger.debug(
      'EmailOtpLoginController: cookie domain configured',
      'EmailOtpLoginController',
    );
    try {
      const result = await this.socialLoginService.socialLogin(req);
      if (result.isMfaRequired) {
        return res.json({
          verified: detail.verified,
          isMfaRequired: result.isMfaRequired,
          authenticators: result.authenticators,
          sessionId: result.sessionId,
        });
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
      res.cookie(InSecureCookie.name, 'true', {
        httpOnly: InSecureCookie.httpOnly,
        maxAge: InSecureCookie.expiry,
      });
      res.json({
        verified: detail.verified,
        isMfaRequired: result.isMfaRequired,
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      Logger.error(
        'Login failed while completing email OTP login',
        error.stack,
        'EmailOtpLoginController',
      );
      throw new BadRequestException(['Failed to complete login.']);
    }
  }
}
