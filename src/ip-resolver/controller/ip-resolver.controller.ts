import {
  Controller,
  Post,
  Body,
  UseFilters,
  ValidationPipe,
  UsePipes,
} from '@nestjs/common';
import {
  CreateIpResolverDto,
  IpGeolocationQueryDto,
  IpGeolocationQueryResponse,
  IpResolverResponseDTo,
} from '../dto/create-ip-resolver.dto';
import { IpResolverService } from '../services/ip-resolver.service';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AllExceptionsFilter } from 'src/utils/utils';

@Controller('/api/v1/ip-resolver')
@UseFilters(AllExceptionsFilter)
@UsePipes(new ValidationPipe())
@ApiTags('IpResolver')
export class IpResolverController {
  constructor(private readonly ipResolverService: IpResolverService) {}

  @Post()
  @ApiOkResponse({
    description: 'Successfully fetched resolved ip',
    type: IpResolverResponseDTo,
    isArray: true,
  })
  create(@Body() createIpResolverDto: CreateIpResolverDto) {
    return this.ipResolverService.resolveIps(createIpResolverDto);
  }
  @Post('/stats')
  @ApiOkResponse({
    description: 'Successfully respond with count detial',
    type: IpGeolocationQueryResponse,
  })
  generateIpBasedLocationAnalytics(@Body() ipsList: IpGeolocationQueryDto) {
    return this.ipResolverService.generateIpBasedLocationAnalytics(ipsList);
  }
}
