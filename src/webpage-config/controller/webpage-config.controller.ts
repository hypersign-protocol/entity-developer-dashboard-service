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
@Controller('api/v1/verification/webpage-config')
export class WebpageConfigController {
  constructor(private readonly webpageConfigService: WebpageConfigService) {}

  @Post()
  configureWebPageDetail(
    @Body() createWebpageConfigDto: CreateWebpageConfigDto,
    @Req() req,
  ) {
    const user = req.user;
    console.log(user, 'user');
    Logger.log('inside configureWebPageDetail(): to configure webpage detail');
    return this.webpageConfigService.storeWebPageConfigDetial(
      createWebpageConfigDto,
      req.user,
    );
  }

  @ApiQuery({
    name: 'serviceId',
    description: 'Id of the service',
  })
  @Get()
  fetchWebPageConfigurationDetail(@Query('serviceId') serviceId) {
    return this.webpageConfigService.fetchWebPageConfigurationList(serviceId);
  }

  @Get(':id')
  fetchAWebPageConfigurationDetail(@Param('id') id: string) {
    return this.webpageConfigService.fetchAWebPageConfigurationDetail(id);
  }

  @Patch(':id')
  updateWebPageConfiguration(
    @Param('id') id: string,
    @Body() updateWebpageConfigDto: UpdateWebpageConfigDto,
    @Req() req,
  ) {
    return this.webpageConfigService.updateWebPageConfiguration(
      id,
      updateWebpageConfigDto,
      req.user,
    );
  }

  @Delete(':id')
  removeWebPageConfiguration(@Param('id') id: string) {
    return this.webpageConfigService.removeWebPageConfiguration(id);
  }
}
