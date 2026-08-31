import {
  UseFilters,
  Controller,
  Get,
  Req,
  Param,
  Post,
  Body,
  UsePipes,
  ValidationPipe,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { AllExceptionsFilter } from 'src/utils/utils';
import { CreditService } from '../services/credits.service';
import {
  CreditRequestDto,
  CreditResponseDto,
  CreditPlanResponseDto,
  GetCreditsQueryDto,
} from '../dtos/credits.dto';
import { CreditSourceEnum } from '../schemas/credit.schema';

@UseFilters(AllExceptionsFilter)
@ApiTags('Credits')
@Controller('/api/v1/app')
export class CreditsController {
  constructor(private readonly creditService: CreditService) {}
  @ApiOkResponse({
    description: 'Credit plan list',
    type: CreditPlanResponseDto,
    isArray: true,
  })
  @ApiQuery({
    description: 'If staus then retur only Active status',
    name: 'status',
    required: false,
  })
  @UsePipes(new ValidationPipe({ transform: true }))
  @Get(':appId/credits')
  async getCredits(
    @Param('appId') appId: string,
    @Query() query: GetCreditsQueryDto,
  ) {
    const { status } = query;
    return this.creditService.fetchCreditDetails(appId, status);
  }

  @ApiBearerAuth('Authorization')
  @ApiOkResponse({
    description: 'Credit plan activated successfully',
    type: CreditPlanResponseDto,
  })
  @ApiParam({ name: 'creditId', description: 'Credit plan id' })
  @Post(':appId/credits/:creditId/activate')
  async activateCredit(
    @Param('creditId') creditId: string,
    @Param('appId') appId: string,
  ) {
    return this.creditService.activateCredit(creditId, appId);
  }

  @ApiBearerAuth('Authorization')
  @ApiOkResponse({
    description: 'Credit granted successfully',
    type: CreditResponseDto,
  })
  @UsePipes(new ValidationPipe({ transform: true }))
  @Post(':appId/credits')
  async grantCredit(
    @Param('appId') appId: string,
    @Body() creditRequestDto: CreditRequestDto,
    @Req() req: any,
  ) {
    return this.creditService.grantCredit(
      appId,
      creditRequestDto,
      req.user.userId,
      CreditSourceEnum.MANUAL_RECHARGE,
    );
  }
}
