"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const typeorm_1 = require("@nestjs/typeorm");
const lead_entity_1 = require("./common/entities/lead.entity");
const conversation_entity_1 = require("./common/entities/conversation.entity");
const message_entity_1 = require("./common/entities/message.entity");
const lead_stage_history_entity_1 = require("./common/entities/lead-stage-history.entity");
const appointment_entity_1 = require("./common/entities/appointment.entity");
const evolution_module_1 = require("./evolution/evolution.module");
const leads_module_1 = require("./leads/leads.module");
const calendar_module_1 = require("./calendar/calendar.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({ isGlobal: true }),
            typeorm_1.TypeOrmModule.forRootAsync({
                inject: [config_1.ConfigService],
                useFactory: (config) => ({
                    type: 'postgres',
                    url: config.get('SUPABASE_DATABASE_URL'),
                    ssl: { rejectUnauthorized: false },
                    entities: [lead_entity_1.Lead, conversation_entity_1.Conversation, message_entity_1.Message, lead_stage_history_entity_1.LeadStageHistory, appointment_entity_1.Appointment],
                    synchronize: true,
                    logging: false,
                }),
            }),
            evolution_module_1.EvolutionModule,
            leads_module_1.LeadsModule,
            calendar_module_1.CalendarModule,
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map