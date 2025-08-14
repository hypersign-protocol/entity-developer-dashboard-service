import { ApiProperty, PartialType } from '@nestjs/swagger';
import { CreateBaseWebpageConfigDto } from './create-webpage-config.dto';
import { IsNotEmpty, IsString } from 'class-validator';

export class UpdateWebpageConfigBaseDto extends PartialType(
  CreateBaseWebpageConfigDto,
) {}
export class UpdateWebpageConfigDto extends UpdateWebpageConfigBaseDto {
  @ApiProperty({
    name: 'serviceId',
    description: 'Id of the service',
    example: '74838083d8a590f37bc3b049e6f95777f412',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  serviceId: string;
}
