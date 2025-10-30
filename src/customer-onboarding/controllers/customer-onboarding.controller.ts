import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
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
import { UpdateCustomerOnboardingDto } from '../dto/update-customer-onboarding.dto';
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
@ApiTags('Customer-Onboarding')
@Controller('customer-onboarding')
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
    description: 'Erorr occured while storing onboarding detail',
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
    description: 'Erorr occured while storing onboarding detail',
    type: AppError,
  })
  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: Request) {
    return this.customerOnboardingService.findOne(id, req.user);
  }

}
