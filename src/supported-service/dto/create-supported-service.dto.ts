import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { SERVICE_TYPES } from '../services/iServiceList';

export class supportedServiceResponseDto {
  @ApiProperty({
    description: 'id',
    example: 'SSI_API',
  })
  id: string;
  @ApiProperty({
    description: 'dBSuffix',
    example: 'cavachDB',
  })
  dBSuffix: string;
  @ApiProperty({
    description: 'name',
    example: 'CAVACH_API',
  })
  @IsEnum(SERVICE_TYPES, {
    each: true,
    message:
      "services must be one of the following values: 'CAVACH_API', 'SSI_API'",
  })
  name: string;
  @ApiProperty({
    description: 'domain',
    example: 'api.cavach.hypersign.id',
    required: false,
  })
  domain?: string;

  @ApiProperty({
    description: 'description',
    example: 'A generic service interface for kyc verification',
  })
  description: string;
  @ApiProperty({
    description: 'swaggerAPIDocPath',
    example: '/api',
  })
  swaggerAPIDocPath: string;
}
