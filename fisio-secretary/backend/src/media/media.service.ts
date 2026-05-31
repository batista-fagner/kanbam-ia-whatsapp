import { Injectable, Logger, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { MediaFile } from '../common/entities/media-file.entity';

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private readonly supabase: SupabaseClient;
  private readonly bucket: string;

  constructor(
    @InjectRepository(MediaFile)
    private readonly repo: Repository<MediaFile>,
    private readonly config: ConfigService,
  ) {
    this.supabase = createClient(
      config.get('SUPABASE_URL') ?? '',
      config.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    this.bucket = config.get('SUPABASE_STORAGE_BUCKET') ?? 'fisio-media';
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
    return all.find(m => m.name.toLowerCase() === lower) ?? null;
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

    const { error } = await this.supabase.storage
      .from(this.bucket)
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (error) {
      this.logger.error(`Erro ao fazer upload para Supabase Storage: ${error.message}`);
      throw new Error(`Falha no upload: ${error.message}`);
    }

    const { data: publicUrlData } = this.supabase.storage
      .from(this.bucket)
      .getPublicUrl(storagePath);

    const record = this.repo.create();
    record.name = name;
    record.tenantId = tenantId as string; // controller sempre passa o tenant do token
    record.url = publicUrlData.publicUrl;
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

  async delete(id: string, tenantId?: string): Promise<void> {
    const record = await this.repo.findOne({ where: tenantId ? { id, tenantId } : { id } });
    if (!record) throw new NotFoundException('Mídia não encontrada');

    const { error } = await this.supabase.storage
      .from(this.bucket)
      .remove([record.storagePath]);

    if (error) {
      this.logger.warn(`Erro ao remover do Storage (continuando): ${error.message}`);
    }

    await this.repo.remove(record);
  }
}
