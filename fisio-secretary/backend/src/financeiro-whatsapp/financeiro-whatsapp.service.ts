import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FinanceiroWhatsappMessage } from '../common/entities/financeiro-whatsapp-message.entity';
import { WhatsappConfig } from '../common/entities/whatsapp-config.entity';

export interface FinanceiroConversation {
  phone: string;
  clientName: string | null;
  tenantId: string | null;
  lastMessage: string;
  lastMessageAt: Date;
  lastDirection: 'inbound' | 'outbound';
}

@Injectable()
export class FinanceiroWhatsappService {
  constructor(
    @InjectRepository(FinanceiroWhatsappMessage)
    private readonly repo: Repository<FinanceiroWhatsappMessage>,
    @InjectRepository(WhatsappConfig)
    private readonly configRepo: Repository<WhatsappConfig>,
  ) {}

  // Resolve nome/tenant do cliente pelo telefone de cobrança cadastrado — usado
  // pra rotular tanto mensagens recebidas quanto enviadas com o nome do cliente
  // em vez de só o número cru.
  private async resolveClient(phone: string): Promise<{ clientName: string | null; tenantId: string | null }> {
    const digits = phone.replace(/\D/g, '');
    // billing_phone é cadastrado sem DDI (ex: "17992173102"), mas o webhook Meta
    // sempre manda o "from" com DDI (ex: "5517992173102") — compara os dois jeitos
    // pra não depender de como o número foi salvo.
    const local = digits.startsWith('55') && digits.length > 11 ? digits.slice(2) : digits;
    const config = await this.configRepo
      .createQueryBuilder('c')
      .where(
        `regexp_replace(c.billing_phone, '\\D', '', 'g') IN (:...variants)`,
        { variants: [local, `55${local}`] },
      )
      .getOne();
    return { clientName: config?.displayName ?? null, tenantId: config?.id ?? null };
  }

  async saveInbound(phone: string, content: string, externalMessageId: string | null): Promise<FinanceiroWhatsappMessage> {
    const { clientName, tenantId } = await this.resolveClient(phone);
    const message = this.repo.create({ phone, direction: 'inbound', content, clientName, tenantId, externalMessageId });
    return this.repo.save(message);
  }

  async saveOutbound(phone: string, content: string): Promise<FinanceiroWhatsappMessage> {
    const { clientName, tenantId } = await this.resolveClient(phone);
    const message = this.repo.create({ phone, direction: 'outbound', content, clientName, tenantId, externalMessageId: null });
    return this.repo.save(message);
  }

  async listConversations(): Promise<FinanceiroConversation[]> {
    const rows: any[] = await this.repo
      .createQueryBuilder('m')
      .distinctOn(['m.phone'])
      .orderBy('m.phone')
      .addOrderBy('m.created_at', 'DESC')
      .getMany();

    return rows
      .map((m) => ({
        phone: m.phone,
        clientName: m.clientName,
        tenantId: m.tenantId,
        lastMessage: m.content,
        lastMessageAt: m.createdAt,
        lastDirection: m.direction,
      }))
      .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
  }

  async listMessages(phone: string): Promise<FinanceiroWhatsappMessage[]> {
    return this.repo.find({ where: { phone }, order: { createdAt: 'ASC' } });
  }
}
