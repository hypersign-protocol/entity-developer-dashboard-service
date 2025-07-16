import { Injectable, Logger } from '@nestjs/common';
import { Reader } from '@maxmind/geoip2-node';
import * as fs from 'fs';

@Injectable()
export class GeolocationService {
  private reader: Reader | null = null;

  constructor() {
    this.initializeReader();
  }
  private initializeReader() {
    const filePath = process.env.GEOLOCATION_DB_PATH;
    if (!filePath) {
      Logger.warn('Environment variable GEOLOCATION_DB_PATH not set');
      return;
    }
    try {
      if (!fs.existsSync(filePath)) {
        Logger.warn(`Geolocation database file not found at path: ${filePath}`);
        return;
      }

      const dbBuffer = fs.readFileSync(filePath);
      this.reader = Reader.openBuffer(dbBuffer);
      Logger.log('Geolocation database initialized successfully');
    } catch (error) {
      Logger.error(
        `Failed to initialize geolocation database: ${error.message}`,
      );
    }
  }

  resolveIp(ipAddress: string) {
    if (!this.reader) {
      Logger.warn(
        'Geolocation database reader is not initialized. Cannot resolve IP.',
      );
      return null;
    }
    try {
      // https://www.npmjs.com/package/@maxmind/geoip2-node
      const rawData = this.reader['city'](ipAddress);
      return {
        ip: ipAddress,
        continentCode: rawData?.continent?.code || null,
        continentName: rawData?.continent?.names?.en || null,
        countryCode: rawData?.country?.isoCode || null,
        countryName: rawData?.country?.names?.en || null,
        region: rawData?.subdivisions?.[0]?.names?.en || null,
        city: rawData?.city?.names?.en || null,
        timeZone: rawData?.location?.timeZone || null,
      };
    } catch (error) {
      Logger.error(
        `Error resolving IP address (${ipAddress}): ${error.message}`,
      );
      return null;
    }
  }
}
