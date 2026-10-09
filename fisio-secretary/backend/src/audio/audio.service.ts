import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI, { toFile } from 'openai';
import { TextToSpeechClient, protos } from '@google-cloud/text-to-speech';
const { AudioEncoding } = protos.google.cloud.texttospeech.v1;

@Injectable()
export class AudioService {
  private readonly logger = new Logger(AudioService.name);
  private readonly openai: OpenAI;
  private readonly ttsClient: TextToSpeechClient;

  constructor(private config: ConfigService) {
    this.openai = new OpenAI({ apiKey: config.get('OPENAI_API_KEY') ?? '' });

    // Google Cloud TTS — usa credenciais do service account
    const privateKey = config.get('GOOGLE_PRIVATE_KEY') ?? '';
    const serviceAccountEmail = config.get('GOOGLE_SERVICE_ACCOUNT_EMAIL') ?? '';

    this.ttsClient = new TextToSpeechClient({
      credentials: {
        private_key: privateKey,
        client_email: serviceAccountEmail,
      },
    });
  }

  async transcribe(base64Audio: string): Promise<string> {
    const buffer = Buffer.from(base64Audio, 'base64');
    const file = await toFile(buffer, 'audio.ogg', { type: 'audio/ogg; codecs=opus' });
    const transcription = await this.openai.audio.transcriptions.create({
      file,
      model: 'whisper-1',
      language: 'pt',
    });
    return transcription.text;
  }

  // Reserva da transcrição: a principal é o Whisper da OpenAI rodado pela uazapi
  // (transcribeAudio). Quando ela volta vazia — ex: conta OpenAI sem crédito, que em
  // out/2026 deixou ~300 áudios em branco e a IA respondendo no escuro — o áudio vai
  // pro Gemini, que já é a IA principal e tem chave própria. Custo ~200 tokens/áudio.
  async transcribeWithGemini(buffer: Buffer, mimeType = 'audio/ogg'): Promise<string> {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    if (!apiKey) return '';
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: mimeType.split(';')[0].trim() || 'audio/ogg', data: buffer.toString('base64') } },
            { text: 'Transcreva exatamente o que é falado neste áudio, em português do Brasil. Responda só com a transcrição, sem comentários. Se não houver fala, responda vazio.' },
          ],
        }],
        generationConfig: { temperature: 0, thinkingConfig: { thinkingBudget: 0 } },
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json: any = await res.json();
    return (json?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? '').join('').trim();
  }

  private readonly MESES = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
  ];

  private prepareTextForTts(text: string): string {
    // 1. Remove emojis
    let t = text.replace(
      /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{27BF}]|[\u{1F000}-\u{1F02F}]|[\u{1F0A0}-\u{1F0FF}]/gu,
      '',
    );

    // 2. Datas dd/mm/aaaa → "4 de abril de 2026"
    t = t.replace(/(\d{1,2})\/(\d{1,2})\/(\d{4})/g, (_, d, m, a) => {
      const mes = this.MESES[parseInt(m, 10) - 1] ?? m;
      return `${parseInt(d, 10)} de ${mes} de ${a}`;
    });

    // 3. Datas dd/mm → "4 de abril"
    t = t.replace(/(\d{1,2})\/(\d{2})/g, (_, d, m) => {
      const mes = this.MESES[parseInt(m, 10) - 1] ?? m;
      return `${parseInt(d, 10)} de ${mes}`;
    });

    // 4. Horas HHhMM → "14 horas e 30 minutos"
    t = t.replace(/(\d{1,2})h(\d{2})/g, (_, h, min) => {
      const minVal = parseInt(min, 10);
      return minVal > 0 ? `${parseInt(h, 10)} horas e ${minVal} minutos` : `${parseInt(h, 10)} horas`;
    });

    // 5. Horas HH:MM → "14 horas e 30 minutos"
    t = t.replace(/(\d{1,2}):(\d{2})/g, (_, h, min) => {
      const minVal = parseInt(min, 10);
      return minVal > 0 ? `${parseInt(h, 10)} horas e ${minVal} minutos` : `${parseInt(h, 10)} horas`;
    });

    // 6. Horas Hh (sem minutos) → "14 horas"
    t = t.replace(/(\d{1,2})h\b/g, (_, h) => `${parseInt(h, 10)} horas`);

    // 7. Valores R$ → "500 reais"
    t = t.replace(/R\$\s*([\d.]+),(\d{2})/g, (_, int, dec) => {
      const intVal = int.replace('.', '');
      return parseInt(dec, 10) > 0
        ? `${intVal} reais e ${parseInt(dec, 10)} centavos`
        : `${intVal} reais`;
    });
    t = t.replace(/R\$\s*([\d.]+)/g, (_, val) => `${val.replace('.', '')} reais`);

    // 8. Remove caracteres especiais restantes (mantém letras, números, acentos, pontuação básica)
    t = t.replace(/[^a-z0-9áàâãéèêíïóôõöúçñ\s.,!?;:\-()]/gi, '');

    // 9. Normaliza espaços e quebras de linha
    t = t.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();

    return t;
  }

  private buildSsml(text: string): string {
    // Escapa caracteres especiais XML
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    return `<speak><prosody rate="medium" pitch="0st">${escaped}</prosody></speak>`;
  }

  async textToSpeech(text: string): Promise<Buffer> {
    const prepared = this.prepareTextForTts(text);

    if (!prepared) {
      throw new Error('Texto vazio após limpeza para TTS');
    }

    const ssml = this.buildSsml(prepared);

    this.logger.debug(`TTS original: "${text}"`);
    this.logger.debug(`TTS SSML: "${ssml}"`);

    const request = {
      input: { ssml },
      voice: {
        languageCode: 'pt-BR',
        name: 'pt-BR-Neural2-C', // C=Marina (feminina)
      },
      audioConfig: { audioEncoding: AudioEncoding.MP3 },
    };

    const response = await this.ttsClient.synthesizeSpeech(request);
    const audioContent = response[0]?.audioContent;

    if (!audioContent) {
      throw new Error('Google Cloud TTS não retornou áudio');
    }

    return Buffer.from(audioContent as Uint8Array);
  }
}
