// Gatilhos do follow-up por evento (modo QUEUE_ENGINE=bullmq).
//
// Em vez de crons varrendo o banco atrás de lead parado / toque vencido / lembrete na
// janela, quem mexe no dado avisa aqui e o FollowupService agenda um job com delay na
// fila followup-triggers. Os pontos que emitem são poucos e centrais: salvar mensagem,
// mudar raia e religar a IA (leads.service), criar/remarcar agendamento (appointments e
// agenda) e salvar a config em Regras de Alertas (whatsapp-config.service).
//
// Singleton de módulo, sem DI, de propósito: LeadsModule/AppointmentsModule não podem
// importar o FollowupModule (que já importa os dois — seria import circular), e os specs
// que constroem esses services na mão continuam funcionando sem argumento novo.
//
// emit() NUNCA lança e NUNCA espera: o ouvinte roda fire-and-forget. Quem emite está no
// caminho da resposta da IA (saveMessage) — Redis lento ou fora do ar não pode atrasar
// nem derrubar o atendimento, no máximo deixa de agendar aquele follow-up (com log).

export type FollowupTrigger =
  | { kind: 'message'; tenantId: string; leadId: string; messageId: string; direction: 'inbound' | 'outbound'; at: Date }
  | { kind: 'stage'; tenantId: string; leadId: string }
  | { kind: 'ai-enabled'; leadId: string }
  | { kind: 'appointment'; appointmentId: string }
  | { kind: 'config'; tenantId: string };

type Listener = (trigger: FollowupTrigger) => void;

class FollowupTriggers {
  private listener: Listener | null = null;

  // Só o FollowupService registra, e só no modo bullmq — no legado ninguém ouve e o emit
  // é um no-op (os crons continuam fazendo o trabalho).
  setListener(listener: Listener | null): void {
    this.listener = listener;
  }

  emit(trigger: FollowupTrigger): void {
    if (!this.listener) return;
    try {
      this.listener(trigger);
    } catch {
      // ouvinte é fire-and-forget e já loga as próprias falhas
    }
  }
}

export const followupTriggers = new FollowupTriggers();
