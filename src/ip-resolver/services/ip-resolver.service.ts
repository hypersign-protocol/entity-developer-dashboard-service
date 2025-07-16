import { BadRequestException, Injectable } from '@nestjs/common';
import {
  CreateIpResolverDto,
  IpGeolocationQueryDto,
} from '../dto/create-ip-resolver.dto';
import { IpResolverRepository } from '../repository/ip-resolver.repository';
import { ConfigService } from '@nestjs/config';
import { sanitizeUrl } from 'src/utils/utils';

@Injectable()
export class IpResolverService {
  constructor(
    private readonly ipResolverRepository: IpResolverRepository,
    private readonly configServcie: ConfigService,
  ) {}
  async resolveIps(createIpResolverDto: CreateIpResolverDto) {
    let ipArray: string[] = [];
    if (typeof createIpResolverDto.ips === 'string') {
      ipArray = createIpResolverDto.ips
        .split(',')
        .map((ip) => ip.trim())
        .filter((ip) => ip.length > 0);
    } else if (Array.isArray(createIpResolverDto.ips)) {
      ipArray = createIpResolverDto.ips.map((ip) => ip.trim());
    }
    if (ipArray.length > 100) {
      throw new BadRequestException([
        'You can resolve upto 100 IPs at a time ',
      ]);
    }
    const uniqueIps = Array.from(new Set(ipArray));
    const cachedIpRecords = await this.ipResolverRepository.find({
      ip: { $in: uniqueIps },
    });
    const cachedIpMap = new Map(cachedIpRecords.map((ip) => [ip.ip, ip]));
    const missingIps = uniqueIps.filter((ip) => !cachedIpMap.has(ip));
    let newlyResolved = [];
    if (missingIps.length > 0) {
      const resolveData = await this.resolveBulkIp(missingIps);
      const validIps = resolveData.filter((res) => !res['error']);
      if (validIps.length > 0) {
        this.ipResolverRepository.insertMany(validIps);
      }
      newlyResolved = validIps;
    }
    return [...cachedIpRecords, ...newlyResolved];
  }
  async resolveBulkIp(ips: string[]) {
    if (!ips || ips.length === 0) {
      throw new Error('No Ips exists');
    }
    const baseUrl = sanitizeUrl(
      this.configServcie.get('IP_RESOLVER_API_URL'),
      true,
    );
    const apiKey = this.configServcie.get('IP_RESOLVER_API_KEY');

    const ipPromises = ips.map(async (ip) => {
      const url = `${baseUrl}${ip}`;
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            apikey: apiKey,
            'Content-Type': 'application/json',
          },
        });
        if (!response.ok) {
          return { ip, error: `HTTP ${response.status}` };
        }
        const rawData = await response.json();
        return this.formatResolvedIp(ip, rawData);
      } catch (e) {
        return { ip, error: e.message || 'Fetch failed' };
      }
    });
    const resolvedResults = await Promise.all(ipPromises);
    return resolvedResults;
  }

  private formatResolvedIp(ip: string, rawData) {
    return {
      ip,
      continentCode: rawData?.continent_code || null,
      continentName: rawData?.continent_name || null,
      countryCode: rawData?.country_code || null,
      countryName: rawData?.country_name || null,
      region: rawData?.region_name || null,
      city: rawData?.city || null,
      timeZone: rawData?.timezones || null,
    };
  }

  async generateIpBasedLocationAnalytics(ipsList: IpGeolocationQueryDto) {
    let ips: string[] = [];
    if (typeof ipsList.ips === 'string') {
      ips = ipsList.ips.split(',').map((ip) => ip.trim());
    } else if (Array.isArray(ipsList.ips)) {
      ips = ipsList.ips;
    }
    let enrichedRecords;
    if (ips.length === 0) {
      const pipeline = [
        {
          $group: {
            _id: {
              continentName: '$continentName',
              countryCode: '$countryCode',
            },
            count: { $sum: 1 },
          },
        },
        {
          $project: {
            _id: 0,
            continentName: '$_id.continentName',
            countryCode: '$_id.countryCode',
            count: 1,
          },
        },
      ];
      enrichedRecords = await this.ipResolverRepository.findBasedOnAggregation(
        pipeline,
      );
    } else {
      const ipFrequencyMap = ips.reduce((acc, ip) => {
        acc[ip] = (acc[ip] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      const ipRecords = await this.resolveIps({
        ips: Object.keys(ipFrequencyMap),
      });
      enrichedRecords = ipRecords.flatMap((rec) => {
        const ipCount = ipFrequencyMap[rec.ip] || 0;
        return Array(ipCount).fill({
          continentName: rec.continentName,
          countryCode: rec.countryCode,
          count: 1,
        });
      });
    }
    const continentCountMap: Record<string, number> = {};
    const countryCountMap: Record<string, number> = {};

    for (const record of enrichedRecords) {
      const { continentName, countryCode, count } = record;

      if (!continentCountMap[continentName]) {
        continentCountMap[continentName] = 0;
      }
      continentCountMap[continentName] += count;

      if (!countryCountMap[countryCode]) {
        countryCountMap[countryCode] = 0;
      }
      countryCountMap[countryCode] += count;
    }

    return {
      continents: continentCountMap,
      countries: countryCountMap,
    };
  }
}
