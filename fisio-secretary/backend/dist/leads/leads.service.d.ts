import { Repository } from 'typeorm';
import { Lead, LeadStage } from '../common/entities/lead.entity';
import { Conversation } from '../common/entities/conversation.entity';
import { Message } from '../common/entities/message.entity';
import { LeadStageHistory } from '../common/entities/lead-stage-history.entity';
export declare class LeadsService {
    private leadsRepo;
    private conversationsRepo;
    private messagesRepo;
    private historyRepo;
    constructor(leadsRepo: Repository<Lead>, conversationsRepo: Repository<Conversation>, messagesRepo: Repository<Message>, historyRepo: Repository<LeadStageHistory>);
    findOrCreate(phone: string): Promise<{
        lead: Lead;
        conversation: Conversation;
        isNew: boolean;
    }>;
    saveMessage(conversationId: string, direction: 'inbound' | 'outbound', sender: string, content: string, evolutionId?: string): Promise<Message>;
    updateStage(leadId: string, toStage: LeadStage, changedBy: string): Promise<Lead>;
    update(leadId: string, data: Partial<Lead>): Promise<Lead>;
    findAll(): Promise<Lead[]>;
    findOne(id: string): Promise<Lead | null>;
    getConversationWithMessages(leadId: string): Promise<Conversation | null>;
}
