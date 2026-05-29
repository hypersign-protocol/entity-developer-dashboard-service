import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { authenticator } from 'otplib';
import { SupportedServiceList } from 'src/supported-service/services/service-list';
import { UserRepository } from 'src/user/repository/user.repository';
import { SocialLoginService } from './social-login.service';
import { AuthneticatorType } from '../dto/response.dto';

describe('SocialLoginService', () => {
  let service: SocialLoginService;
  let userRepository: { findOneUpdate: jest.Mock };

  beforeEach(async () => {
    userRepository = {
      findOneUpdate: jest.fn().mockResolvedValue(undefined),
    };

    service = new SocialLoginService(
      userRepository as unknown as UserRepository,
      { get: jest.fn() } as unknown as ConfigService,
      { signAsync: jest.fn() } as unknown as JwtService,
      {} as SupportedServiceList,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('removeMFA', () => {
    it('verifies and removes the requested authenticator type', async () => {
      jest.spyOn(authenticator, 'verify').mockReturnValue(true);
      const user = {
        userId: 'user-1',
        authenticators: [
          {
            type: AuthneticatorType.google,
            secret: 'google-secret',
            isTwoFactorAuthenticated: true,
          },
          {
            type: AuthneticatorType.okta,
            secret: 'okta-secret',
            isTwoFactorAuthenticated: true,
          },
        ],
      };

      await expect(
        service.removeMFA(user, {
          authenticatorType: AuthneticatorType.google,
          twoFactorAuthenticationCode: '123456',
        }),
      ).resolves.toEqual({ message: 'Removed authenticator successfully' });

      expect(authenticator.verify).toHaveBeenCalledWith({
        token: '123456',
        secret: 'google-secret',
      });
      expect(userRepository.findOneUpdate).toHaveBeenCalledWith(
        { userId: 'user-1' },
        {
          authenticators: [
            {
              type: AuthneticatorType.okta,
              secret: 'okta-secret',
              isTwoFactorAuthenticated: true,
            },
          ],
        },
      );
    });

    it('throws not found when the authenticator type is not configured', async () => {
      const user = {
        userId: 'user-1',
        authenticators: [],
      };

      await expect(
        service.removeMFA(user, {
          authenticatorType: AuthneticatorType.google,
          twoFactorAuthenticationCode: '123456',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(userRepository.findOneUpdate).not.toHaveBeenCalled();
    });

    it('does not remove the authenticator when the code is invalid', async () => {
      jest.spyOn(authenticator, 'verify').mockReturnValue(false);
      const user = {
        userId: 'user-1',
        authenticators: [
          {
            type: AuthneticatorType.google,
            secret: 'google-secret',
            isTwoFactorAuthenticated: true,
          },
        ],
      };

      await expect(
        service.removeMFA(user, {
          authenticatorType: AuthneticatorType.google,
          twoFactorAuthenticationCode: '123456',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(userRepository.findOneUpdate).not.toHaveBeenCalled();
    });
  });
});
