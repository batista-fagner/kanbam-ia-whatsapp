import { EvolutionService } from './evolution.service';
import { MessageQueueService } from './message-queue.service';
import { LeadsService } from '../leads/leads.service';
import { AiService } from '../ai/ai.service';
import { LeadsGateway } from '../leads/leads.gateway';
import { CalendarService } from '../calendar/calendar.service';
export declare class EvolutionController {
    private readonly evolutionService;
    private readonly messageQueue;
    private readonly leadsService;
    private readonly aiService;
    private readonly leadsGateway;
    private readonly calendarService;
    private readonly logger;
    private readonly processedIds;
    constructor(evolutionService: EvolutionService, messageQueue: MessageQueueService, leadsService: LeadsService, aiService: AiService, leadsGateway: LeadsGateway, calendarService: CalendarService);
    handleWebhook(body: any): Promise<{
        ok: boolean;
    }>;
    private processMessage;
    sendManual(body: {
        phone: string;
        text: string;
    }): Promise<{
        ok: boolean;
    }>;
}
