import { ApiProperty, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import {
  SERVICE_TYPES,
  SERVICES,
} from 'src/supported-service/services/iServiceList';
import { AreAllPropertiesUnique } from 'src/utils/customDecorator/arrayUnique.decorator';

export class AccessList {
  @ApiProperty({
    type: String,
    name: 'serviceType',
    enum: SERVICE_TYPES,
  })
  @IsString()
  serviceType: SERVICE_TYPES;

  @ApiProperty({
    type: String,
    name: 'access',
    isArray: false,
    enum: {
      ...SERVICES.CAVACH_API.ACCESS_TYPES,
      ...SERVICES.SSI_API.ACCESS_TYPES,
      ...SERVICES.DASHBOARD.ACCESS_TYPES,
    },
  })
  @IsEnum({
    ...SERVICES.CAVACH_API.ACCESS_TYPES,
    ...SERVICES.SSI_API.ACCESS_TYPES,
    ...SERVICES.DASHBOARD.ACCESS_TYPES,
  })
  access: string;

  @ApiProperty({
    type: Date,
    name: 'expiryDate',
    required: false,
  })
  @IsOptional()
  @IsDateString()
  expiryDate?: Date;
}

export class CreateRoleDTO {
  @ApiProperty({
    type: String,
    name: 'roleName',
  })
  @IsString()
  roleName: string;

  @ApiProperty({
    type: String,
    name: 'roleDescription',
    required: false,
  })
  @IsString()
  @IsOptional()
  roleDescription?: string;

  @ApiProperty({
    type: AccessList,
    name: 'permissions',
    isArray: true,
  })
  @ValidateNested()
  @Type(() => AccessList)
  @AreAllPropertiesUnique()
  permissions: Array<AccessList>;
}

export class CreateRoleResponseDTO extends PartialType(CreateRoleDTO) {
  @ApiProperty({
    type: String,
    name: 'userId',
  })
  @IsString()
  userId: string;
}
