import {
  Controller,
  Get,
  UseGuards,
  Req,
  Logger,
  UseFilters,
  Post,
  Res,
  Body,
  Delete,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { SocialLoginService } from '../services/social-login.service';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiExcludeEndpoint,
  ApiOkResponse,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AllExceptionsFilter, getCookieOptions } from 'src/utils/utils';
import { ConfigService } from '@nestjs/config';
import {
  AuthResponse,
  DeleteMFARespDto,
  Generate2FARespDto,
  LoginResponse,
  LogoutRespDto,
  UnauthorizedError,
  Verify2FARespDto,
} from '../dto/response.dto';
import {
  DeleteMFADto,
  Generate2FA,
  LoginMFACodeVerificationDto,
  MFACodeVerificationDto,
} from '../dto/request.dto';
import { AppError } from 'src/app-auth/dtos/fetch-app.dto';
import { UserRole } from 'src/user/schema/user.schema';
import { ERROR_MESSAGE, ERROR_MESSAGE as MFA_MESSAGE } from '../constants/en';
import {
  InSecureCookie,
  COOKIE_CONFIG as TOKEN,
} from 'src/utils/time-constant';
@UseFilters(AllExceptionsFilter)
@ApiTags('Authentication')
@Controller('api/v1')
export class SocialLoginController {
  constructor(
    private readonly socialLoginService: SocialLoginService,
    private readonly config: ConfigService,
  ) {}
  @ApiResponse({
    status: 200,
    description: 'Auth url',
    type: LoginResponse,
  })
  @ApiUnauthorizedResponse({
    status: 401,
    type: UnauthorizedError,
  })
  @Get('auth/google/authorize')
  async socialAuthRedirect(@Res() res) {
    Logger.log('socialAuthRedirect() method starts', 'SocialLoginController');
    const provider = 'google';
    Logger.log(`Looged in with ${provider}`, 'SocialLoginController');
    const { authUrl } = await this.socialLoginService.generateAuthUrlByProvider(
      provider,
    );
    res.json({ authUrl });
  }
  @ApiExcludeEndpoint()
  @Get('auth/google/callback')
  @UseGuards(AuthGuard('google'))
  async socialAuthCallback(@Req() req, @Res() res) {
    Logger.log('socialAuthCallback() method starts', 'SocialLoginController');
    const result = await this.socialLoginService.socialLogin(req);
    if (result.isMfaRequired) {
      const arrayString = encodeURIComponent(
        JSON.stringify(result.authenticators),
      );
      res.cookie(
        InSecureCookie.name,
        'true',
        getCookieOptions(InSecureCookie.expiry, false, InSecureCookie.httpOnly),
      );
      return res.redirect(
        `${this.config.get(
          'MFA_REDIRECT_URL',
        )}?authenticators=${arrayString}&sessionId=${result.sessionId}`,
      );
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
    res.cookie(
      InSecureCookie.name,
      'true',
      getCookieOptions(InSecureCookie.expiry, false, InSecureCookie.httpOnly),
    );
    res.redirect(`${this.config.get('REDIRECT_URL')}`);
  }
  @ApiBearerAuth('Authorization')
  @ApiOkResponse({
    description: 'User Info',
    type: AuthResponse,
  })
  @ApiUnauthorizedResponse({
    status: 401,
    type: UnauthorizedError,
  })
  @Post('users/me')
  dispatchUserDetail(@Req() req) {
    Logger.log('dispatchUserDetail() method starts', 'SocialLoginController');
    const userDetail = req.user;
    if (
      userDetail &&
      userDetail.authenticators &&
      userDetail.authenticators.length > 0
    ) {
      const authenticator = userDetail.authenticators.map(
        ({ secret, ...rest }) => rest,
      );
      userDetail.authenticators = authenticator;
      userDetail.role = userDetail.role || UserRole.ADMIN;
      userDetail;
    }
    return {
      status: 200,
      message: userDetail,
      error: null,
    };
  }
  @ApiBearerAuth('Authorization')
  @Post('auth/tokens/refresh')
  async refreshTokenGeneration(@Req() req, @Res() res) {
    const refreshToken = req.cookies['refreshToken'];
    if (!refreshToken) {
      throw new UnauthorizedException(['Missing refresh token']);
    }
    const tokens = await this.socialLoginService.verifyAndGenerateRefreshToken(
      refreshToken,
    );
    if (tokens.error) {
      return res.status(401).json({
        statusCode: 401,
        message: [tokens.error],
        error: 'Unauthorized',
      });
    }

    res.cookie(
      TOKEN.AUTH.name,
      tokens.accessToken,
      getCookieOptions(TOKEN.AUTH.expiry),
    );
    res.cookie(
      TOKEN.REFRESH.name,
      tokens.refreshToken,
      getCookieOptions(TOKEN.REFRESH.expiry),
    );
    res.cookie(
      InSecureCookie.name,
      'true',
      getCookieOptions(InSecureCookie.expiry, false, InSecureCookie.httpOnly),
    );
    res.json({ message: 'Tokens refreshed' });
  }

  @ApiOkResponse({
    description: 'Generated QR successfully',
    type: Generate2FARespDto,
  })
  @ApiUnauthorizedResponse({
    status: 401,
    type: UnauthorizedError,
  })
  @ApiBearerAuth('Authorization')
  @Post('auth/mfa/setup/generate')
  async generateMfa(@Req() req, @Body() body: Generate2FA) {
    const result = await this.socialLoginService.generate2FA(body, req.user);
    return { twoFADataUrl: result };
  }

  @ApiOkResponse({
    description: 'Verified MFA code and generated new token',
    type: Verify2FARespDto,
  })
  @ApiUnauthorizedResponse({
    status: 401,
    type: UnauthorizedError,
  })
  @ApiBearerAuth('Authorization')
  @Post('auth/mfa/login/verify')
  async verifyMFA(
    @Body() mfaVerificationDto: LoginMFACodeVerificationDto,
    @Res() res,
  ) {
    const data = await this.socialLoginService.verifyMFACode(
      mfaVerificationDto,
    );
    if (data.isVerified) {
      res.cookie(
        TOKEN.AUTH.name,
        data.accessToken,
        getCookieOptions(TOKEN.AUTH.expiry),
      );
      res.cookie(
        TOKEN.REFRESH.name,
        data.refreshToken,
        getCookieOptions(TOKEN.REFRESH.expiry),
      );
      res.cookie(
        InSecureCookie.name,
        'true',
        getCookieOptions(InSecureCookie.expiry, false, InSecureCookie.httpOnly),
      );
    }

    res.json({ isVerified: data.isVerified });
  }
  @ApiOkResponse({
    description: 'Removed MFA successfully',
    type: DeleteMFARespDto,
  })
  @ApiBadRequestResponse({
    status: 400,
    type: AppError,
  })
  @ApiUnauthorizedResponse({
    status: 401,
    type: UnauthorizedError,
  })
  @ApiBearerAuth('Authorization')
  @Delete('auth/mfa')
  async removeMFA(@Req() req, @Body() mfaremoveDto: DeleteMFADto) {
    return this.socialLoginService.removeMFA(req.user, mfaremoveDto);
  }
  @ApiOkResponse({
    description: 'User is Logged out successfully',
    type: LogoutRespDto,
  })
  @ApiBadRequestResponse({
    status: 400,
    type: AppError,
  })
  @ApiUnauthorizedResponse({
    status: 401,
    type: UnauthorizedError,
  })
  @ApiBearerAuth('Authorization')
  @Post('auth/logout')
  async logout(@Req() req, @Res() res) {
    const refreshToken = req.cookies[TOKEN.REFRESH.name];
    const result = await this.socialLoginService.logout(
      refreshToken,
      req.session,
    );
    if (!result.success) {
      throw new BadRequestException([ERROR_MESSAGE.LOGOUT_ISSUE]);
    }
    res.clearCookie(TOKEN.AUTH.name, getCookieOptions(undefined, true));
    res.clearCookie(TOKEN.REFRESH.name, getCookieOptions(undefined, true));
    res.clearCookie(InSecureCookie.name, getCookieOptions(undefined, true));
    return res.status(200).json({ message: 'Logged out successfully' });
  }

  @ApiOkResponse({
    description: 'Verified MFA code and generated new token',
    type: Verify2FARespDto,
  })
  @ApiUnauthorizedResponse({
    status: 401,
    type: UnauthorizedError,
  })
  @ApiBearerAuth('Authorization')
  @Post('auth/mfa/setup/verify')
  async confirmMfaSetup(
    @Req() req,
    @Body() mfaVerificationDto: MFACodeVerificationDto,
    @Res() res,
  ) {
    const data = await this.socialLoginService.confirmMfaSetup(
      req.user,
      req.session,
      mfaVerificationDto,
    );
    if (!data.isVerified && data?.error === MFA_MESSAGE.SESSION_NOT_FOUND) {
      throw new UnauthorizedException([data.error]);
    }
    if (!data.isVerified) {
      throw new BadRequestException([data.error]);
    }
    res.cookie(
      TOKEN.REFRESH.name,
      data.refreshToken,
      getCookieOptions(TOKEN.REFRESH.expiry),
    );
    res.cookie(
      InSecureCookie.name,
      'true',
      getCookieOptions(InSecureCookie.expiry, false, InSecureCookie.httpOnly),
    );
    return res.json({ isVerified: data.isVerified });
  }
}
