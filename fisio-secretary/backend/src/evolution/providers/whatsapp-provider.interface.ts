export interface IWhatsAppProvider {
  sendTextMessage(phone: string, text: string, token?: string): Promise<void>;
  sendAudioMessage(phone: string, buffer: Buffer, token?: string): Promise<void>;
  sendTypingIndicator(phone: string, durationMs?: number, token?: string): Promise<void>;
  transcribeAudio(mediaId: string, token?: string): Promise<string>;
}
