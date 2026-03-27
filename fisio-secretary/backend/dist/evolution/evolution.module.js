"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EvolutionModule = void 0;
const common_1 = require("@nestjs/common");
const axios_1 = require("@nestjs/axios");
const evolution_controller_1 = require("./evolution.controller");
const evolution_service_1 = require("./evolution.service");
const leads_module_1 = require("../leads/leads.module");
const ai_module_1 = require("../ai/ai.module");
const calendar_module_1 = require("../calendar/calendar.module");
let EvolutionModule = class EvolutionModule {
};
exports.EvolutionModule = EvolutionModule;
exports.EvolutionModule = EvolutionModule = __decorate([
    (0, common_1.Module)({
        imports: [axios_1.HttpModule, leads_module_1.LeadsModule, ai_module_1.AiModule, calendar_module_1.CalendarModule],
        controllers: [evolution_controller_1.EvolutionController],
        providers: [evolution_service_1.EvolutionService],
        exports: [evolution_service_1.EvolutionService],
    })
], EvolutionModule);
//# sourceMappingURL=evolution.module.js.map