import {
  Controller,
  Get,
  UseGuards,
  Req,
  Logger,
  UseFilters,
  Post,
  Res,
  Query,
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
  ApiQuery,
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
import { ERROR_MESSAGE as MFA_MESSAGE } from '../constants/en';
import { TOKEN_MAX_AGE, TOKEN } from 'src/utils/time-constant';
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
  @ApiQuery({
    name: 'provider',
    description: 'Authentication provider',
    required: true,
  })
  @Get('auth/google/authorize')
  async socialAuthRedirect(@Res() res, @Query() loginProvider) {
    Logger.log('socialAuthRedirect() method starts', 'SocialLoginController');
    const { provider } = loginProvider;
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
  @Post('auth/login/refresh')
  async generateRefreshToken(@Req() req) {
    return {
      authToken: await this.socialLoginService.socialLogin(req),
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
      'accessToken',
      tokens.accessToken,
      getCookieOptions(TOKEN_MAX_AGE.AUTH_TOKEN),
    );
    res.cookie(
      'refreshToken',
      tokens.refreshToken,
      getCookieOptions(TOKEN_MAX_AGE.REFRESH_TOKEN),
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
    const cookieDomain = this.config.get<string>('COOKIE_DOMAIN');
    const isProduction = this.config.get<string>('NODE_ENV') === 'production';
    res.clearCookie('authToken', {
      path: '/',
      domain: isProduction ? cookieDomain : undefined,
      sameSite: isProduction ? 'None' : 'Lax',
      secure: isProduction,
      httpOnly: true,
    });
    res.clearCookie('refreshToken', {
      path: '/',
      domain: isProduction ? cookieDomain : undefined,
      sameSite: isProduction ? 'None' : 'Lax',
      secure: isProduction,
      httpOnly: true,
    });
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
    return res.json({ isVerified: data.isVerified });
  }
}
