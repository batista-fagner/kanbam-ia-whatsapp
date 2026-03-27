import { LeadsService } from './leads.service';
import { LeadsGateway } from './leads.gateway';
export declare class LeadsController {
    private readonly leadsService;
    private readonly leadsGateway;
    constructor(leadsService: LeadsService, leadsGateway: LeadsGateway);
    findAll(): Promise<import("../common/entities/lead.entity").Lead[]>;
    findOne(id: string): Promise<import("../common/entities/lead.entity").Lead | null>;
    getConversation(id: string): Promise<import("../common/entities/conversation.entity").Conversation | null>;
    getHistory(id: string): Promise<import("../common/entities/lead-stage-history.entity").LeadStageHistory[]>;
    updateStage(id: string, body: {
        stage: string;
    }): Promise<import("../common/entities/lead.entity").Lead>;
    toggleAi(id: string, body: {
        enabled: boolean;
    }): Promise<{
        ok: boolean;
    }>;
}
