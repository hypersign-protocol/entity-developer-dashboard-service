import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { UserRepository } from 'src/user/repository/user.repository';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { v4 as uuidv4 } from 'uuid';
import { Providers } from '../strategy/social.strategy';
import { sanitizeUrl } from 'src/utils/utils';
import { SupportedServiceList } from 'src/supported-service/services/service-list';
import { SERVICE_TYPES } from 'src/supported-service/services/iServiceList';
import { authenticator } from 'otplib';
import { toDataURL } from 'qrcode';
import {
  DeleteMFADto,
  Generate2FA,
  LoginMFACodeVerificationDto,
  MFACodeVerificationDto,
} from '../dto/request.dto';
import { UserDocument, UserRole } from 'src/user/schema/user.schema';
import { redisClient } from 'src/utils/redis.provider';
import { COOKIE_CONFIG, EXPIRY_CONFIG, TIME } from 'src/utils/time-constant';
import { MFA_ERROR, ERROR_MESSAGE, REFRESH_TOKEN_ERROR } from '../constants/en';

@Injectable()
export class SocialLoginService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly supportedServiceList: SupportedServiceList,
  ) {}
  async generateAuthUrlByProvider(provider: string) {
    let authUrl;
    switch (provider) {
      case Providers.google: {
        authUrl = `${
          this.config.get('GOOGLE_AUTH_BASE_URL') ||
          'https://accounts.google.com/o/oauth2/v2/auth'
        }?response_type=code&redirect_uri=${
          this.config.get('GOOGLE_CALLBACK_URL') ||
          sanitizeUrl(
            this.config.get('DEVELOPER_DASHBOARD_SERVICE_PUBLIC_EP'),
          ) + '/api/v1/auth/google/callback'
        }&scope=email%20profile&prompt=select_account&client_id=${this.config.get(
          'GOOGLE_CLIENT_ID',
        )}`;
        break;
      }
      default: {
        throw new BadRequestException(['Invalid provider']);
      }
    }
    return { authUrl };
  }
  async socialLogin(req): Promise<{
    isMfaRequired: boolean;
    refreshToken?: string;
    accessToken?: string;
    authenticators?: string[];
    sessionId?: string;
  }> {
    Logger.log(
      'Inside handleGoogleLogin() to create or fetch user detail based on login',
      'SocialLoginService',
    );
    const { email, name, profileIcon } = req.user;
    let user = await this.userRepository.findOne({
      email,
    });
    if (!user) {
      const userId = `${Date.now()}-${uuidv4()}`;
      user = await this.userRepository.create({
        email,
        userId,
        name,
        profileIcon,
      });
    }
    const updates: Partial<UserDocument> = {};
    if (!user.name) updates.name = name;
    if (!user.profileIcon) updates.profileIcon = profileIcon;
    if (Object.keys(updates).length > 0)
      this.userRepository.findOneUpdate({ email }, updates);

    const { sessionId, activeAuthenticators, isMfaRequired, refreshVersion } =
      await this.createSession(user);

    if (isMfaRequired) {
      return {
        isMfaRequired,
        sessionId,
        authenticators: activeAuthenticators.map((a) => a.type),
      };
    }
    const tokens = await this.generateTokensForSession(
      sessionId,
      user.userId,
      user?.role || UserRole.ADMIN,
      refreshVersion,
    );

    return {
      isMfaRequired,
      sessionId,
      ...tokens,
    };
  }

  async generate2FA(genrate2FADto: Generate2FA, user) {
    Logger.log(
      'Inside generate2FA() method to generate 2FA QRCode',
      'SocialLoginService',
    );
    const { authenticatorType } = genrate2FADto;
    if (!user.authenticators) {
      user.authenticators = [];
    }

    let secret: string;
    const existingAuthenticator = user.authenticators?.find(
      (auth) => auth.type === authenticatorType,
    );

    if (existingAuthenticator) {
      secret = existingAuthenticator.secret;
    } else {
      secret = authenticator.generateSecret(20);
      user.authenticators.push({
        type: authenticatorType,
        secret,
        isTwoFactorAuthenticated: false,
      });
      this.userRepository.findOneUpdate(
        { userId: user.userId },
        { authenticators: user.authenticators },
      );
    }
    const issuer = this.config.get('MFA_ISSUER');
    const otpAuthUrl = authenticator.keyuri(user.email, issuer, secret);
    return toDataURL(otpAuthUrl);
  }
  async verifyMFACode(
    mfaVerificationDto: LoginMFACodeVerificationDto,
  ): Promise<{
    isVerified: boolean;
    accessToken?: string;
    refreshToken?: string;
  }> {
    Logger.log(
      'Inside verifyMFACode() method to verify MFA code',
      'SocialLoginService',
    );

    const { authenticatorType, twoFactorAuthenticationCode, sessionId } =
      mfaVerificationDto;
    const sessionKey = `session:${sessionId}`;
    const sessionDetailJson = await redisClient.get(sessionKey);
    if (!sessionDetailJson) {
      throw new BadRequestException(['Invalid or expired sessionId']);
    }
    const sessionDetail = JSON.parse(sessionDetailJson);
    if (sessionDetail?.isTwoFactorVerified) {
      throw new BadRequestException([MFA_ERROR.MFA_ALREADY_VERIFIED]);
    }
    const authenticatorDetail = sessionDetail.authenticators.find(
      (auth) => auth.type === authenticatorType,
    );
    if (!authenticatorDetail) {
      throw new BadRequestException([MFA_ERROR.INVALID_MFA_METHOD]);
    }
    sessionDetail.twoFactorRetryCount = sessionDetail.twoFactorRetryCount ?? 0;
    const isVerified = authenticator.verify({
      token: twoFactorAuthenticationCode,
      secret: authenticatorDetail.secret,
    });
    const maxRetryAttempts = this.config.get<number>(
      'MAX_MFA_RETRY_ATTEMPT',
      3,
    );

    if (!isVerified) {
      sessionDetail.twoFactorRetryCount++;
      if (sessionDetail.twoFactorRetryCount > maxRetryAttempts) {
        await redisClient.del(sessionKey);
        throw new BadRequestException([MFA_ERROR.MFA_MAX_RETRY_EXCEEDED]);
      }
      await redisClient.set(
        sessionKey,
        JSON.stringify(sessionDetail),
        'EX',
        EXPIRY_CONFIG.LOGIN.redisExpiryTime,
      );
      return { isVerified: false };
    }
    delete sessionDetail?.authenticators;
    delete sessionDetail.twoFactorRetryCount;
    sessionDetail.isTwoFactorVerified = true;
    sessionDetail.isTwoFactorAuthenticated =
      sessionDetail.isTwoFactorAuthenticated;
    await redisClient.set(
      sessionKey,
      JSON.stringify(sessionDetail),
      'EX',
      TIME.WEEK,
    );
    const tokens = await this.generateTokensForSession(
      sessionId,
      sessionDetail.userId,
      sessionDetail.role,
      sessionDetail.refreshVersion,
    );
    return {
      isVerified,
      ...tokens,
    };
  }

  async removeMFA(user, deleteMfaDto: DeleteMFADto) {
    const {
      twoFactorAuthenticationCode,
      authenticatorToDelete,
      authenticatorType,
    } = deleteMfaDto;
    const authDetail = user.authenticators.find(
      (auth) => auth.type === authenticatorType,
    );
    const isVerified = authenticator.verify({
      token: twoFactorAuthenticationCode,
      secret: authDetail.secret,
    });
    if (!isVerified) {
      throw new BadRequestException([
        "Your passcode doesn't match. Please try again",
      ]);
    }
    const authenticatorIndex = user.authenticators.findIndex(
      (auth) => auth.type === authenticatorToDelete,
    );
    if (authenticatorIndex === -1) {
      throw new NotFoundException([
        `${authenticatorToDelete} Authenticator not found`,
      ]);
    }
    user.authenticators.splice(authenticatorIndex, 1);
    this.userRepository.findOneUpdate(
      { userId: user.userId },
      { authenticators: user.authenticators },
    );
    return { message: 'Removed authenticator successfully' };
  }
  async verifyAndGenerateRefreshToken(
    token: string,
  ): Promise<{ error?: string; accessToken?: string; refreshToken?: string }> {
    try {
      const sessionId = await redisClient.get(`refresh:${token}`);
      if (!sessionId) {
        return { error: REFRESH_TOKEN_ERROR.REFRESH_TOKEN_NOT_FOUND };
      }
      const sessionKey = `session:${sessionId}`;
      const sessionDetail = await redisClient.get(sessionKey);
      if (!sessionDetail) {
        return {
          error: ERROR_MESSAGE.SESSION_NOT_FOUND,
        };
      }
      const sessionJson = JSON.parse(sessionDetail);
      if (sessionJson?.mfaEnabled && !sessionJson?.mfaVerified) {
        return {
          error: MFA_ERROR.MFA_NOT_VERIFIED,
        };
      }
      sessionJson.refreshVersion += 1;
      const user = await this.userRepository.findOne({
        userId: sessionJson.userId,
      });
      if (!user) throw new UnauthorizedException(['User not found']);
      await redisClient.set(
        sessionKey,
        JSON.stringify(sessionJson),
        'EX',
        TIME.WEEK,
      );
      const newToken = await this.generateTokensForSession(
        sessionJson.sessionId,
        user.userId,
        user?.role || UserRole.ADMIN,
        sessionJson.refreshVersion,
      );
      return { ...newToken };
    } catch (e) {
      Logger.error(
        `Error while generating refreshToken ${e}`,
        'SocialLoginService',
      );
      throw new UnauthorizedException([
        REFRESH_TOKEN_ERROR.INVALID_REFRESH_TOKEN,
      ]);
    }
  }
  async generateRefreshToken(payload: any): Promise<string> {
    const tokenSecret = this.config.get('JWT_REFRESH_SECRET');
    if (!tokenSecret) {
      throw new BadRequestException([
        'JWT_REFRESH_SECRET is not set. Please contact the admin',
      ]);
    }
    return this.jwt.signAsync(payload, {
      expiresIn: '7d',
      secret: tokenSecret,
    });
  }

  async generateAuthToken(payload: any, expiry = '4h'): Promise<string> {
    const secret = this.config.get('JWT_SECRET');
    if (!secret) {
      throw new BadRequestException([
        'JWT_SECRET is not set. Please contact the admin',
      ]);
    }
    return this.jwt.signAsync(payload, {
      expiresIn: expiry,
      secret,
    });
  }

  async createSession(user): Promise<{
    sessionId: string;
    activeAuthenticators: any[];
    isMfaRequired: boolean;
    refreshVersion: number;
  }> {
    const sessionId = `${Date.now()}-${uuidv4()}`;
    const role = user?.role || UserRole.ADMIN;
    const activeAuthenticators =
      user.authenticators?.filter(
        (auth) => auth.isTwoFactorAuthenticated === true,
      ) || [];
    const refreshVersion = 1;
    const isMfaRequired = activeAuthenticators.length > 0;
    const sessionData: any = {
      sessionId,
      role,
      refreshVersion: refreshVersion,
      userId: user.userId,
      isTwoFactorVerified: false,
      isTwoFactorAuthenticated: isMfaRequired,
      twoFactorRetryCount: 0,
    };
    if (isMfaRequired) {
      sessionData.authenticators = activeAuthenticators;
    }
    await redisClient.set(
      `session:${sessionId}`,
      JSON.stringify(sessionData),
      'EX',
      TIME.WEEK,
    );
    return { sessionId, activeAuthenticators, isMfaRequired, refreshVersion };
  }

  async generateTokensForSession(sessionId, userId, role, refreshVersion) {
    const rawUrl = this.config.get('INVITATIONURL');
    const domain = new URL(rawUrl).origin;
    const accessToken = await this.generateAuthToken({
      sid: sessionId,
      sub: userId,
      role,
      aud: domain,
      refreshVersion,
    });
    const refreshToken = `${uuidv4()}`;
    await redisClient.set(
      `refresh:${refreshToken}`,
      sessionId,
      'EX',
      TIME.WEEK,
    );
    return { accessToken, refreshToken };
  }
  async confirmMfaSetup(
    user,
    session,
    mfaVerificationDto: MFACodeVerificationDto,
  ): Promise<{ isVerified: boolean; refreshToken?: string; error?: string }> {
    Logger.log(
      'Inside confirmMfaSetup() method to Complete MFA setup',
      'SocialLoginService',
    );
    const { authenticatorType, twoFactorAuthenticationCode } =
      mfaVerificationDto;
    const authenticatorDetail = user.authenticators.find(
      (auth) => auth.type === authenticatorType,
    );
    if (authenticatorDetail.isTwoFactorAuthenticated) {
      return {
        isVerified: false,
        error: MFA_ERROR.MFA_ALREADY_ENABLED,
      };
    }
    const isVerified = authenticator.verify({
      token: twoFactorAuthenticationCode,
      secret: authenticatorDetail.secret,
    });
    if (!isVerified) {
      return { isVerified, error: ERROR_MESSAGE.INVALID_OTP };
    }
    if (!authenticatorDetail.isTwoFactorAuthenticated && isVerified) {
      user.authenticators.map((authn) => {
        if (authn.type === authenticatorType) {
          authn.isTwoFactorAuthenticated = true;
          return authn;
        }
        return authn;
      });
      this.userRepository.findOneUpdate(
        { userId: user.userId },
        { authenticators: user.authenticators },
      );
      const sessionKey = `session:${session.sessionId}`;
      const sessionJson = await redisClient.get(sessionKey);
      if (!sessionJson) {
        return {
          isVerified,
          error: ERROR_MESSAGE.SESSION_NOT_FOUND,
        };
      }
      const sessionObj = JSON.parse(sessionJson);
      sessionObj.isTwoFactorVerifed = true;
      sessionObj.isTwoFactorAuthenticated = true;
      sessionObj.refreshVersion += 1;
      await redisClient.set(
        sessionKey,
        JSON.stringify(sessionObj),
        'EX',
        COOKIE_CONFIG.AUTH.redisExpiryTime,
      );
      const newRefreshToken = uuidv4();
      await redisClient.set(
        `refresh:${newRefreshToken}`,
        session.sid,
        'EX',
        COOKIE_CONFIG.REFRESH.redisExpiryTime,
      );
      return {
        isVerified,
        refreshToken: newRefreshToken,
      };
    }
    return { isVerified };
  }
  async logout(refreshToken, session) {
    try {
      const sessionId = session.sessionId;
      if (sessionId) await redisClient.del(`session:${sessionId}`);
      if (refreshToken) await redisClient.del(`refresh:${refreshToken}`);
      return { success: true };
    } catch (e) {
      Logger.error(
        'Inside logout() to delete data from redis',
        'SocialLoginService',
      );
      return { success: false };
    }
  }
}
