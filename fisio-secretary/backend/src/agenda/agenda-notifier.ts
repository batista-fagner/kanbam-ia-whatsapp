import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Appointment } from '../common/entities/appointment.entity';
import { AgendaProfessional } from '../common/entities/agenda-professional.entity';
import { WhatsappConfig } from '../common/entities/whatsapp-config.entity';
import { SP_TZ } from '../common/utils/sp-time.util';

export type AgendaEvent = 'novo' | 'remarcado' | 'cancelado';

// Avisa no WhatsApp o profissional (se tiver número e aviso ligado) e o número de avisos do
// salão (whatsapp_config.notification_phone) a cada agendamento, remarcação ou cancelamento.
// Sai pela instância do próprio salão. Falha de envio só loga — nunca derruba o agendamento.
@Injectable()
export class AgendaNotifier {
  private readonly logger = new Logger(AgendaNotifier.name);

  constructor(
    @InjectRepository(AgendaProfessional) private readonly profRepo: Repository<AgendaProfessional>,
    @InjectRepository(WhatsappConfig) private readonly configRepo: Repository<WhatsappConfig>,
    private readonly config: ConfigService,
  ) {}

  async notify(event: AgendaEvent, appt: Appointment, extra: { previousStart?: Date | null; source?: 'ia' | 'manual' } = {}): Promise<void> {
    try {
      if (!appt.tenantId) return;
      const tenant = await this.configRepo.findOne({ where: { id: appt.tenantId } });
      const prof = appt.professionalId ? await this.profRepo.findOne({ where: { id: appt.professionalId } }) : null;
      const token = tenant?.instanceToken || this.config.get<string>('UAZAPI_TOKEN') || '';
      const baseUrl = (this.config.get<string>('UAZAPI_BASE_URL') ?? '').replace(/\/$/, '');
      if (!token || !baseUrl) return;

      const text = buildAgendaMessage(event, appt, prof?.name ?? null, extra.previousStart ?? null, extra.source ?? (appt.source ?? 'manual'));
      const targets = new Set<string>();
      if (prof?.whatsapp && prof.notify) targets.add(normalize(prof.whatsapp));
      if (tenant?.notificationPhone) targets.add(normalize(tenant.notificationPhone));

      for (const number of targets) {
        try {
          const r = await fetch(`${baseUrl}/send/text`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', token },
            body: JSON.stringify({ number, text }),
          });
          if (!r.ok) this.logger.warn(`[AGENDA] Aviso "${event}" falhou para ${number} (HTTP ${r.status}) — appt ${appt.id}`);
          else this.logger.log(`[AGENDA] Aviso "${event}" enviado para ${number} — appt ${appt.id}`);
        } catch (err) {
          this.logger.warn(`[AGENDA] Aviso "${event}" falhou para ${number}: ${err?.message} — appt ${appt.id}`);
        }
      }
    } catch (err) {
      this.logger.error(`[AGENDA] Erro ao montar aviso "${event}" (appt ${appt.id}): ${err?.message}`);
    }
  }
}

function normalize(phone: string): string {
  const d = phone.replace(/\D/g, '');
  return d.startsWith('55') ? d : `55${d}`;
}

export function formatWhen(d: Date): string {
  const dia = d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: SP_TZ }).replace('.', '');
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: SP_TZ });
  return `${dia} às ${hora}`;
}

export function buildAgendaMessage(event: AgendaEvent, appt: Appointment, professionalName: string | null, previousStart: Date | null, source: 'ia' | 'manual'): string {
  const title = event === 'novo' ? '📅 *Novo agendamento*' : event === 'remarcado' ? '🔁 *Agendamento remarcado*' : '❌ *Agendamento cancelado*';
  const lines = [
    title,
    '',
    `👤 ${appt.clientName}${appt.clientPhone ? ` (${appt.clientPhone})` : ''}`,
    `💇 ${appt.service}`,
    `🕐 ${formatWhen(appt.startDateTime)}`,
  ];
  if (event === 'remarcado' && previousStart) lines.push(`   (antes: ${formatWhen(previousStart)})`);
  if (professionalName) lines.push(`✂️ ${professionalName}`);
  lines.push('', source === 'ia' ? '🤖 Pela IA no WhatsApp' : '🖐️ Pela recepção');
  return lines.join('\n');
}
