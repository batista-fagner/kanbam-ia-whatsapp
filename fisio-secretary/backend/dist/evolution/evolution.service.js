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
var EvolutionService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.EvolutionService = void 0;
const common_1 = require("@nestjs/common");
const axios_1 = require("@nestjs/axios");
const config_1 = require("@nestjs/config");
const rxjs_1 = require("rxjs");
let EvolutionService = EvolutionService_1 = class EvolutionService {
    http;
    config;
    logger = new common_1.Logger(EvolutionService_1.name);
    baseUrl = '';
    apiKey = '';
    instanceName = '';
    constructor(http, config) {
        this.http = http;
        this.config = config;
        this.baseUrl = config.get('EVOLUTION_BASE_URL') ?? '';
        this.apiKey = config.get('AUTHENTICATION_API_KEY') ?? '';
        this.instanceName = config.get('EVOLUTION_INSTANCE_NAME') ?? '';
    }
    async sendTextMessage(phone, text) {
        try {
            await (0, rxjs_1.firstValueFrom)(this.http.post(`${this.baseUrl}/message/sendText/${this.instanceName}`, { number: phone, text }, { headers: { apikey: this.apiKey } }));
        }
        catch (err) {
            this.logger.error(`Erro ao enviar mensagem para ${phone}: ${err.message}`);
        }
    }
};
exports.EvolutionService = EvolutionService;
exports.EvolutionService = EvolutionService = EvolutionService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [axios_1.HttpService,
        config_1.ConfigService])
], EvolutionService);
//# sourceMappingURL=evolution.service.js.map