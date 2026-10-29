import {
  Controller,
  Get,
  Post,
  Body,
  BadRequestException,
  Param,
  Patch,
  Logger,
  Req,
  ValidationPipe,
  UsePipes,
  ForbiddenException,
  UploadedFiles,
  UseInterceptors,
  Headers,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
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
  ApiConsumes,
  ApiBody,
  ApiHeader,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CustomerOnboardingService } from '../services/customer-onboarding.service';
import { Request } from 'express';
import { AppError } from 'src/app-auth/dtos/fetch-app.dto';
import { UserRole } from 'src/user/schema/user.schema';
import { SubmitKybCompanyMultipartDto } from '../dto/submit-kyb-company.dto';
import { ProcessCustomerOnboardingRespDto } from '../dto/customer-onboarding-process.dto';
import { CompanyVerificationWebhookDto } from '../dto/company-verification-webhook.dto';
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
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @Post()
  create(
    @Body() createCustomerOnboardingDto: CreateCustomerOnboardingDto,
    @Req() req: Request,
  ) {
    Logger.log(
      'Inside customer onboardig controller create method',
      'CustomerOnboardingController',
    );
    if (createCustomerOnboardingDto.isRetry) {
      return this.customerOnboardingService.notifyAdminOnOnboardingRetry(
        createCustomerOnboardingDto,
        req.user['userId'],
      );
    }
    return this.customerOnboardingService.createCustomerOnboardingDetail(
      createCustomerOnboardingDto,
      req.user,
      req.user['email'],
    );
  }
  @ApiBearerAuth('Authorization')
  @ApiOkResponse({
    description: 'Customer Onboarding detail of user fetched successfully',
    type: FetchCustomerOnboardingRespDto,
  })
  @ApiBadRequestResponse({
    description: 'Error occured while fetching user onboarding detail',
    type: AppError,
  })
  @Get()
  findUserOnboardingDetail(@Req() req: Request) {
    return this.customerOnboardingService.findUserOnboardingDetail(req.user);
  }

  @Post('webhook')
  @ApiHeader({ name: 'x-dashboard-webhook-secret', required: true })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  updateCompanyVerificationStatus(
    @Headers('x-dashboard-webhook-secret') secret: string,
    @Body() payload: CompanyVerificationWebhookDto,
  ) {
    return this.customerOnboardingService.updateCompanyVerificationStatus(
      payload,
      secret,
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
  async processCustomerOnboarding(@Param('id') id: string, @Req() req: any) {
    const { user } = req;
    if (user.role !== UserRole.SUPER_ADMIN) {
      const onboarding = await this.customerOnboardingService.findOne(id, user);

      if (onboarding.userId !== user.userId) {
        throw new ForbiddenException([
          'You are not authorized to access this resource',
        ]);
      }
    }
    return this.customerOnboardingService.processCustomerOnboarding(
      id,
      req.user.userId,
    );
  }

  @ApiBearerAuth('Authorization')
  @ApiOkResponse({
    description: 'KYB company created and linked to onboarding successfully',
    type: FetchCustomerOnboardingRespDto,
  })
  @ApiParam({
    name: 'id',
    description: 'ID of the customer onboarding record',
    example: '6ac8924307fcca51e5da07e4',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    type: SubmitKybCompanyMultipartDto,
  })
  @UseInterceptors(
    AnyFilesInterceptor({
      limits: {
        files: 4,
        fileSize: Number.parseInt(process.env.FILE_MAX_SIZE || '5242880', 10),
      },
    }),
  )
  @Patch(':id')
  async submitKybCompany(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
    @UploadedFiles() files: any[],
    @Req() req: Request,
  ) {
    const fileValidationPipe = new ParseFilePipe({
      validators: [
        new MaxFileSizeValidator({
          maxSize: Number.parseInt(process.env.FILE_MAX_SIZE || '5242880', 10),
        }),
        new FileTypeValidator({
          fileType: new RegExp(
            `^(?:${(
              process.env.SUPPORTED_FILE_TYPES ||
              'image/jpeg,image/png,image/gif,application/pdf'
            )
              .split(',')
              .map((fileType) =>
                fileType.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
              )
              .join('|')})$`,
            'i',
          ),
        }),
      ],
      exceptionFactory: (error) =>
        new BadRequestException([
          typeof error === 'string' && error
            ? error
            : 'Invalid file. Only PDF or image files (jpg, jpeg, png, gif) are allowed.',
        ]),
    });
    await Promise.all(
      (files || []).map((file) => fileValidationPipe.transform(file)),
    );

    return this.customerOnboardingService.submitKybCompany(
      id,
      body,
      files || [],
      req.user,
    );
  }
}
