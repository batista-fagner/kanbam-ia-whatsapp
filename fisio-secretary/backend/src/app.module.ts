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
import { Followup } from './common/entities/followup.entity';
import { TokenUsage } from './common/entities/token-usage.entity';
import { ImplantacaoPayment } from './common/entities/implantacao-payment.entity';
import { PromptTemplate } from './common/entities/prompt-template.entity';
import { Agent } from './common/entities/agent.entity';
import { PromptModule as PromptModuleEntity } from './common/entities/prompt-module.entity';
import { InitialSchema1780170753448 } from './migrations/1780170753448-InitialSchema';
import { TenantConstraints1780170997907 } from './migrations/1780170997907-TenantConstraints';
import { ClientManagement1780184764189 } from './migrations/1780184764189-ClientManagement';
import { AddBillingDay1780200000000 } from './migrations/1780200000000-AddBillingDay';
import { AddStripePaymentFields1780210000000 } from './migrations/1780210000000-AddStripePaymentFields';
import { CreateFollowups1780300000000 } from './migrations/1780300000000-CreateFollowups';
import { CreateTokenUsage1780400000000 } from './migrations/1780400000000-CreateTokenUsage';
import { CreateImplantacaoPayments1780500000000 } from './migrations/1780500000000-CreateImplantacaoPayments';
import { AddMediaCaption1780600000000 } from './migrations/1780600000000-AddMediaCaption';
import { AddAutoFollowup1780700000000 } from './migrations/1780700000000-AddAutoFollowup';
import { AddAppointmentReminder1780800000000 } from './migrations/1780800000000-AddAppointmentReminder';
import { AddMediaLimitPerDay1780900000000 } from './migrations/1780900000000-AddMediaLimitPerDay';
import { CreatePromptTemplates1781000000000 } from './migrations/1781000000000-CreatePromptTemplates';
import { CreateAgents1781100000000 } from './migrations/1781100000000-CreateAgents';
import { AddMultiAgentEnabled1781200000000 } from './migrations/1781200000000-AddMultiAgentEnabled';
import { AddLeadCurrentAgent1781300000000 } from './migrations/1781300000000-AddLeadCurrentAgent';
import { AddDeactivationKeyword1782917553913 } from './migrations/1782917553913-AddDeactivationKeyword';
import { AddActivationKeyword1783278000312 } from './migrations/1783278000312-AddActivationKeyword';
import { AddFollowupLimitPerDay1782932396574 } from './migrations/1782932396574-AddFollowupLimitPerDay';
import { AddAgentCapabilities1783000000000 } from './migrations/1783000000000-AddAgentCapabilities';
import { AddAgentCanvasPosition1784000000000 } from './migrations/1784000000000-AddAgentCanvasPosition';
import { AddTokenUsageEngine1784100000000 } from './migrations/1784100000000-AddTokenUsageEngine';
import { AddPromptModules1784200000000 } from './migrations/1784200000000-AddPromptModules';
import { AddPromptModuleMediaCatalog1784300000000 } from './migrations/1784300000000-AddPromptModuleMediaCatalog';
import { AddPromptModuleDateTable1784400000000 } from './migrations/1784400000000-AddPromptModuleDateTable';
import { EvolutionModule } from './evolution/evolution.module';
import { LeadsModule } from './leads/leads.module';
import { CalendarModule } from './calendar/calendar.module';
import { BulkMessageModule } from './bulk-message/bulk-message.module';
import { MediaModule } from './media/media.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { PaymentsModule } from './payments/payments.module';
import { FollowupModule } from './followup/followup.module';
import { TemplatesModule } from './templates/templates.module';
import { AgentsModule } from './agents/agents.module';
import { PromptModulesModule } from './prompt-modules/prompt-modules.module';

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
        entities: [Lead, Conversation, Message, LeadStageHistory, Campaign, WhatsappConfig, MediaFile, Appointment, DeletedLead, User, Followup, TokenUsage, ImplantacaoPayment, PromptTemplate, Agent, PromptModuleEntity],
        // Schema controlado por migrations (item C). NUNCA reativar em produção.
        synchronize: false,
        // Roda migrations pendentes no boot (antes de atender requisições).
        // Classes importadas (não glob) p/ funcionar tanto em ts-node quanto compilado.
        migrations: [InitialSchema1780170753448, TenantConstraints1780170997907, ClientManagement1780184764189, AddBillingDay1780200000000, AddStripePaymentFields1780210000000, CreateFollowups1780300000000, CreateTokenUsage1780400000000, CreateImplantacaoPayments1780500000000, AddMediaCaption1780600000000, AddAutoFollowup1780700000000, AddAppointmentReminder1780800000000, AddMediaLimitPerDay1780900000000, CreatePromptTemplates1781000000000, CreateAgents1781100000000, AddMultiAgentEnabled1781200000000, AddLeadCurrentAgent1781300000000, AddDeactivationKeyword1782917553913, AddFollowupLimitPerDay1782932396574, AddAgentCapabilities1783000000000, AddAgentCanvasPosition1784000000000, AddActivationKeyword1783278000312, AddTokenUsageEngine1784100000000, AddPromptModules1784200000000, AddPromptModuleMediaCatalog1784300000000, AddPromptModuleDateTable1784400000000],
        migrationsRun: true,
        logging: false,
      }),
    }),
    AuthModule,
    PaymentsModule,
    BillingModule,
    EvolutionModule,
    LeadsModule,
    CalendarModule,
    BulkMessageModule,
    MediaModule,
    AppointmentsModule,
    FollowupModule,
    TemplatesModule,
    AgentsModule,
    PromptModulesModule,
  ],
})
export class AppModule {}
