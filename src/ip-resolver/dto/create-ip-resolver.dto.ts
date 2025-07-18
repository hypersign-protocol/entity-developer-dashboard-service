import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDefined,
  IsNotEmpty,
  IsNumber,
  IsString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class CreateIpResolverDto {
  @ApiProperty({
    name: 'ips',
    description: 'comma seprated list of ips',
    example: '34.93.113.91, 34.49.163.240',
  })
  @IsNotEmpty()
  ips: string | string[];
}

export class IpResolverResponseDTo {
  @ApiProperty({
    name: 'ip',
    description: 'ip address',
    example: '34.93.113.91',
  })
  ip: string;

  @ApiProperty({
    name: 'continentCode',
    description: 'continentCode',
    example: 'AS',
  })
  continentCode: string;
  @ApiProperty({
    name: 'continentName',
    description: 'continentName',
    example: 'Asia',
  })
  continentName: string;

  @ApiProperty({
    name: 'countryCode',
    description: 'countryCode',
    example: 'IN',
  })
  countryCode: string;
  @ApiProperty({
    name: 'countryName',
    description: 'Name of the country',
    example: 'India',
  })
  countryName: string;
  @ApiProperty({
    name: 'region',
    description: 'region address',
    example: 'Maharashtra',
  })
  region: string;
  @ApiProperty({
    name: 'city',
    description: 'Name of the city',
    example: 'Mumbai',
  })
  city: string;
  @ApiProperty({
    name: 'timeZone',
    description: 'timeZone',
    example: ['UTC+05:30'],
  })
  timeZone: string;
}

export class IpGeolocationQueryDto {
  @ApiProperty({
    name: 'ips',
    description:
      'A comma-separated string or an array of IP addresses. If omitted or empty, it will return data for all users.',
    example: '34.93.113.91, 34.49.163.240',
    required: false,
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
  })
  @IsDefined()
  @ValidateIf((o) => typeof o.ips === 'string')
  @IsString({ message: 'ips must be a string or an array of strings' })
  @ValidateIf((o) => Array.isArray(o.ips))
  @IsArray({ message: 'ips must be an array' })
  ips: string | string[] | [];
}

export class IpGeolocationQueryResponse {
  @ApiProperty({
    description: 'Map of continent name to user count',
    type: 'object',
    example: {
      Asia: 23,
      'North America': 10,
      Europe: 5,
    },
    additionalProperties: {
      type: 'number',
    },
  })
  continents: Record<string, number>;
  @ApiProperty({
    description: 'Map of country code to user count',
    type: 'object',
    example: {
      IN: 12,
      US: 5,
      NL: 3,
    },
    additionalProperties: {
      type: 'number',
    },
  })
  countries: Record<string, number>;
}
