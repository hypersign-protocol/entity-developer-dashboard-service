import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Logger,
  Req,
  ValidationPipe,
  UsePipes,
} from '@nestjs/common';
import {
  CreateCustomerOnboardingDto,
  CreateCustomerOnboardingRespDto,
  FetchCustomerOnboardingRespDto,
} from '../dto/create-customer-onboarding.dto';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CustomerOnboardingService } from '../services/customer-onboarding.service';
import { Request } from 'express';
import { AppError } from 'src/app-auth/dtos/fetch-app.dto';
import {
  CustomerOnboardingProcessDto,
  ProcessCustomerOnboardingRespDto,
} from '../dto/customer-onboarding-process.dto';
@ApiTags('Customer-Onboarding')
@Controller('api/v1/customer-onboarding')
export class CustomerOnboardingController {
  constructor(
    private readonly customerOnboardingService: CustomerOnboardingService,
  ) {}
  @ApiBearerAuth('Authorization')
  @ApiCreatedResponse({
    description: 'Customer Onboarding detail created successfully',
    type: CreateCustomerOnboardingRespDto,
  })
  @ApiBadRequestResponse({
    description: 'Error occured while storing onboarding detail',
    type: AppError,
  })
  @UsePipes(new ValidationPipe())
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
  @ApiBearerAuth('Authorization')
  @ApiOkResponse({
    description: 'Customer Onboarding detail fetched successfully',
    type: FetchCustomerOnboardingRespDto,
  })
  @ApiBadRequestResponse({
    description: 'Error occured while fetching onboarding detail',
    type: AppError,
  })
  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: Request) {
    return this.customerOnboardingService.findOne(id, req.user);
  }
  @ApiBearerAuth('Authorization')
  @ApiOkResponse({
    description: 'Customer Onboarding detail updated successfully',
    type: ProcessCustomerOnboardingRespDto,
  })
  @ApiBadRequestResponse({
    description: 'Error occured while process onboarding detail',
    type: AppError,
  })
  @Post(':id/process')
  processCustomerOnboarding(
    @Param('id') id: string,
    @Body() customerOnboardingProcessDto: CustomerOnboardingProcessDto,
  ) {
    return this.customerOnboardingService.processCustomerOnboarding(
      id,
      customerOnboardingProcessDto,
    );
  }
}
