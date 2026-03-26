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
exports.Appointment = void 0;
const typeorm_1 = require("typeorm");
const lead_entity_1 = require("./lead.entity");
let Appointment = class Appointment {
    id;
    leadId;
    scheduledAt;
    durationMin;
    serviceType;
    status;
    notes;
    createdAt;
    lead;
};
exports.Appointment = Appointment;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], Appointment.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'lead_id' }),
    __metadata("design:type", String)
], Appointment.prototype, "leadId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'scheduled_at', type: 'timestamp' }),
    __metadata("design:type", Date)
], Appointment.prototype, "scheduledAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'duration_min', default: 60 }),
    __metadata("design:type", Number)
], Appointment.prototype, "durationMin", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'service_type', nullable: true }),
    __metadata("design:type", String)
], Appointment.prototype, "serviceType", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: 'scheduled' }),
    __metadata("design:type", String)
], Appointment.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'text' }),
    __metadata("design:type", String)
], Appointment.prototype, "notes", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: 'created_at' }),
    __metadata("design:type", Date)
], Appointment.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => lead_entity_1.Lead, (l) => l.appointments),
    (0, typeorm_1.JoinColumn)({ name: 'lead_id' }),
    __metadata("design:type", lead_entity_1.Lead)
], Appointment.prototype, "lead", void 0);
exports.Appointment = Appointment = __decorate([
    (0, typeorm_1.Entity)('appointments')
], Appointment);
//# sourceMappingURL=appointment.entity.js.map