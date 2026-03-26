import { EvolutionService } from './evolution.service';
import { LeadsService } from '../leads/leads.service';
import { AiService } from '../ai/ai.service';
export declare class EvolutionController {
    private readonly evolutionService;
    private readonly leadsService;
    private readonly aiService;
    private readonly logger;
    constructor(evolutionService: EvolutionService, leadsService: LeadsService, aiService: AiService);
    handleWebhook(body: any): Promise<{
        ok: boolean;
    }>;
}
