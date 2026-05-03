import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EvolutionController } from './evolution.controller';
import { EvolutionService } from './evolution.service';
import { MessageQueueService } from './message-queue.service';
import { UazapiProvider } from './providers/uazapi.provider';
import { MetaProvider } from './providers/meta.provider';
import { LeadsModule } from '../leads/leads.module';
import { AiModule } from '../ai/ai.module';
import { CalendarModule } from '../calendar/calendar.module';
import { AudioModule } from '../audio/audio.module';

@Module({
  imports: [HttpModule, ConfigModule, LeadsModule, AiModule, CalendarModule, AudioModule],
  controllers: [EvolutionController],
  providers: [
    UazapiProvider,
    MetaProvider,
    {
      provide: 'WHATSAPP_PROVIDER',
      useFactory: (config: ConfigService, uazapi: UazapiProvider, meta: MetaProvider) => {
        const provider = config.get('WHATSAPP_PROVIDER') ?? 'uazapi';
        return provider === 'meta' ? meta : uazapi;
      },
      inject: [ConfigService, UazapiProvider, MetaProvider],
    },
    EvolutionService,
    MessageQueueService,
  ],
  exports: [EvolutionService],
})
export class EvolutionModule {}
