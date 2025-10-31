import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { CreateCustomerOnboardingDto } from '../dto/create-customer-onboarding.dto';
import { UpdateCustomerOnboardingDto } from '../dto/update-customer-onboarding.dto';
import { CustomerOnboardingRepository } from '../repositories/customer-onboarding.repositories';
import getCreditRequestNotificationMail from 'src/mail-notification/constants/templates/credit-request.template';
import { UserRepository } from 'src/user/repository/user.repository';
import { UserRole } from 'src/user/schema/user.schema';
import { MailNotificationService } from 'src/mail-notification/services/mail-notification.service';

@Injectable()
export class CustomerOnboardingService {
  constructor(
    private readonly customerOnboardingRepository: CustomerOnboardingRepository,
    private readonly userRepository: UserRepository,
    private readonly mailNotificationService: MailNotificationService,
  ) {}
  async createCustomerOnboardingDetail(
    createCustomerOnboardingDto: CreateCustomerOnboardingDto,
    userId: string,
  ) {
    try {
      let { isKyc, isKyb } = createCustomerOnboardingDto;
      const { isKycAndKyb } = createCustomerOnboardingDto;
      if (isKycAndKyb) {
        isKyc = true;
        isKyb = true;
      }
      const onboardingData =
        await this.customerOnboardingRepository.createCustomerOnboarding({
          ...createCustomerOnboardingDto,
          isKyc,
          isKyb,
          userId,
        });

      const requestedServices = isKycAndKyb
        ? 'KYC and KYB Service'
        : isKyc
        ? 'KYC Service'
        : isKyb
        ? 'KYB Service'
        : 'No service requested';

      const { customerEmail } = createCustomerOnboardingDto;

      const message = getCreditRequestNotificationMail(
        userId,
        customerEmail,
        requestedServices,
        onboardingData['_id'].toString(),
      );
      const superAdminDetails = await this.userRepository.find({
        role: UserRole.SUPER_ADMIN,
      });
      const superAdminEmails = superAdminDetails.map((admin) => admin.email);
      const subject = 'New Customer Onboarding Request Received';
      await this.sendOnboardingRequestMailToSuperAdmin(
        message,
        superAdminEmails,
        subject,
      );

      return onboardingData;
    } catch (e) {
      if (e.code === 11000) {
        const field = Object.keys(e.keyValue || {})[0];
        const value = e.keyValue ? e.keyValue[field] : '';
        throw new ConflictException([`${field} '${value}' already exists`]);
      }
      throw new BadRequestException([e.message]);
    }
  }

  async findOne(id: string, user) {
    try {
      Logger.log(
        'Inside customer onboardig service findOne method',
        'CustomerOnboardingService',
      );
      const customerOnboardingData =
        await this.customerOnboardingRepository.findCustomerOnboardingById({
          _id: id,
        });
      if (!customerOnboardingData) {
        throw new BadRequestException(['Customer Onboarding detail not found']);
      }
      if (
        user.role !== UserRole.SUPER_ADMIN &&
        customerOnboardingData.userId !== user.userId
      ) {
        throw new ForbiddenException([
          'You are not authorized to access this resource',
        ]);
      }
      return customerOnboardingData;
    } catch (e) {
      if (e instanceof HttpException) throw e;
      else throw new BadRequestException([`${e.message}`]);
    }
  }

  async updateCustomerOnboardingDetail(
    id: string,
    updateCustomerOnboardingDto: UpdateCustomerOnboardingDto,
    userId: string,
  ) {
    try {
      const customerOnboardingData =
        await this.customerOnboardingRepository.findCustomerOnboardingById({
          _id: id,
        });
      if (!customerOnboardingData) {
        throw new BadRequestException([
          `Customer Onboarding detail not found for id: ${id}`,
        ]);
      }
      if (customerOnboardingData.userId !== userId) {
        throw new ForbiddenException([
          'You are not authorized to update this resource',
        ]);
      }
      return this.customerOnboardingRepository.updateCustomerOnboardingDetails(
        { _id: id },
        updateCustomerOnboardingDto,
      );
    } catch (e) {
      if (e instanceof HttpException) throw e;
      else throw new BadRequestException([`${e.message}`]);
    }
  }

  private async sendOnboardingRequestMailToSuperAdmin(
    message,
    superAdminEmailList,
    subject,
  ) {
    const to = superAdminEmailList[0];
    const cc = superAdminEmailList.slice(1);
    await this.mailNotificationService.addAJob(
      {
        to,
        subject,
        message,
        cc,
      },
      'send-credit-request-notification-mail',
    );
  }
}
