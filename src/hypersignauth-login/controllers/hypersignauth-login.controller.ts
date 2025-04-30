import {
  Controller,
  ValidationPipe,
  Post,
  UsePipes,
  Body,
  UseFilters,
  Logger,
  Res,
  Req,
} from '@nestjs/common';

import { ApiTags } from '@nestjs/swagger';
import { AllExceptionsFilter } from '../../utils/utils';
import { UserRepository } from 'src/user/repository/user.repository';

@UseFilters(AllExceptionsFilter)
@ApiTags('Authentication')
@Controller()
export class HypersignauthLoginController {
  constructor(private readonly userRepository: UserRepository) {}

  @Post('/hs/api/v2/auth')
  @UsePipes(new ValidationPipe({ transform: true }))
  async authenticate(@Res() res: any, @Req() req: any, @Body() body: any) {
    Logger.log('authenticate() method: starts', 'userController');
    const { hypersign } = body;
    const { user } = hypersign.data;
    let userInfo = await this.userRepository.findOne({ email: user.email });
    if (!userInfo) {
      userInfo = await this.userRepository.create({
        email: user.email,
        did: user.id,
        userId: user.appUserID,
        accessList: [],
        name: user.email.split('@')[0],
      });
    }
    res.status(200).json({
      status: 200,
      message: user,
      error: null,
    });
  }
}
