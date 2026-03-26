import { LeadsService } from './leads.service';
export declare class LeadsController {
    private readonly leadsService;
    constructor(leadsService: LeadsService);
    findAll(): Promise<import("../common/entities/lead.entity").Lead[]>;
    findOne(id: string): Promise<import("../common/entities/lead.entity").Lead | null>;
    getConversation(id: string): Promise<import("../common/entities/conversation.entity").Conversation | null>;
    updateStage(id: string, body: {
        stage: string;
    }): Promise<import("../common/entities/lead.entity").Lead>;
}
