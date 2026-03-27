import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Lead } from '../common/entities/lead.entity';
import { Conversation } from '../common/entities/conversation.entity';
import { Message } from '../common/entities/message.entity';
import { LeadStageHistory } from '../common/entities/lead-stage-history.entity';
import { LeadsService } from './leads.service';
import { LeadsController } from './leads.controller';
import { LeadsGateway } from './leads.gateway';

@Module({
  imports: [TypeOrmModule.forFeature([Lead, Conversation, Message, LeadStageHistory])],
  providers: [LeadsService, LeadsGateway],
  controllers: [LeadsController],
  exports: [LeadsService, LeadsGateway],
})
export class LeadsModule {}
