import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Logger,
  UseFilters,
  Req,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { WebpageConfigService } from '../services/webpage-config.service';
import { CreateWebpageConfigDto } from '../dto/create-webpage-config.dto';
import { UpdateWebpageConfigDto } from '../dto/update-webpage-config.dto';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AllExceptionsFilter } from 'src/utils/utils';
@ApiBearerAuth('Authorization')
@ApiTags('Webpage-config')
@UseFilters(AllExceptionsFilter)
@UsePipes(new ValidationPipe())
  @Controller('api/v1/app')
export class WebpageConfigController {
  constructor(private readonly webpageConfigService: WebpageConfigService) {}

  @Post(':appId/kyc-webpage-config')
  configureWebPageDetail(
    @Param('appId') serviceId: string,
    @Body() createWebpageConfigDto: CreateWebpageConfigDto,
    @Req() req,
  ) {
    Logger.log('inside configureWebPageDetail(): to configure webpage detail');
    return this.webpageConfigService.storeWebPageConfigDetial(
      serviceId,
      createWebpageConfigDto,
      req.user,
    );
  }

  @Get(':appId/kyc-webpage-config')
  fetchWebPageConfigurationDetail(@Param('appId') appId: string) {
    return this.webpageConfigService.fetchWebPageConfigurationList(appId);
  }

  @Get(':appId/kyc-webpage-config/:id')
  fetchAWebPageConfigurationDetail(
    @Param('appId') appId: string,
    @Param('id') id: string,
  ) {
    console.log(id, appId);
    return this.webpageConfigService.fetchAWebPageConfigurationDetail(
      id,
      appId,
    );
  }

  @Patch(':appId/kyc-webpage-config/:id')
  updateWebPageConfiguration(
    @Param('appId') appId: string,
    @Param('id') id: string,
    @Body() updateWebpageConfigDto: UpdateWebpageConfigDto,
    @Req() req,
  ) {
    return this.webpageConfigService.updateWebPageConfiguration(
      id,
      updateWebpageConfigDto,
      req.user,
      appId,
    );
  }

  @Delete(':appId/kyc-webpage-config/:id')
  removeWebPageConfiguration(
    @Param('appId') appId: string,
    @Param('id') id: string,
  ) {
    return this.webpageConfigService.removeWebPageConfiguration(id, appId);
  }
}
