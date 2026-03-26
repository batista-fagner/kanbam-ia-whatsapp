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
Object.defineProperty(exports, "__esModule", { value: true });
exports.LeadStageHistory = void 0;
const typeorm_1 = require("typeorm");
const lead_entity_1 = require("./lead.entity");
let LeadStageHistory = class LeadStageHistory {
    id;
    leadId;
    fromStage;
    toStage;
    changedBy;
    createdAt;
    lead;
};
exports.LeadStageHistory = LeadStageHistory;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], LeadStageHistory.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'lead_id' }),
    __metadata("design:type", String)
], LeadStageHistory.prototype, "leadId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'from_stage', nullable: true, type: 'varchar' }),
    __metadata("design:type", Object)
], LeadStageHistory.prototype, "fromStage", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'to_stage' }),
    __metadata("design:type", String)
], LeadStageHistory.prototype, "toStage", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'changed_by' }),
    __metadata("design:type", String)
], LeadStageHistory.prototype, "changedBy", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: 'created_at' }),
    __metadata("design:type", Date)
], LeadStageHistory.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => lead_entity_1.Lead, (l) => l.stageHistory),
    (0, typeorm_1.JoinColumn)({ name: 'lead_id' }),
    __metadata("design:type", lead_entity_1.Lead)
], LeadStageHistory.prototype, "lead", void 0);
exports.LeadStageHistory = LeadStageHistory = __decorate([
    (0, typeorm_1.Entity)('lead_stage_history')
], LeadStageHistory);
//# sourceMappingURL=lead-stage-history.entity.js.map