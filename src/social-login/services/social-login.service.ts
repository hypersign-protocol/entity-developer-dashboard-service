import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { UserRepository } from 'src/user/repository/user.repository';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { v4 as uuidv4 } from 'uuid';
import { Providers } from '../strategy/social.strategy';
import { sanitizeUrl } from 'src/utils/utils';
import { SupportedServiceList } from 'src/supported-service/services/service-list';
import { SERVICE_TYPES } from 'src/supported-service/services/iServiceList';
import { AuthneticatorType } from '../dto/response.dto';
import { authenticator } from 'otplib';
import { toDataURL } from 'qrcode';
import {
  DeleteMFADto,
  Generate2FA,
  MFACodeVerificationDto,
} from '../dto/request.dto';
import { UserDocument } from 'src/user/schema/user.schema';

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
          ) + '/api/v1/login/callback'
        }&scope=email%20profile&client_id=${this.config.get(
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

  async socialLogin(req) {
    Logger.log('socialLogin() starts', 'SocialLoginService');
    const { email, name, profileIcon } = req.user;
    const rawUrl = this.config.get('INVITATIONURL');
    const url = new URL(rawUrl);
    const domain = url.origin;
    let userInfo = await this.userRepository.findOne({
      email,
    });
    let appUserID;
    if (!userInfo) {
      appUserID = `${Date.now()}-${uuidv4()}`;
      // Giving default access of services...
      const ssiAccessList = this.supportedServiceList.getDefaultServicesAccess(
        SERVICE_TYPES.SSI_API,
      );
      const kycAccessList = this.supportedServiceList.getDefaultServicesAccess(
        SERVICE_TYPES.CAVACH_API,
      );
      const questAccessList =
        this.supportedServiceList.getDefaultServicesAccess(SERVICE_TYPES.QUEST);
      userInfo = await this.userRepository.create({
        email,
        userId: appUserID,
        name: name,
        profileIcon,
        accessList: [...ssiAccessList, ...kycAccessList, ...questAccessList],
      });
    } else {
      const updates: Partial<UserDocument> = {};
      if (!userInfo.name) updates.name = name;
      if (!userInfo.profileIcon) updates.profileIcon = profileIcon;
      if (Object.keys(updates).length > 0) {
        this.userRepository.findOneUpdate({ email }, updates);
      }
    }
    Logger.log('socialLogin() starts', 'SocialLoginService');

    let isVerified = false;
    let authenticator = null;
    if (userInfo.authenticators && userInfo.authenticators.length > 0) {
      authenticator = userInfo.authenticators?.find((x) => {
        if (x && x.isTwoFactorAuthenticated) {
          return x;
        }
      });
      isVerified = authenticator
        ? authenticator.isTwoFactorAuthenticated
        : false;
    }
    const payload = {
      name,
      email,
      profileIcon,
      appUserID: userInfo.userId,
      userAccessList: userInfo.accessList,
      isTwoFactorEnabled: authenticator ? true : false,
      isTwoFactorAuthenticated: req.user.isTwoFactorAuthenticated
        ? req.user.isTwoFactorAuthenticated
        : false,
      authenticatorType: authenticator?.type,
      domain,
    };
    const secret = this.config.get('JWT_SECRET');
    const token = await this.jwt.signAsync(payload, {
      expiresIn: '24h',
      secret,
    });
    return token;
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
  async verifyMFACode(user, mfaVerificationDto: MFACodeVerificationDto) {
    Logger.log(
      'Inside verifyMFACode() method to verify MFA code',
      'SocialLoginService',
    );
    const { authenticatorType, twoFactorAuthenticationCode } =
      mfaVerificationDto;
    const authenticatorDetail = user.authenticators.find(
      (auth) => auth.type === authenticatorType,
    );
    const isVerified = authenticator.verify({
      token: twoFactorAuthenticationCode,
      secret: authenticatorDetail.secret,
    });
    if (!authenticatorDetail.isTwoFactorAuthenticated && isVerified) {
      // update
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
    }
    const rawUrl = this.config.get('INVITATIONURL');
    const url = new URL(rawUrl);
    const domain = url.origin;
    const payload = {
      email: user.email,
      appUserID: user.userId,
      userAccessList: user.accessList,
      isTwoFactorEnabled: user.authenticators && user.authenticators.length > 0,
      isTwoFactorAuthenticated: isVerified,
      authenticatorType,
      accessAccount: user.accessAccount,
      domain,
    };
    const accessToken = await this.jwt.signAsync(payload, {
      expiresIn: '24h',
      secret: this.config.get('JWT_SECRET'),
    });
    return {
      isVerified,
      authToken: accessToken,
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
      throw new NotFoundException(
        `${authenticatorToDelete} Authenticator not found`,
      );
    }
    user.authenticators.splice(authenticatorIndex, 1);
    this.userRepository.findOneUpdate(
      { userId: user.userId },
      { authenticators: user.authenticators },
    );
    return { message: 'Removed authenticator successfully' };
  }
}
