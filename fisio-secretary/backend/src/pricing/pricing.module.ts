import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PriceConfig } from '../common/entities/price-config.entity';
import { PriceConfigController } from './price-config.controller';
import { PriceConfigService } from './price-config.service';

@Module({
  imports: [TypeOrmModule.forFeature([PriceConfig])],
  controllers: [PriceConfigController],
  providers: [PriceConfigService],
})
export class PricingModule {}
