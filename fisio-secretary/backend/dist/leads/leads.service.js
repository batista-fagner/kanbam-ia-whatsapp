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
Object.defineProperty(exports, "__esModule", { value: true });
exports.LeadsService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const lead_entity_1 = require("../common/entities/lead.entity");
const conversation_entity_1 = require("../common/entities/conversation.entity");
const message_entity_1 = require("../common/entities/message.entity");
const lead_stage_history_entity_1 = require("../common/entities/lead-stage-history.entity");
let LeadsService = class LeadsService {
    leadsRepo;
    conversationsRepo;
    messagesRepo;
    historyRepo;
    constructor(leadsRepo, conversationsRepo, messagesRepo, historyRepo) {
        this.leadsRepo = leadsRepo;
        this.conversationsRepo = conversationsRepo;
        this.messagesRepo = messagesRepo;
        this.historyRepo = historyRepo;
    }
    async findOrCreate(phone) {
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
    async saveMessage(conversationId, direction, sender, content, evolutionId) {
        const msg = this.messagesRepo.create({
            conversationId,
            direction,
            sender,
            content,
            evolutionId,
        });
        return this.messagesRepo.save(msg);
    }
    async updateStage(leadId, toStage, changedBy) {
        const lead = await this.leadsRepo.findOneOrFail({ where: { id: leadId } });
        const fromStage = lead.stage;
        lead.stage = toStage;
        await this.leadsRepo.save(lead);
        await this.historyRepo.save({ leadId, fromStage, toStage, changedBy });
        return lead;
    }
    async update(leadId, data) {
        await this.leadsRepo.update(leadId, data);
        return this.leadsRepo.findOneOrFail({ where: { id: leadId } });
    }
    async findAll() {
        return this.leadsRepo.find({ order: { lastMessageAt: 'DESC' } });
    }
    async findOne(id) {
        return this.leadsRepo.findOne({ where: { id } });
    }
    async getConversationWithMessages(leadId) {
        return this.conversationsRepo.findOne({
            where: { leadId },
            relations: ['messages'],
            order: { messages: { createdAt: 'ASC' } },
        });
    }
    async getHistory(leadId) {
        return this.historyRepo.find({
            where: { leadId },
            order: { createdAt: 'ASC' },
        });
    }
    async toggleAi(leadId, enabled) {
        const conversation = await this.conversationsRepo.findOne({ where: { leadId } });
        if (conversation) {
            conversation.aiEnabled = enabled;
            await this.conversationsRepo.save(conversation);
        }
    }
    async getAiEnabled(leadId) {
        const conversation = await this.conversationsRepo.findOne({ where: { leadId } });
        return conversation?.aiEnabled ?? true;
    }
};
exports.LeadsService = LeadsService;
exports.LeadsService = LeadsService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(lead_entity_1.Lead)),
    __param(1, (0, typeorm_1.InjectRepository)(conversation_entity_1.Conversation)),
    __param(2, (0, typeorm_1.InjectRepository)(message_entity_1.Message)),
    __param(3, (0, typeorm_1.InjectRepository)(lead_stage_history_entity_1.LeadStageHistory)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository])
], LeadsService);
//# sourceMappingURL=leads.service.js.map