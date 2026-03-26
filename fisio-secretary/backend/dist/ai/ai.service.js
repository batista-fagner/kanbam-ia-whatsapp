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

REGRAS:
- Mensagens curtas, máximo 3 linhas.
- Tom acolhedor, nunca clínico/formal demais.
- Colete apenas uma informação por mensagem.
- Se o lead demonstrar urgência alta (dor forte, acidente recente), priorize o agendamento.

RESPONDA SEMPRE em JSON com este formato exato:
{
  "reply": "texto da resposta para o lead",
  "stage": "novo_lead|qualificando|lead_quente|lead_frio|agendado",
  "temperature": "quente|morno|frio",
  "fields": {
    "name": "nome se coletado",
    "symptoms": "sintomas se coletados",
    "urgency": "alta|media|baixa se identificado",
    "availability": "disponibilidade se coletada",
    "budget": "confirmado|recusado se reagiu ao valor",
    "qualificationScore": número de 0 a 100,
    "qualificationStep": 0 a 3
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
            const parsed = JSON.parse(raw);
            return parsed;
        }
        catch (err) {
            this.logger.error(`Erro ao chamar Claude: ${err.message}`);
            this.logger.error(err.stack);
            return { reply: 'Olá! Tive um probleminha aqui, pode repetir?' };
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