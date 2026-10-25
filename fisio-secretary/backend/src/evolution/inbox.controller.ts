import { Body, Controller, NotFoundException, BadRequestException, Post, UseGuards, Logger } from '@nestjs/common';
import { UazapiProvider } from './providers/uazapi.provider';
import { WhatsappConfigService } from './whatsapp-config.service';
import { LeadsService } from '../leads/leads.service';
import { LeadsGateway } from '../leads/leads.gateway';
import { MediaService } from '../media/media.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

// O body JSON aceita 10 MB (main.ts); em base64 o arquivo cresce ~33%.
const MAX_FILE_BYTES = 7 * 1024 * 1024;

// Envio de arquivo do computador pela Inbox (foto, vídeo, PDF, planilha…). Texto, áudio
// gravado e mídia do catálogo continuam nos endpoints /webhooks/manual* do Kanban.
@UseGuards(JwtAuthGuard)
@Controller('inbox')
export class InboxController {
  private readonly logger = new Logger(InboxController.name);

  constructor(
    private readonly uazapiProvider: UazapiProvider,
    private readonly whatsappConfigService: WhatsappConfigService,
    private readonly leadsService: LeadsService,
    private readonly leadsGateway: LeadsGateway,
    private readonly mediaService: MediaService,
  ) {}

  @Post('send-file')
  async sendFile(
    @Body() body: { leadId: string; base64: string; mimeType: string; fileName?: string; caption?: string },
    @CurrentUser('tenantId') tenantId: string,
  ) {
    if (!body?.leadId || !body?.base64) throw new BadRequestException('Arquivo não enviado');
    const lead = await this.leadsService.findOne(body.leadId, tenantId);
    if (!lead) throw new NotFoundException('Lead não encontrado');
    const buffer = Buffer.from(body.base64, 'base64');
    if (buffer.length > MAX_FILE_BYTES) throw new BadRequestException('Arquivo muito grande (máx. 7 MB)');

    const mime = (body.mimeType || 'application/octet-stream').split(';')[0].trim();
    const type: 'image' | 'video' | 'document' = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : 'document';
    const fileName = (body.fileName || 'arquivo').replace(/[\r\n\]]/g, ' ').slice(0, 120);
    const caption = body.caption?.trim() ?? '';

    const { conversation } = await this.leadsService.findOrCreate(lead.phone, tenantId);
    const tenantToken = await this.whatsappConfigService.getTokenByTenant(tenantId);
    const url = await this.mediaService.uploadOutboundFile(buffer, tenantId, lead.id, mime, fileName);

    this.logger.log(`📤 [INBOX-FILE] Enviando ${type} "${fileName}" para ${lead.phone}`);
    const sent = await this.uazapiProvider.sendMediaByUrl(lead.phone, url, type, caption, tenantToken, type === 'document' ? fileName : undefined);
    if (!sent.ok) throw new BadRequestException('O WhatsApp não aceitou o arquivo. Tente de novo.');

    // Mesmos marcadores que o histórico já entende ("[imagem]", "[vídeo]", "[documento: nome]").
    const marker = type === 'image' ? '[imagem]' : type === 'video' ? '[vídeo]' : `[documento: ${fileName}]`;
    const content = caption ? `${marker} ${caption}` : marker;
    const message = await this.leadsService.saveMessage(conversation.id, 'outbound', 'operator', content, undefined, url, type);
    const updatedLead = await this.leadsService.findOne(lead.id, tenantId);
    this.leadsGateway.emitLeadUpdated(updatedLead);
    return { ok: true, message };
  }
}
