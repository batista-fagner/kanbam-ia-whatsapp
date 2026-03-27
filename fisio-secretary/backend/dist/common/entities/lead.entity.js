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
exports.Lead = void 0;
const typeorm_1 = require("typeorm");
const conversation_entity_1 = require("./conversation.entity");
const lead_stage_history_entity_1 = require("./lead-stage-history.entity");
const appointment_entity_1 = require("./appointment.entity");
let Lead = class Lead {
    id;
    phone;
    name;
    stage;
    temperature;
    qualificationScore;
    symptoms;
    urgency;
    availability;
    budget;
    qualificationStep;
    aiContext;
    nurtureStep;
    nurturePaused;
    nextNurtureAt;
    appointmentAt;
    calendarEventId;
    lastMessageAt;
    createdAt;
    updatedAt;
    conversation;
    stageHistory;
    appointments;
};
exports.Lead = Lead;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], Lead.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ unique: true }),
    __metadata("design:type", String)
], Lead.prototype, "phone", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true }),
    __metadata("design:type", String)
], Lead.prototype, "name", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: 'novo_lead' }),
    __metadata("design:type", String)
], Lead.prototype, "stage", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true }),
    __metadata("design:type", String)
], Lead.prototype, "temperature", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'qualification_score', default: 0 }),
    __metadata("design:type", Number)
], Lead.prototype, "qualificationScore", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'text' }),
    __metadata("design:type", String)
], Lead.prototype, "symptoms", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true }),
    __metadata("design:type", String)
], Lead.prototype, "urgency", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true }),
    __metadata("design:type", String)
], Lead.prototype, "availability", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true }),
    __metadata("design:type", String)
], Lead.prototype, "budget", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'qualification_step', default: 0 }),
    __metadata("design:type", Number)
], Lead.prototype, "qualificationStep", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'ai_context', type: 'jsonb', default: [] }),
    __metadata("design:type", Array)
], Lead.prototype, "aiContext", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'nurture_step', default: 0 }),
    __metadata("design:type", Number)
], Lead.prototype, "nurtureStep", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'nurture_paused', default: false }),
    __metadata("design:type", Boolean)
], Lead.prototype, "nurturePaused", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'next_nurture_at', nullable: true, type: 'timestamp' }),
    __metadata("design:type", Date)
], Lead.prototype, "nextNurtureAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'appointment_at', nullable: true, type: 'timestamp' }),
    __metadata("design:type", Object)
], Lead.prototype, "appointmentAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'calendar_event_id', nullable: true, type: 'text' }),
    __metadata("design:type", Object)
], Lead.prototype, "calendarEventId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'last_message_at', nullable: true, type: 'timestamp' }),
    __metadata("design:type", Date)
], Lead.prototype, "lastMessageAt", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: 'created_at' }),
    __metadata("design:type", Date)
], Lead.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)({ name: 'updated_at' }),
    __metadata("design:type", Date)
], Lead.prototype, "updatedAt", void 0);
__decorate([
    (0, typeorm_1.OneToOne)(() => conversation_entity_1.Conversation, (c) => c.lead),
    __metadata("design:type", conversation_entity_1.Conversation)
], Lead.prototype, "conversation", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => lead_stage_history_entity_1.LeadStageHistory, (h) => h.lead),
    __metadata("design:type", Array)
], Lead.prototype, "stageHistory", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => appointment_entity_1.Appointment, (a) => a.lead),
    __metadata("design:type", Array)
], Lead.prototype, "appointments", void 0);
exports.Lead = Lead = __decorate([
    (0, typeorm_1.Entity)('leads')
], Lead);
//# sourceMappingURL=lead.entity.js.map