import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
export declare class EvolutionService {
    private http;
    private config;
    private readonly logger;
    private readonly baseUrl;
    private readonly apiKey;
    private readonly instanceName;
    constructor(http: HttpService, config: ConfigService);
    sendTypingIndicator(phone: string, durationMs?: number): Promise<void>;
    sendTextMessage(phone: string, text: string): Promise<void>;
}
