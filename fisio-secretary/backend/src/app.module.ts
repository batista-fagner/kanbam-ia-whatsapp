import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Lead } from './common/entities/lead.entity';
import { Conversation } from './common/entities/conversation.entity';
import { Message } from './common/entities/message.entity';
import { LeadStageHistory } from './common/entities/lead-stage-history.entity';
import { Appointment } from './common/entities/appointment.entity';
import { EvolutionModule } from './evolution/evolution.module';
import { LeadsModule } from './leads/leads.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get('SUPABASE_DATABASE_URL'),
        ssl: { rejectUnauthorized: false },
        entities: [Lead, Conversation, Message, LeadStageHistory, Appointment],
        synchronize: true, // apenas dev — gera tabelas automaticamente
        logging: false,
      }),
    }),
    EvolutionModule,
    LeadsModule,
  ],
})
export class AppModule {}
