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
const leads_service_1 = require("../leads/leads.service");
const ai_service_1 = require("../ai/ai.service");
let EvolutionController = EvolutionController_1 = class EvolutionController {
    evolutionService;
    leadsService;
    aiService;
    logger = new common_1.Logger(EvolutionController_1.name);
    constructor(evolutionService, leadsService, aiService) {
        this.evolutionService = evolutionService;
        this.leadsService = leadsService;
        this.aiService = aiService;
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
        this.logger.log(`Mensagem recebida de ${phone}: ${text}`);
        const { lead, conversation } = await this.leadsService.findOrCreate(phone);
        await this.leadsService.saveMessage(conversation.id, 'inbound', phone, text, message.key.id);
        await this.leadsService.update(lead.id, { lastMessageAt: new Date() });
        const aiResponse = await this.aiService.processMessage(lead, text);
        this.logger.log(`IA respondeu [stage=${aiResponse.stage}]: ${aiResponse.reply}`);
        const updatedContext = this.aiService.buildUpdatedContext(lead, text, aiResponse.reply);
        const updateData = { aiContext: updatedContext };
        if (aiResponse.stage)
            updateData.stage = aiResponse.stage;
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
        await this.evolutionService.sendTextMessage(phone, aiResponse.reply);
        await this.leadsService.saveMessage(conversation.id, 'outbound', 'ai', aiResponse.reply);
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
exports.EvolutionController = EvolutionController = EvolutionController_1 = __decorate([
    (0, common_1.Controller)('webhooks'),
    __metadata("design:paramtypes", [evolution_service_1.EvolutionService,
        leads_service_1.LeadsService,
        ai_service_1.AiService])
], EvolutionController);
//# sourceMappingURL=evolution.controller.js.map