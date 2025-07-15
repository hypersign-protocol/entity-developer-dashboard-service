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
export class CityStats {
  @ApiProperty({
    name: 'name',
    description: 'Name of the cities',
    example: 'Gurgaon',
  })
  @IsString()
  name: string;
  @ApiProperty({
    name: 'count',
    description: 'Count of the user participated from specific region',
    example: 100,
  })
  @IsNumber()
  count: number;
}

export class RegionStats {
  @ApiProperty({
    name: 'name',
    description: 'Name of the region',
    example: 'Haryana',
  })
  @IsString()
  name: string;
  @ApiProperty({
    name: 'count',
    description: 'Count of the user participated from specific region',
    example: 100,
  })
  @IsNumber()
  count: number;
  @ApiProperty({
    name: 'cities',
    description:
      'List of cities from where user have participanted and their detail',
    type: CityStats,
    isArray: true,
  })
  @Type(() => CityStats)
  @ValidateNested({ each: true })
  cities: CityStats[];
}

export class CountryStats {
  @ApiProperty({
    name: 'name',
    description: 'Country code',
    example: 'IN',
  })
  @IsString()
  name: string;
  @ApiProperty({
    name: 'count',
    description: 'Count of the user participated from specific country',
    example: 100,
  })
  @IsNumber()
  count: number;
  @ApiProperty({
    name: 'regions',
    description:
      'List of regions from where user have participanted and their detail',
    type: RegionStats,
    isArray: true,
  })
  @Type(() => RegionStats)
  @ValidateNested({ each: true })
  regions: RegionStats[];
}

export class IpGeolocationQueryResponse {
  @ApiProperty({
    name: 'name',
    description: 'Name of the continent',
    example: 'Asia',
  })
  @IsString()
  name: string;
  @ApiProperty({
    name: 'count',
    description: 'Count of the user perticipated from continent mentioned',
    example: 100,
  })
  @IsNumber()
  count: number;
  @ApiProperty({
    name: 'countries',
    description:
      'List of countries from where user have participanted and their detail',
    type: CountryStats,
    isArray: true,
  })
  @Type(() => CountryStats)
  @ValidateNested({ each: true })
  countries: CountryStats[];
}
