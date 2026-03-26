import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { Lead } from '../common/entities/lead.entity';
export interface AiResponse {
    reply: string;
    stage?: string;
    temperature?: string;
    fields?: {
        name?: string;
        symptoms?: string;
        urgency?: string;
        availability?: string;
        budget?: string;
        qualificationScore?: number;
        qualificationStep?: number;
    };
}
export declare class AiService {
    private config;
    private readonly logger;
    private readonly client;
    constructor(config: ConfigService);
    processMessage(lead: Lead, incomingText: string): Promise<AiResponse>;
    buildUpdatedContext(lead: Lead, incomingText: string, reply: string): Anthropic.MessageParam[];
}
