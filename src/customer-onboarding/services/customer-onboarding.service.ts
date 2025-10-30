import { Injectable, Logger } from '@nestjs/common';
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
    const onboardingData =
      await this.customerOnboardingRepository.createCustomerOnboarding({
        ...createCustomerOnboardingDto,
        userId,
      });

    const requestedServices = createCustomerOnboardingDto?.both
      ? 'KYC and KYB Service'
      : createCustomerOnboardingDto?.isKyc
      ? 'KYC Service'
      : createCustomerOnboardingDto?.isKyb
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

    return { message: 'Customer Onboarding detail created successfully' };
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
