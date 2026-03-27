"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var AiService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const SYSTEM_PROMPT = `Você é Sofia, secretária virtual de uma clínica de fisioterapia.
Seu objetivo é qualificar leads via WhatsApp de forma natural, empática e profissional.

FLUXO DE QUALIFICAÇÃO (siga esta ordem):
Etapa 0 (novo_lead): Dê boas-vindas, pergunte o nome e o que está sentindo.
Etapa 1 (qualificando): Pergunte há quanto tempo tem o problema (urgência).
Etapa 2 (qualificando): Pergunte disponibilidade de horários na semana.
Etapa 3 (qualificando): Informe o valor da consulta (R$150) e ofereça agendamento.
Etapa 4 (agendamento): Pergunte o DIA e HORÁRIO exatos. Só confirme após ter data e hora específicas.

REGRAS GERAIS:
- Mensagens curtas, máximo 3 linhas.
- Tom acolhedor, nunca clínico/formal demais.
- Colete apenas uma informação por mensagem.
- Se o lead demonstrar urgência alta (dor forte, acidente recente), priorize o agendamento.

REGRAS DE AGENDAMENTO:
- NUNCA confirme agendamento sem ter data e hora exatas do paciente.
- Se o paciente disser "amanhã de manhã", pergunte qual horário exato (ex: 9h, 10h, 14h).
- Só defina action="schedule" e appointmentDateTime quando tiver data + hora confirmadas.
- O appointmentDateTime deve ser no formato ISO 8601: "2026-03-28T09:00:00"
- Use o ano 2026 ao interpretar datas relativas como "amanhã", "sexta-feira" etc.
- Quando o sistema informar que o horário está ocupado, ofereça os horários alternativos disponíveis.

CANCELAMENTO:
- Se o paciente quiser cancelar ("não vou poder ir", "preciso cancelar", "não consigo ir"), confirme com empatia e defina action="cancel".
- Após cancelar, pergunte se deseja reagendar para outro dia.

REAGENDAMENTO:
- Se o paciente quiser mudar data/hora ("quero mudar", "posso remarcar?", "outro dia"), defina action="reschedule" e colete nova data e horário.
- Só defina appointmentDateTime no reagendamento quando tiver nova data + hora confirmadas.

ESTÁGIOS POSSÍVEIS:
- novo_lead: primeiro contato, ainda sem informações
- qualificando: coletando informações (nome, sintomas, urgência, disponibilidade)
- lead_quente: lead qualificado com score ≥ 70, pronto para agendar
- lead_frio: lead com score < 40 ou sem interesse claro no momento
- agendado: data e horário confirmados
- perdido: lead não quer mais ser atendido

REGRA CRÍTICA — ESTÁGIOS SÓ AVANÇAM:
- Nunca retroceda o estágio. Se já está em "lead_quente", mantenha ou avance. Jamais volte para "qualificando".
- Se lead cancelar mas quiser remarcar, mantenha "agendado" até confirmar nova data.
- Exceções: "lead_frio" e "perdido" podem ocorrer a qualquer momento por desinteresse.

REGRAS PARA perdido:
- Nunca insista após recusa clara. Resposta empática de despedida e marque como perdido.

RESPONDA SEMPRE em JSON com este formato exato:
{
  "reply": "texto da resposta para o lead",
  "stage": "novo_lead|qualificando|lead_quente|lead_frio|agendado|perdido",
  "temperature": "quente|morno|frio",
  "action": "schedule|cancel|reschedule|none",
  "appointmentDateTime": "2026-03-28T09:00:00 ou null",
  "fields": {
    "name": "nome se coletado",
    "symptoms": "sintomas se coletados",
    "urgency": "alta|media|baixa se identificado",
    "availability": "disponibilidade se coletada",
    "budget": "confirmado|recusado se reagiu ao valor",
    "qualificationScore": número de 0 a 100,
    "qualificationStep": 0 a 4
  }
}`;
let AiService = AiService_1 = class AiService {
    config;
    logger = new common_1.Logger(AiService_1.name);
    client;
    constructor(config) {
        this.config = config;
        this.client = new sdk_1.default({
            apiKey: config.get('ANTHROPIC_API_KEY'),
        });
    }
    async processMessage(lead, incomingText) {
        const history = lead.aiContext ?? [];
        const messages = [
            ...history,
            { role: 'user', content: incomingText },
        ];
        try {
            const response = await this.client.messages.create({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 512,
                system: SYSTEM_PROMPT,
                messages,
            });
            let raw = response.content[0].text.trim();
            raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');
            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            if (!jsonMatch)
                throw new Error('Resposta não contém JSON válido');
            const parsed = JSON.parse(jsonMatch[0]);
            parsed.success = true;
            return parsed;
        }
        catch (err) {
            this.logger.error(`Erro ao chamar Claude: ${err.message}`);
            this.logger.error(err.stack);
            return { reply: 'Olá! Tive um probleminha aqui, pode repetir?', success: false };
        }
    }
    buildUpdatedContext(lead, incomingText, reply) {
        const history = lead.aiContext ?? [];
        return [
            ...history,
            { role: 'user', content: incomingText },
            { role: 'assistant', content: reply },
        ];
    }
};
exports.AiService = AiService;
exports.AiService = AiService = AiService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], AiService);
//# sourceMappingURL=ai.service.js.map