import { Conversation } from './conversation.entity';
export declare class Message {
    id: string;
    conversationId: string;
    evolutionId: string;
    direction: 'inbound' | 'outbound';
    sender: string;
    content: string;
    messageType: string;
    createdAt: Date;
    conversation: Conversation;
}
