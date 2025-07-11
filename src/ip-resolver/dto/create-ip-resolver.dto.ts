import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty } from 'class-validator';

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
