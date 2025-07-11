import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateIpResolverDto } from '../dto/create-ip-resolver.dto';
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
    if (ipArray.length > 50) {
      throw new BadRequestException(['You can resolve upto 50 IPs at a time ']);
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
      this.ipResolverRepository.insertMany(resolveData);
      newlyResolved = resolveData;
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
}
