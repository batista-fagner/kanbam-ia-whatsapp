import { Lead } from './lead.entity';
export declare class Appointment {
    id: string;
    leadId: string;
    scheduledAt: Date;
    durationMin: number;
    serviceType: string;
    status: string;
    notes: string;
    createdAt: Date;
    lead: Lead;
}
