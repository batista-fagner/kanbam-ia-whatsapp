import { Lead } from './lead.entity';
import { Message } from './message.entity';
export declare class Conversation {
    id: string;
    leadId: string;
    aiEnabled: boolean;
    createdAt: Date;
    lead: Lead;
    messages: Message[];
}
