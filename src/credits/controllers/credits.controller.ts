import {
  BadRequestException,
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
  ForbiddenException,
  HttpStatus,
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
import { UserRole } from 'src/user/schema/user.schema';
import {
  BillingErrorCode,
  invoicedGrantsOnly,
} from 'src/billing/billing.constants';
import { BillingException } from 'src/billing/billing.exception';

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
    @Req() req: any,
  ) {
    return this.creditService.activateCredit(creditId, appId, {
      userId: req.user.userId,
      role: req.user.role,
    });
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
    const source = creditRequestDto.source ?? CreditSourceEnum.MANUAL_RECHARGE;
    if (source === CreditSourceEnum.PROMOTION) {
      return this.creditService.grantFreeCredit(appId, req.user);
    }
    if (req.user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException([
        'Only a super admin can grant manual credits',
      ]);
    }
    // Once invoicing is switched on, ID Service credits are granted only
    // through invoices (POST /admin/billing/invoices). SSI is unchanged.
    if (
      invoicedGrantsOnly() &&
      (await this.creditService.isIdServiceApp(appId))
    ) {
      throw new BillingException(
        HttpStatus.CONFLICT,
        BillingErrorCode.USE_INVOICES,
        'ID Service credits are granted through invoices. Use Recharge Service Credits > Invoice.',
      );
    }
    return this.creditService.grantCredit(
      appId,
      creditRequestDto,
      req.user.userId,
      source,
    );
  }
}
