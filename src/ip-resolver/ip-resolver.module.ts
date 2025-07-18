import { Module } from '@nestjs/common';
import { IpResolverController } from './controller/ip-resolver.controller';
import { IpResolverService } from './services/ip-resolver.service';
import { IpResolver, IpResolverSchema } from './schemas/ip-resolver.schema';
import { MongooseModule } from '@nestjs/mongoose';
import { IpResolverRepository } from './repository/ip-resolver.repository';
import { GeolocationService } from './services/geoLocation.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: IpResolver.name, schema: IpResolverSchema },
    ]),
  ],
  controllers: [IpResolverController],
  providers: [IpResolverService, IpResolverRepository, GeolocationService],
})
export class IpResolverModule {}
