import {
  Controller,
  Get,
  ValidationPipe,
  Post,
  UsePipes,
  Body,
  Put,
  Param,
  UseInterceptors,
  HttpCode,
  UseFilters,
  Query,
} from '@nestjs/common';
import { User } from '../decorator/user.decorator';
import { CreateAppDto } from 'src/app-auth/dtos/create-app.dto';
import {
  
  GenerateTokenError,
  GenerateTokenResponse,
  RegenrateAppApiSecretResponse,
} from '../dtos/generate-token.dto';
import { AppAuthService } from 'src/app-auth/services/app-auth.service';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiQuery,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { App, createAppResponse } from '../schemas/app.schema';
import { AppNotFoundException } from 'src/app-auth/exceptions/app-not-found.exception';
import { UpdateAppDto } from '../dtos/update-app.dto';
import { MongooseClassSerializerInterceptor } from '../../utils/utils';
import { AllExceptionsFilter } from '../../utils/utils';
import { AppError } from '../dtos/fetch-app.dto';
import { PaginationDto } from 'src/utils/pagination.dto';
import { AppSecretHeader } from '../decorator/app-sercret.decorator';
import { AppAuthApiKeyService } from '../services/app-auth-apikey.service';

@UseFilters(AllExceptionsFilter)
@ApiTags('App')
@Controller('app')
export class AppAuthController {
  constructor(private readonly appAuthService: AppAuthService) {}
  @UseInterceptors(
    MongooseClassSerializerInterceptor(App, {
      excludePrefixes: ['apiKeySecret','apiKeyPrefix', '_', '__'],
    }),
  )
  @ApiHeader({
    name: 'userId',
    description:
      'Provide userId to get list of all the apps created by the userId',
  })
  @UsePipes(new ValidationPipe({ transform: true }))
  @Get()
  @ApiResponse({
    status: 200,
    description: 'App List',
    type: [App],
  })
  @ApiNotFoundResponse({
    status: 404,
    description: 'App not found',
    type: AppError,
  })
  @ApiQuery({
    name: 'page',
    description: 'Page value',
    required: false,
  })
  @ApiQuery({
    name: 'limit',
    description: 'limit value',
    required: false,
  })
  async getApps(
    @User() userId,
    @Query() pageOption: PaginationDto,
  ): Promise<App[]> {
    const appList = await this.appAuthService.getAllApps(userId, pageOption);
    if (appList.length === 0) {
      throw new AppNotFoundException();
    }
    if (appList) return appList;
  }
  @UseInterceptors(
    MongooseClassSerializerInterceptor(App, {
      excludePrefixes: ['apiKeySecret','apiKeyPrefix', '_', '__'],
    }),
  )
  @ApiHeader({
    name: 'userId',
    description: 'Provide userId to get app details',
  })
  @Get(':appId')
  @ApiResponse({
    status: 200,
    description: 'App details',
    type: App,
  })
  @ApiBadRequestResponse({
    status: 400,
    description: 'App not found',
    type: AppError,
  })
  async getAppById(
    @User() userId,
    @Param('appId') appId: string,
  ): Promise<App> {
    const app = await this.appAuthService.getAppById(appId, userId);
    if (app) return app;
    else throw new AppNotFoundException(); // Custom Exception handling
  }

  @ApiHeader({
    name: 'userId',
    description: 'Provide UserId to create a App',
  })
  @Post()
  @UseInterceptors(
    MongooseClassSerializerInterceptor(createAppResponse, {
      excludePrefixes: ['apiKeyPrefix','_', '__'],
    }),
  )
  @ApiCreatedResponse({
    description: 'App Created',
    type: createAppResponse,
  })
  @ApiBadRequestResponse({
    description: 'App registration failed',
    type: AppError,
  })
  @UsePipes(ValidationPipe)
  register(
    @User() userId,
    @Body() createAppDto: CreateAppDto,
  ): Promise<createAppResponse> {
    return this.appAuthService.createAnApp(createAppDto, userId);
  }

  @UseInterceptors(
    MongooseClassSerializerInterceptor(App, {
      excludePrefixes: ['apiKeySecret','apiKeyPrefix', '_', '__'],
    }),
  )
  @ApiHeader({
    name: 'userId',
    description: 'Provide userId to get app details',
  })
  @Put(':appId')
  @ApiResponse({
    status: 200,
    description: 'App updated',
    type: App,
  })
  @ApiNotFoundResponse({
    description: 'App not found',
    type: AppError,
  })
  @UsePipes(ValidationPipe)
  async update(
    @User() userId,
    @Param('appId') appId: string,
    @Body() updateAppDto: UpdateAppDto,
  ): Promise<App> {
    const app = await this.appAuthService.getAppById(appId, userId);
    if (app) {
      return this.appAuthService.updateAnApp(appId, updateAppDto, userId);
    } else throw new AppNotFoundException();
  }



  @ApiHeader({
    name: 'userId',
    description: 'Provide userId to get app details',
  })
  @Post(':appId/secret/new')
  @HttpCode(200)
  @ApiResponse({
    status: 200,
    description: 'Api Secret  Regenerated',
    type: RegenrateAppApiSecretResponse,
  })
  @ApiBadRequestResponse({
    description: 'Bad Request',
    type: AppError,
  })
 async reGenerateAppSecretKey(
    @User() userId,
    @Param('appId') appId: string,
  ){
    const app = await this.appAuthService.getAppById(appId, userId);
    if (!app)  {throw new AppNotFoundException()}
    return this.appAuthService.reGenerateAppSecretKey(app,userId)
  }



  
}





@ApiTags('App')
@Controller('app')
export class AppOAuthController {
  constructor(private readonly appAuthService: AppAuthService) { }
  
  @ApiHeader({
    name: 'X-APP-SECRET-KEY',
    description: 'Provide Api key to get access token',
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
  @UsePipes(ValidationPipe)
  generateAccessToken(
    @AppSecretHeader() appSecreatKey
  ): Promise<{ access_token; expiresIn; tokenType }> {
    return this.appAuthService.generateAccessToken(appSecreatKey);
  }







}