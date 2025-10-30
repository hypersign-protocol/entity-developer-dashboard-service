import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Logger,
  Req,
} from '@nestjs/common';
import {
  CreateCustomerOnboardingDto,
  CreateCustomerOnboardingRespDto,
} from '../dto/create-customer-onboarding.dto';
import { UpdateCustomerOnboardingDto } from '../dto/update-customer-onboarding.dto';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CustomerOnboardingService } from '../services/customer-onboarding.service';
import { Request } from 'express';
import { AppError } from 'src/app-auth/dtos/fetch-app.dto';
@ApiTags('Customer-Onboarding')
@Controller('customer-onboarding')
export class CustomerOnboardingController {
  constructor(
    private readonly customerOnboardingService: CustomerOnboardingService,
  ) { }
  @ApiBearerAuth('Authorization')
  @ApiCreatedResponse({
    description: 'Customer Onboarding detail created successfully',
    type: CreateCustomerOnboardingRespDto,
  })
  @ApiBadRequestResponse({
    description: 'Erorr occured while storing onboarding detail',
    type: AppError,
  })
  @Post()
  create(
    @Body() createCustomerOnboardingDto: CreateCustomerOnboardingDto,
    @Req() req: Request,
  ) {
    Logger.log(
      'Inside customer onboardig controller create method',
      'CustomerOnboardingController',
    );
    return this.customerOnboardingService.createCustomerOnboardingDetail(
      createCustomerOnboardingDto,
      req.user['userId'],
    );
  }

}
