import { Controller, Post, Body, UseFilters } from '@nestjs/common';
import {
  CreateIpResolverDto,
  IpResolverResponseDTo,
} from '../dto/create-ip-resolver.dto';
import { IpResolverService } from '../services/ip-resolver.service';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AllExceptionsFilter } from 'src/utils/utils';

@Controller('/api/v1/ip-resolver')
@UseFilters(AllExceptionsFilter)
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
}
