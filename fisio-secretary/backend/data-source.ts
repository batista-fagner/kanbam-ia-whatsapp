import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';

// Carrega o env escolhido (ENV_FILE=.env.development no dev; .env por padrão).
dotenv.config({ path: process.env.ENV_FILE || '.env' });

import { Lead } from './src/common/entities/lead.entity';
import { Conversation } from './src/common/entities/conversation.entity';
import { Message } from './src/common/entities/message.entity';
import { LeadStageHistory } from './src/common/entities/lead-stage-history.entity';
import { Campaign } from './src/common/entities/campaign.entity';
import { WhatsappConfig } from './src/common/entities/whatsapp-config.entity';
import { MediaFile } from './src/common/entities/media-file.entity';
import { Appointment } from './src/common/entities/appointment.entity';
import { DeletedLead } from './src/common/entities/deleted-lead.entity';
import { User } from './src/common/entities/user.entity';
import { Followup } from './src/common/entities/followup.entity';

// DataSource usado SOMENTE pelo CLI do TypeORM (migration:generate/run/revert).
// O app em runtime usa a config do app.module.ts.
export default new DataSource({
  type: 'postgres',
  url: process.env.SUPABASE_DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  entities: [
    Lead, Conversation, Message, LeadStageHistory, Campaign,
    WhatsappConfig, MediaFile, Appointment, DeletedLead, User, Followup,
  ],
  migrations: ['src/migrations/*.ts'],
  synchronize: false,
});
