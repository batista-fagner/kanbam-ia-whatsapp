import { Injectable, Logger, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { MediaFile } from '../common/entities/media-file.entity';

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly publicUrl: string;

  constructor(
    @InjectRepository(MediaFile)
    private readonly repo: Repository<MediaFile>,
    private readonly config: ConfigService,
  ) {
    // Cloudflare R2 é compatível com S3 — mesmo cliente, só troca o endpoint.
    // Migrado do Supabase Storage porque o egress (bandwidth) estourava a cota
    // grátis do Supabase todo mês (vídeo é reenviado muitas vezes/dia via WhatsApp);
    // R2 não cobra egress.
    this.s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${config.get('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.get('R2_ACCESS_KEY_ID') ?? '',
        secretAccessKey: config.get('R2_SECRET_ACCESS_KEY') ?? '',
      },
    });
    this.bucket = config.get('R2_BUCKET') ?? 'fisio-media';
    // Domínio custom conectado ao bucket (Cloudflare R2 → bucket → Custom Domains).
    this.publicUrl = (config.get('R2_PUBLIC_URL') ?? '').replace(/\/$/, '');
  }

  async listAll(tenantId?: string): Promise<MediaFile[]> {
    const where = tenantId ? { tenantId } : {};
    return this.repo.find({ where, order: { createdAt: 'DESC' } });
  }

  async findById(id: string, tenantId?: string): Promise<MediaFile | null> {
    const where: any = { id };
    if (tenantId) where.tenantId = tenantId;
    return this.repo.findOne({ where });
  }

  async findByName(name: string, tenantId?: string): Promise<MediaFile | null> {
    // 1. Exact match (escopo do tenant quando informado)
    const exact = await this.repo.findOne({ where: tenantId ? { name, tenantId } : { name } });
    if (exact) return exact;

    // 2. Case-insensitive fallback (Gemini pode retornar caixa diferente)
    const all = await this.repo.find({ where: tenantId ? { tenantId } : {} });
    const lower = name.toLowerCase();
    const byCase = all.find(m => m.name.toLowerCase() === lower);
    if (byCase) return byCase;

    // 3. Fallback ignorando espaços (o Gemini "normaliza" nomes sozinho, ex:
    // "58 cm" → "58cm", mesmo vendo o nome exato no catálogo). Só dispara
    // quando 1 e 2 já falharam, então nunca quebra um match que hoje funciona.
    const squash = (s: string) => s.toLowerCase().replace(/\s+/g, '');
    const target = squash(name);
    return all.find(m => squash(m.name) === target) ?? null;
  }

  // Extrai códigos de reel/post de uma mensagem (instagram.com/reel/CODE ou /p/CODE)
  static extractReelCodes(text: string): string[] {
    if (!text) return [];
    const regex = /instagram\.com\/(?:reel|reels|p)\/([A-Za-z0-9_-]+)/gi;
    const codes: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      if (!codes.includes(m[1])) codes.push(m[1]);
    }
    return codes;
  }

  // Normaliza entrada do painel: aceita URL completa ou só o code, retorna sempre o code
  static normalizeReelCode(input: string): string | null {
    const trimmed = (input ?? '').trim();
    if (!trimmed) return null;
    const fromUrl = MediaService.extractReelCodes(trimmed);
    if (fromUrl.length > 0) return fromUrl[0];
    // Aceita só o code direto (alfanumérico + _-)
    if (/^[A-Za-z0-9_-]{5,}$/.test(trimmed)) return trimmed;
    return null;
  }

  async findByReelCode(code: string, tenantId?: string): Promise<MediaFile | null> {
    if (!code) return null;
    // Postgres: usa operador ANY pra buscar dentro do array
    const qb = this.repo
      .createQueryBuilder('m')
      .where(':code = ANY(m.reel_codes)', { code });
    if (tenantId) qb.andWhere('m.tenantId = :tenantId', { tenantId });
    return qb.getOne();
  }

  async updateReelCodes(id: string, codes: string[], tenantId?: string): Promise<MediaFile> {
    const record = await this.repo.findOne({ where: tenantId ? { id, tenantId } : { id } });
    if (!record) throw new NotFoundException('Mídia não encontrada');
    const normalized = (codes ?? [])
      .map(c => MediaService.normalizeReelCode(c))
      .filter((c): c is string => !!c);
    // remove duplicados
    record.reelCodes = Array.from(new Set(normalized));
    return this.repo.save(record);
  }

  async upload(file: Express.Multer.File, name: string, tenantId?: string): Promise<MediaFile> {
    const existing = await this.findByName(name, tenantId);
    if (existing) {
      throw new ConflictException(`Já existe uma mídia com o nome "${name}"`);
    }

    const ext = file.originalname.split('.').pop();
    const storagePath = `${Date.now()}-${name.replace(/\s+/g, '-')}.${ext}`;

    try {
      await this.s3.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: storagePath,
        Body: file.buffer,
        ContentType: file.mimetype,
      }));
    } catch (err: any) {
      this.logger.error(`Erro ao fazer upload para R2: ${err.message}`);
      throw new Error(`Falha no upload: ${err.message}`);
    }

    const record = this.repo.create();
    record.name = name;
    record.tenantId = tenantId as string; // controller sempre passa o tenant do token
    record.url = `${this.publicUrl}/${storagePath}`;
    record.storagePath = storagePath;
    record.mimeType = file.mimetype;
    record.size = file.size;

    return this.repo.save(record);
  }

  async rename(id: string, newName: string, tenantId?: string): Promise<MediaFile> {
    const record = await this.repo.findOne({ where: tenantId ? { id, tenantId } : { id } });
    if (!record) throw new NotFoundException('Mídia não encontrada');

    const conflict = await this.findByName(newName, tenantId);
    if (conflict && conflict.id !== id) {
      throw new ConflictException(`Já existe uma mídia com o nome "${newName}"`);
    }

    record.name = newName;
    return this.repo.save(record);
  }

  async setCaption(id: string, caption: string, tenantId?: string): Promise<MediaFile> {
    const record = await this.repo.findOne({ where: tenantId ? { id, tenantId } : { id } });
    if (!record) throw new NotFoundException('Mídia não encontrada');
    const trimmed = (caption ?? '').trim();
    record.caption = trimmed || null;
    return this.repo.save(record);
  }

  async delete(id: string, tenantId?: string): Promise<void> {
    const record = await this.repo.findOne({ where: tenantId ? { id, tenantId } : { id } });
    if (!record) throw new NotFoundException('Mídia não encontrada');

    try {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: record.storagePath }));
    } catch (err: any) {
      this.logger.warn(`Erro ao remover do Storage (continuando): ${err.message}`);
    }

    await this.repo.remove(record);
  }
}
