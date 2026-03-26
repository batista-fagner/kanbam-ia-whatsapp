import { Lead } from './lead.entity';
export declare class LeadStageHistory {
    id: string;
    leadId: string;
    fromStage: string | null;
    toStage: string;
    changedBy: string;
    createdAt: Date;
    lead: Lead;
}
