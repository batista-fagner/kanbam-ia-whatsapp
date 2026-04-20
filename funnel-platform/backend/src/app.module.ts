import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Lead } from './common/entities/lead.entity';
import { Campaign } from './common/entities/campaign.entity';
import { Form } from './common/entities/form.entity';
import { LeadsModule } from './leads/leads.module';
import { EnrichmentModule } from './enrichment/enrichment.module';
import { MessagingModule } from './messaging/messaging.module';
import { FormsModule } from './forms/forms.module';
import { FacebookModule } from './facebook/facebook.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        url: config.get('DATABASE_URL') || config.get('SUPABASE_DATABASE_URL'),
        ssl: { rejectUnauthorized: false },
        entities: [Lead, Campaign, Form],
        synchronize: true,
        logging: false,
      }),
    }),
    LeadsModule,
    EnrichmentModule,
    // MessagingModule, // TODO: Ficar para depois
    FormsModule,
    FacebookModule,
  ],
})
export class AppModule {}
