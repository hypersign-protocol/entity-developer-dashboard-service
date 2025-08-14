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
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { WebpageConfigService } from '../services/webpage-config.service';
import {
  CreateWebpageConfigDto,
  CreateWebpageConfigResponseDto,
  FetchWebpageConfigResponseDto,
} from '../dto/create-webpage-config.dto';
import { UpdateWebpageConfigDto } from '../dto/update-webpage-config.dto';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AllExceptionsFilter } from 'src/utils/utils';
@ApiBearerAuth('Authorization')
@ApiTags('Webpage-config')
@UseFilters(AllExceptionsFilter)
@UsePipes(new ValidationPipe())
@Controller('api/v1/app')
export class WebpageConfigController {
  constructor(private readonly webpageConfigService: WebpageConfigService) {}

  @ApiCreatedResponse({
    description: 'Webpage configuration saved successfully',
    type: CreateWebpageConfigResponseDto,
  })
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

  @ApiOkResponse({
    description: 'Webpage configuration list',
    type: FetchWebpageConfigResponseDto,
    isArray: true,
  })
  @Get(':appId/kyc-webpage-config')
  fetchWebPageConfigurationDetail(@Param('appId') appId: string) {
    return this.webpageConfigService.fetchWebPageConfigurationList(appId);
  }

  @ApiOkResponse({
    description: 'Webpage configuration fetched successfully',
    type: FetchWebpageConfigResponseDto,
  })
  @Get(':appId/kyc-webpage-config/:id')
  fetchAWebPageConfigurationDetail(
    @Param('appId') appId: string,
    @Param('id') id: string,
  ) {
    return this.webpageConfigService.fetchAWebPageConfigurationDetail(
      id,
      appId,
    );
  }

  @ApiOkResponse({
    description: 'Webpage configuration updated successfully',
    type: CreateWebpageConfigResponseDto,
  })
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

  @ApiOkResponse({
    description: 'Webpage configuration deleted successfully',
    type: FetchWebpageConfigResponseDto,
  })
  @Delete(':appId/kyc-webpage-config/:id')
  removeWebPageConfiguration(
    @Param('appId') appId: string,
    @Param('id') id: string,
  ) {
    return this.webpageConfigService.removeWebPageConfiguration(id, appId);
  }
}
