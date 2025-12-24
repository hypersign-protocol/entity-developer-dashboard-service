import { UseFilters, Controller, Get, Query, Req, Param } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExcludeEndpoint,
  ApiOkResponse,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AllExceptionsFilter } from 'src/utils/utils';
import { AuthzCreditService } from '../services/credits.service';
import { GetCreditsDto } from '../dtos/credits.dto';

@UseFilters(AllExceptionsFilter)
@ApiTags('Credits')
@Controller('/api/v1/credits')
export class CreditsController {
  constructor(private readonly creditService: AuthzCreditService) {}
  @ApiBearerAuth('Authorization')
  @Get('/app')
  @ApiQuery({
    name: 'appId',
    example: 'appId',
    description: 'Provide appId',
  })
  async getCreditByAppId(@Req() req: any, @Query() query: GetCreditsDto) {
    const userId = req.user.userId;

    const appId = query.appId;
    return this.creditService.getCreditDetails(appId, userId);
  }
}
