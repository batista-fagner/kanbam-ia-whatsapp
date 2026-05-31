import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Lead } from './common/entities/lead.entity';
import { Conversation } from './common/entities/conversation.entity';
import { Message } from './common/entities/message.entity';
import { LeadStageHistory } from './common/entities/lead-stage-history.entity';
import { Campaign } from './common/entities/campaign.entity';
import { WhatsappConfig } from './common/entities/whatsapp-config.entity';
import { MediaFile } from './common/entities/media-file.entity';
import { Appointment } from './common/entities/appointment.entity';
import { DeletedLead } from './common/entities/deleted-lead.entity';
import { User } from './common/entities/user.entity';
import { InitialSchema1780170753448 } from './migrations/1780170753448-InitialSchema';
import { TenantConstraints1780170997907 } from './migrations/1780170997907-TenantConstraints';
import { ClientManagement1780184764189 } from './migrations/1780184764189-ClientManagement';
import { EvolutionModule } from './evolution/evolution.module';
import { LeadsModule } from './leads/leads.module';
import { CalendarModule } from './calendar/calendar.module';
import { BulkMessageModule } from './bulk-message/bulk-message.module';
import { MediaModule } from './media/media.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    // ENV_FILE permite trocar o arquivo de ambiente (ex: .env.development no dev isolado).
    ConfigModule.forRoot({ isGlobal: true, envFilePath: process.env.ENV_FILE || '.env' }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get('SUPABASE_DATABASE_URL'),
        // Postgres local (dev) não usa SSL; Supabase (prod) exige. Controlado por DATABASE_SSL.
        ssl: config.get('DATABASE_SSL') === 'false' ? false : { rejectUnauthorized: false },
        entities: [Lead, Conversation, Message, LeadStageHistory, Campaign, WhatsappConfig, MediaFile, Appointment, DeletedLead, User],
        // Schema controlado por migrations (item C). NUNCA reativar em produção.
        synchronize: false,
        // Roda migrations pendentes no boot (antes de atender requisições).
        // Classes importadas (não glob) p/ funcionar tanto em ts-node quanto compilado.
        migrations: [InitialSchema1780170753448, TenantConstraints1780170997907, ClientManagement1780184764189],
        migrationsRun: true,
        logging: false,
      }),
    }),
    AuthModule,
    EvolutionModule,
    LeadsModule,
    CalendarModule,
    BulkMessageModule,
    MediaModule,
    AppointmentsModule,
  ],
})
export class AppModule {}
