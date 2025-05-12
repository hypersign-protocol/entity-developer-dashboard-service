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
import { AllExceptionsFilter } from 'src/utils/utils';
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
  MFACodeVerificationDto,
} from '../dto/request.dto';
import { AppError } from 'src/app-auth/dtos/fetch-app.dto';
@UseFilters(AllExceptionsFilter)
@ApiTags('Authentication')
@Controller()
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
  @Get('/api/v1/login')
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
  @Get('/api/v1/login/callback')
  @UseGuards(AuthGuard('google'))
  async socialAuthCallback(@Req() req, @Res() res) {
    Logger.log('socialAuthCallback() method starts', 'SocialLoginController');
    const cookieDomain = this.config.get<string>('COOKIE_DOMAIN');
    const tokens = await this.socialLoginService.socialLogin(req);
    Logger.debug(
      `Cookied domain set is ${cookieDomain}`,
      'SocialLoginController',
    );
    res.cookie('authToken', tokens?.authToken, {
      httpOnly: true,
      secure: true,
      domain: cookieDomain,
      maxAge: 4 * 60 * 60 * 1000,
      sameSite: 'None',
      path: '/',
    });
    res.cookie('refreshToken', tokens?.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'None',
      domain: cookieDomain,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });
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
  @Post('/api/v1/auth')
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
    }
    return {
      status: 200,
      message: userDetail,
      error: null,
    };
  }

  @ApiBearerAuth('Authorization')
  @Post('/api/v1/auth/login/refresh')
  async generateRefreshToken(@Req() req) {
    return {
      authToken: await this.socialLoginService.socialLogin(req),
    };
  }
  @ApiBearerAuth('Authorization')
  @Post('/api/v1/auth/refresh')
  async refreshTokenGeneration(@Req() req, @Res() res) {
    const refreshToken = req.cookies['refreshToken'];
    if (!refreshToken) {
      throw new UnauthorizedException('Missing refresh token');
    }
    const tokens = await this.socialLoginService.verifyAndGenerateRefreshToken(
      refreshToken,
    );
    const cookieDomain = this.config.get<string>('COOKIE_DOMAIN');
    res.cookie('authToken', tokens.authToken, {
      httpOnly: true,
      secure: true,
      domain: cookieDomain,
      maxAge: 4 * 60 * 60 * 1000,
      sameSite: 'None',
      path: '/',
    });
    res.cookie('refreshToken', tokens.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'None',
      domain: cookieDomain,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });
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
  @Post('/api/v1/auth/mfa/generate')
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
  @Post('/api/v1/auth/mfa/verify')
  async verifyMFA(
    @Req() req,
    @Body() mfaVerificationDto: MFACodeVerificationDto,
    @Res() res,
  ) {
    const data = await this.socialLoginService.verifyMFACode(
      req.user,
      mfaVerificationDto,
    );
    const cookieDomain = this.config.get<string>('COOKIE_DOMAIN');
    res.cookie('authToken', data?.authToken, {
      httpOnly: true,
      secure: true,
      domain: cookieDomain,
      maxAge: 4 * 60 * 60 * 1000,
      sameSite: 'None',
      path: '/',
    });
    res.cookie('refreshToken', data?.refreshToken, {
      httpOnly: true,
      secure: true,
      domain: cookieDomain,
      maxAge: 7 * 60 * 60 * 1000,
      sameSite: 'None',
      path: '/',
    });
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
  @Delete('/api/v1/auth/mfa')
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
  @Post('/api/v1/auth/logout')
  async logout(@Req() req, @Res() res) {
    const cookieDomain = this.config.get<string>('COOKIE_DOMAIN');
    res.clearCookie('authToken', {
      path: '/',
      domain: cookieDomain,
      sameSite: 'None',
      secure: true,
      httpOnly: true,
    });
    res.clearCookie('refreshToken', {
      path: '/',
      domain: cookieDomain,
      sameSite: 'None',
      secure: true,
      httpOnly: true,
    });
    return res.status(200).json({ message: 'Logged out successfully' });
  }
}
