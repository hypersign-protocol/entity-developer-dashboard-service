import {
  Controller,
  ValidationPipe,
  Post,
  UsePipes,
  HttpCode,
  UseFilters,
  Headers,
  Logger,
  Get,
  Query,
  Req,
} from '@nestjs/common';

import {
  AppAuthService,
  GRANT_TYPES,
} from 'src/app-auth/services/app-auth.service';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiExcludeEndpoint,
  ApiHeader,
  ApiQuery,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AllExceptionsFilter } from 'src/utils/utils';
import {
  AppSecretHeader,
  OauthTokenExpiryHeader,
} from './dtos/app-sercret.decorator';
import {
  GenerateTokenError,
  GenerateTokenResponse,
  AppError,
} from './dtos/generate-token.dto';

@UseFilters(AllExceptionsFilter)
@ApiTags('Application')
@Controller('/api/v1/app')
export class AppOauthController {
  constructor(private readonly appAuthService: AppAuthService) {}

  @ApiHeader({
    name: 'X-Api-Secret-Key',
    description: 'Provide Api Secret  key to get access token',
    required: true,
  })
  @ApiHeader({
    name: 'Origin',
    description: 'Origin as you set in application cors',
    required: false,
  })
  @ApiHeader({
    name: 'ExpiresIn',
    description:
      'Specifie when this token should expire (in hours). Only whole numbers (≥ 1) are allowed. Default is 4h.',
    required: false,
  })
  @ApiBadRequestResponse({
    status: 400,
    description: 'Error occured at the time of generating access token',
    type: AppError,
  })
  @Post('oauth')
  @HttpCode(200)
  @ApiResponse({
    status: 200,
    description: 'AccessToken generated',
    type: GenerateTokenResponse,
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized',
    type: GenerateTokenError,
  })
  @ApiQuery({
    name: 'grant_type',
    description: 'The type of grant used to request an access token.',
    required: false,
    enum: GRANT_TYPES,
  })
  @UsePipes(ValidationPipe)
  generateAccessToken(
    @Headers('X-Api-Secret-Key') apiSectretKey: string,
    @AppSecretHeader() appSecreatKey,
    @Headers('ExpiresIn') oauthexpiresin: string,
    @OauthTokenExpiryHeader() expiresin,
    @Query('grant_type') grantType,
  ): Promise<{ access_token; expiresIn; tokenType }> {
    Logger.log('reGenerateAppSecretKey() method: starts', 'AppOAuthController');
    return this.appAuthService.generateAccessToken(
      appSecreatKey,
      expiresin,
      grantType,
    );
  }

  // grant type: [access_service], ?grant_type=access_service&serviceId=
  // serviceId
  @ApiQuery({
    name: 'grant_type',
    description: 'Grant type for this token',
    required: true,
  })
  @ApiQuery({
    name: 'serviceId',
    description: 'Service Id for the request token',
    required: true,
  })
  @ApiBadRequestResponse({
    status: 400,
    description: 'Error occured at the time of generating access token',
    type: AppError,
  })
  @ApiBearerAuth('Authorization')
  @ApiExcludeEndpoint()
  @Get('access-control/token')
  @HttpCode(200)
  @ApiResponse({
    status: 200,
    description: 'AccessToken generated',
    type: GenerateTokenResponse,
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized',
    type: GenerateTokenError,
  })
  @UsePipes(ValidationPipe)
  generateAccessToken1(
    @Query('grant_type') grantType,
    @Query('serviceId') serviceId,
    @Req() request,
  ): Promise<{ access_token; expiresIn; tokenType }> {
    const { user } = request;
    //
    Logger.log('reGenerateAppSecretKey() method: starts', 'AppOAuthController');

    return this.appAuthService.grantPermission(grantType, serviceId, user);
  }
}
