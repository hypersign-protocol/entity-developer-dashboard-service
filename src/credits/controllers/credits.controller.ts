import { UseFilters, Controller, Get, Query, Req, Param } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AllExceptionsFilter } from 'src/utils/utils';
import { AuthzCreditService } from '../services/credits.service';
import { GetCreditsDto, GrantAllowanceResponseDto } from '../dtos/credits.dto';

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

  // @ApiBearerAuth('Authorization') we will implement basic authentication and will set the userId and password on ssi service
  @ApiOkResponse({
    description: 'Granted allowance to specific wallet successfully',
    type: GrantAllowanceResponseDto,
  })
  @ApiQuery({
    name: 'allowance',
    description: 'Amount to authorize for the app',
    required: false,
    type: String,
  })
  @Get('/authz/:appId')
  async getAllowanceGrant(
    @Param('appId') appId: string,
    @Query('allowance') allowance = '5000000',
  ) {
    return this.creditService.grantSSICredit(appId, allowance);
  }
}
