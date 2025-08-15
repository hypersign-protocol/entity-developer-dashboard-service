import { PartialType } from '@nestjs/swagger';
import { CreateWebpageConfigDto } from './create-webpage-config.dto';

export class UpdateWebpageConfigDto extends PartialType(
  CreateWebpageConfigDto,
) {}
