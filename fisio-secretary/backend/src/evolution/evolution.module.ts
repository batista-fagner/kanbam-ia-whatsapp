import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { EvolutionController } from './evolution.controller';
import { EvolutionService } from './evolution.service';
import { LeadsModule } from '../leads/leads.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [HttpModule, LeadsModule, AiModule],
  controllers: [EvolutionController],
  providers: [EvolutionService],
  exports: [EvolutionService],
})
export class EvolutionModule {}
