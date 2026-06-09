import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiService } from './ai.service';
import { TokenUsage } from '../common/entities/token-usage.entity';

@Module({
  imports: [TypeOrmModule.forFeature([TokenUsage])],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
