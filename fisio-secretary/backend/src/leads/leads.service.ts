import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Lead, LeadStage } from '../common/entities/lead.entity';
import { Conversation } from '../common/entities/conversation.entity';
import { Message } from '../common/entities/message.entity';
import { LeadStageHistory } from '../common/entities/lead-stage-history.entity';

@Injectable()
export class LeadsService {
  constructor(
    @InjectRepository(Lead)
    private leadsRepo: Repository<Lead>,
    @InjectRepository(Conversation)
    private conversationsRepo: Repository<Conversation>,
    @InjectRepository(Message)
    private messagesRepo: Repository<Message>,
    @InjectRepository(LeadStageHistory)
    private historyRepo: Repository<LeadStageHistory>,
  ) {}

  async findOrCreate(phone: string): Promise<{ lead: Lead; conversation: Conversation; isNew: boolean }> {
    let lead = await this.leadsRepo.findOne({ where: { phone } });
    let isNew = false;

    if (!lead) {
      lead = this.leadsRepo.create({ phone, stage: 'novo_lead' });
      lead = await this.leadsRepo.save(lead);

      await this.historyRepo.save({
        leadId: lead.id,
        fromStage: null,
        toStage: 'novo_lead',
        changedBy: 'system',
      });

      isNew = true;
    }

    let conversation = await this.conversationsRepo.findOne({ where: { leadId: lead.id } });
    if (!conversation) {
      conversation = this.conversationsRepo.create({ leadId: lead.id });
      conversation = await this.conversationsRepo.save(conversation);
    }

    return { lead, conversation, isNew };
  }

  async saveMessage(
    conversationId: string,
    direction: 'inbound' | 'outbound',
    sender: string,
    content: string,
    evolutionId?: string,
  ): Promise<Message> {
    const msg = this.messagesRepo.create({
      conversationId,
      direction,
      sender,
      content,
      evolutionId,
    });
    return this.messagesRepo.save(msg);
  }

  async updateStage(leadId: string, toStage: LeadStage, changedBy: string): Promise<Lead> {
    const lead = await this.leadsRepo.findOneOrFail({ where: { id: leadId } });
    const fromStage = lead.stage;

    lead.stage = toStage;
    await this.leadsRepo.save(lead);

    await this.historyRepo.save({ leadId, fromStage, toStage, changedBy });

    return lead;
  }

  async update(leadId: string, data: Partial<Lead>): Promise<Lead> {
    await this.leadsRepo.update(leadId, data);
    return this.leadsRepo.findOneOrFail({ where: { id: leadId } });
  }

  async findAll(): Promise<Lead[]> {
    return this.leadsRepo.find({ order: { lastMessageAt: 'DESC' } });
  }

  async findOne(id: string): Promise<Lead | null> {
    return this.leadsRepo.findOne({ where: { id } });
  }

  async getConversationWithMessages(leadId: string) {
    return this.conversationsRepo.findOne({
      where: { leadId },
      relations: ['messages'],
      order: { messages: { createdAt: 'ASC' } } as any,
    });
  }

  async getHistory(leadId: string) {
    return this.historyRepo.find({
      where: { leadId },
      order: { createdAt: 'ASC' },
    });
  }

  async toggleAi(leadId: string, enabled: boolean): Promise<void> {
    const conversation = await this.conversationsRepo.findOne({ where: { leadId } });
    if (conversation) {
      conversation.aiEnabled = enabled;
      await this.conversationsRepo.save(conversation);
    }
  }

  async getAiEnabled(leadId: string): Promise<boolean> {
    const conversation = await this.conversationsRepo.findOne({ where: { leadId } });
    return conversation?.aiEnabled ?? true;
  }
}
