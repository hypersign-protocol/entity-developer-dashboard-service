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
  CreateWebpageConfigResponseWithDetailDto,
  FetchWebpageConfigResponseDto,
  VerifierPageTokenResponse,
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
@Controller('api/v1/app/:appId/verifier')
export class WebpageConfigController {
  constructor(private readonly webpageConfigService: WebpageConfigService) {}

  @ApiCreatedResponse({
    description: 'Webpage configuration saved successfully',
    type: CreateWebpageConfigResponseWithDetailDto,
  })
  @Post()
  configureWebPageDetail(
    @Param('appId') serviceId: string,
    @Body() createWebpageConfigDto: CreateWebpageConfigDto,
  ) {
    Logger.log('inside configureWebPageDetail(): to configure webpage detail');
    return this.webpageConfigService.storeWebPageConfigDetial(
      serviceId,
      createWebpageConfigDto,
    );
  }

  @ApiOkResponse({
    description: 'Webpage configuration list',
    type: FetchWebpageConfigResponseDto,
  })
  @Get()
  async fetchWebPageConfigurationDetail(@Param('appId') appId: string) {
    Logger.log(
      'Inside fetchWebPageConfigurationDetail() to fetch webpageData',
      'WebpageConfigController',
    );
    return this.webpageConfigService.fetchWebPageConfigurationList(appId);
  }

  @ApiOkResponse({
    description: 'Webpage configuration fetched successfully',
    type: FetchWebpageConfigResponseDto,
  })
  @Get(':id')
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
    type: FetchWebpageConfigResponseDto,
  })
  @Patch(':id')
  updateWebPageConfiguration(
    @Param('appId') appId: string,
    @Param('id') id: string,
    @Body() updateWebpageConfigDto: UpdateWebpageConfigDto,
  ) {
    return this.webpageConfigService.updateWebPageConfiguration(
      id,
      updateWebpageConfigDto,
      appId,
    );
  }

  @ApiOkResponse({
    description: 'Webpage configuration deleted successfully',
    type: FetchWebpageConfigResponseDto,
  })
  @Delete(':id')
  removeWebPageConfiguration(
    @Param('appId') appId: string,
    @Param('id') id: string,
  ) {
    return this.webpageConfigService.removeWebPageConfiguration(id, appId);
  }
  @ApiOkResponse({
    description: 'Verifier webpage token generated successfully',
    type: VerifierPageTokenResponse,
  })
  @Post(':id/tokens')
  generateWebpageConfigTokens(
    @Param('appId') appId: string,
    @Param('id') id: string,
    @Req() req,
  ) {
    return this.webpageConfigService.generateWebpageConfigTokens(
      id,
      appId,
      req.user,
    );
  }
}
