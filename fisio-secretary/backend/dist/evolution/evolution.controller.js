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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var EvolutionController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.EvolutionController = void 0;
const common_1 = require("@nestjs/common");
const evolution_service_1 = require("./evolution.service");
const message_queue_service_1 = require("./message-queue.service");
const leads_service_1 = require("../leads/leads.service");
const ai_service_1 = require("../ai/ai.service");
const leads_gateway_1 = require("../leads/leads.gateway");
const calendar_service_1 = require("../calendar/calendar.service");
let EvolutionController = EvolutionController_1 = class EvolutionController {
    evolutionService;
    messageQueue;
    leadsService;
    aiService;
    leadsGateway;
    calendarService;
    logger = new common_1.Logger(EvolutionController_1.name);
    processedIds = new Set();
    constructor(evolutionService, messageQueue, leadsService, aiService, leadsGateway, calendarService) {
        this.evolutionService = evolutionService;
        this.messageQueue = messageQueue;
        this.leadsService = leadsService;
        this.aiService = aiService;
        this.leadsGateway = leadsGateway;
        this.calendarService = calendarService;
    }
    async handleWebhook(body) {
        if (body.event !== 'messages.upsert')
            return { ok: true };
        const message = body.data;
        if (!message?.key || message.key.fromMe)
            return { ok: true };
        const remoteJid = message.key.remoteJid ?? '';
        if (remoteJid.includes('@g.us'))
            return { ok: true };
        const phone = remoteJid.replace('@s.whatsapp.net', '').replace('@lid', '');
        const text = message.message?.conversation || message.message?.extendedTextMessage?.text;
        if (!phone || !text)
            return { ok: true };
        const messageId = message.key.id;
        if (this.processedIds.has(messageId)) {
            this.logger.warn(`Webhook duplicado ignorado: ${messageId}`);
            return { ok: true };
        }
        this.processedIds.add(messageId);
        setTimeout(() => this.processedIds.delete(messageId), 5 * 60 * 1000);
        this.logger.log(`Mensagem recebida de ${phone}: ${text}`);
        this.messageQueue.enqueue(phone, text, (combinedText) => {
            this.processMessage(phone, combinedText, message.key.id).catch((err) => this.logger.error(`Erro ao processar mensagem de ${phone}: ${err.message}`));
        });
        return { ok: true };
    }
    async processMessage(phone, combinedText, messageKeyId) {
        const { lead, conversation } = await this.leadsService.findOrCreate(phone);
        await this.leadsService.saveMessage(conversation.id, 'inbound', phone, combinedText, messageKeyId);
        await this.leadsService.update(lead.id, { lastMessageAt: new Date() });
        void this.evolutionService.sendTypingIndicator(phone, 5000);
        const aiResponse = await this.aiService.processMessage(lead, combinedText);
        this.logger.log(`IA respondeu [stage=${aiResponse.stage}]: ${aiResponse.reply}`);
        const updatedContext = aiResponse.success
            ? this.aiService.buildUpdatedContext(lead, combinedText, aiResponse.rawJson)
            : lead.aiContext;
        const updateData = { aiContext: updatedContext };
        if (aiResponse.temperature)
            updateData.temperature = aiResponse.temperature;
        if (aiResponse.fields) {
            const f = aiResponse.fields;
            if (f.name)
                updateData.name = f.name;
            if (f.symptoms)
                updateData.symptoms = f.symptoms;
            if (f.urgency)
                updateData.urgency = f.urgency;
            if (f.availability)
                updateData.availability = f.availability;
            if (f.budget)
                updateData.budget = f.budget;
            if (f.qualificationScore !== undefined)
                updateData.qualificationScore = f.qualificationScore;
            if (f.qualificationStep !== undefined)
                updateData.qualificationStep = f.qualificationStep;
        }
        await this.leadsService.update(lead.id, updateData);
        if (aiResponse.stage && aiResponse.stage !== lead.stage) {
            const stageOrder = {
                novo_lead: 0, qualificando: 1, lead_quente: 2, lead_frio: 2,
                agendado: 3, convertido: 4, perdido: 4,
            };
            const currentOrder = stageOrder[lead.stage] ?? 0;
            const newOrder = stageOrder[aiResponse.stage] ?? 0;
            const canRegress = ['lead_frio', 'perdido'].includes(aiResponse.stage);
            if (newOrder >= currentOrder || canRegress) {
                await this.leadsService.updateStage(lead.id, aiResponse.stage, 'ai');
            }
            else {
                this.logger.warn(`Stage regressivo bloqueado: ${lead.stage} → ${aiResponse.stage}`);
            }
        }
        const action = aiResponse.action;
        if (action === 'schedule' && aiResponse.appointmentDateTime) {
            const startDateTime = new Date(aiResponse.appointmentDateTime);
            const { available, conflictingEvent } = await this.calendarService.checkAvailability(startDateTime);
            if (!available) {
                this.logger.warn(`Horário ocupado: ${startDateTime.toISOString()} (${conflictingEvent})`);
                const busyReply = `Ops! Esse horário já está ocupado (${conflictingEvent}). Por favor, escolha outro horário ou dia 😊`;
                await this.evolutionService.sendTextMessage(phone, busyReply);
                await this.leadsService.saveMessage(conversation.id, 'outbound', 'ai', busyReply);
                const updatedLead = await this.leadsService.findOne(lead.id);
                this.leadsGateway.emitLeadUpdated(updatedLead);
                return;
            }
            const eventId = await this.calendarService.createAppointment({
                leadName: lead.name || lead.phone,
                phone: lead.phone,
                symptoms: lead.symptoms || '',
                startDateTime,
            });
            if (eventId) {
                await this.leadsService.update(lead.id, { calendarEventId: eventId, appointmentAt: startDateTime });
            }
        }
        if (action === 'cancel' && lead.calendarEventId) {
            await this.calendarService.cancelAppointment(lead.calendarEventId);
            await this.leadsService.update(lead.id, { calendarEventId: null, appointmentAt: null });
        }
        if (action === 'reschedule' && aiResponse.appointmentDateTime) {
            const newDateTime = new Date(aiResponse.appointmentDateTime);
            const { available, conflictingEvent } = await this.calendarService.checkAvailability(newDateTime);
            if (!available) {
                this.logger.warn(`Reagendamento bloqueado — horário ocupado: ${newDateTime.toISOString()}`);
                const busyReply = `Esse horário também está ocupado (${conflictingEvent}). Tem outro horário de preferência? 😊`;
                await this.evolutionService.sendTextMessage(phone, busyReply);
                await this.leadsService.saveMessage(conversation.id, 'outbound', 'ai', busyReply);
                const updatedLead = await this.leadsService.findOne(lead.id);
                this.leadsGateway.emitLeadUpdated(updatedLead);
                return;
            }
            if (lead.calendarEventId) {
                await this.calendarService.updateAppointment(lead.calendarEventId, newDateTime);
                await this.leadsService.update(lead.id, { appointmentAt: newDateTime });
            }
            else {
                const eventId = await this.calendarService.createAppointment({
                    leadName: lead.name || lead.phone,
                    phone: lead.phone,
                    symptoms: lead.symptoms || '',
                    startDateTime: newDateTime,
                });
                if (eventId) {
                    await this.leadsService.update(lead.id, { calendarEventId: eventId, appointmentAt: newDateTime });
                }
            }
        }
        await this.evolutionService.sendTextMessage(phone, aiResponse.reply);
        await this.leadsService.saveMessage(conversation.id, 'outbound', 'ai', aiResponse.reply);
        const updatedLead = await this.leadsService.findOne(lead.id);
        this.leadsGateway.emitLeadUpdated(updatedLead);
    }
    async sendManual(body) {
        const { lead, conversation } = await this.leadsService.findOrCreate(body.phone);
        await this.evolutionService.sendTextMessage(body.phone, body.text);
        await this.leadsService.saveMessage(conversation.id, 'outbound', 'operator', body.text);
        await this.leadsService.update(lead.id, { lastMessageAt: new Date() });
        const updatedLead = await this.leadsService.findOne(lead.id);
        this.leadsGateway.emitLeadUpdated(updatedLead);
        return { ok: true };
    }
};
exports.EvolutionController = EvolutionController;
__decorate([
    (0, common_1.Post)('evolution'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], EvolutionController.prototype, "handleWebhook", null);
__decorate([
    (0, common_1.Post)('manual'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], EvolutionController.prototype, "sendManual", null);
exports.EvolutionController = EvolutionController = EvolutionController_1 = __decorate([
    (0, common_1.Controller)('webhooks'),
    __metadata("design:paramtypes", [evolution_service_1.EvolutionService,
        message_queue_service_1.MessageQueueService,
        leads_service_1.LeadsService,
        ai_service_1.AiService,
        leads_gateway_1.LeadsGateway,
        calendar_service_1.CalendarService])
], EvolutionController);
//# sourceMappingURL=evolution.controller.js.map