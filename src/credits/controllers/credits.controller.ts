import {
  UseFilters,
  Controller,
  Get,
  Query,
  Req,
  Param,
  Post,
  Body,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExcludeEndpoint,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { AllExceptionsFilter } from 'src/utils/utils';
import { AuthzCreditService } from '../services/credits.service';
import {
  CreditRequestDto,
  CreditResponseDto,
  GetCreditsDto,
} from '../dtos/credits.dto';

@UseFilters(AllExceptionsFilter)
@ApiTags('Credits')
@Controller('/api/v1/credits')
export class CreditsController {
  constructor(private readonly creditService: AuthzCreditService) {}
  @ApiBearerAuth('Authorization')
  @ApiOkResponse({
    description: 'Credit granted successfully',
    type: CreditResponseDto,
  })
  @Post('/:appId')
  async grantCredit(
    @Param('appId') appId: string,
    @Body() creditRequestDto: CreditRequestDto,
    @Req() req: any,
  ) {
    return this.creditService.grantCredit(
      appId,
      creditRequestDto,
      req.user.userId,
    );
  }
}
