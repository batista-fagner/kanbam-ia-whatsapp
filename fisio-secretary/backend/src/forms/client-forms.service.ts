import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes, randomUUID } from 'crypto';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { ClientForm, ClientFormFile } from '../common/entities/client-form.entity';
import { OnboardingForm } from '../common/entities/onboarding-form.entity';
import { WhatsappConfig } from '../common/entities/whatsapp-config.entity';
import { FORM_DEFINITIONS, FormDefinition } from './form-definitions';

const MAX_ANSWER_CHARS = 5000;
const MAX_FILES_PER_FORM = 60;
const ALLOWED_MIME = /^(image\/|video\/|application\/pdf$)/;
export const MAX_FORM_FILE_MB = 40;

@Injectable()
export class ClientFormsService {
  private readonly logger = new Logger(ClientFormsService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly publicUrl: string;

  constructor(
    @InjectRepository(ClientForm) private readonly repo: Repository<ClientForm>,
    @InjectRepository(OnboardingForm) private readonly onboardingRepo: Repository<OnboardingForm>,
    @InjectRepository(WhatsappConfig) private readonly configRepo: Repository<WhatsappConfig>,
    private readonly config: ConfigService,
  ) {
    this.s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${config.get('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.get('R2_ACCESS_KEY_ID') ?? '',
        secretAccessKey: config.get('R2_SECRET_ACCESS_KEY') ?? '',
      },
    });
    this.bucket = config.get('R2_BUCKET') ?? 'fisio-media';
    this.publicUrl = (config.get('R2_PUBLIC_URL') ?? '').replace(/\/$/, '');
  }

  definition(formKey: string): FormDefinition {
    const def = FORM_DEFINITIONS[formKey];
    if (!def) throw new BadRequestException(`Formulário "${formKey}" não existe`);
    return def;
  }

  listDefinitions() {
    return Object.values(FORM_DEFINITIONS).map((d) => ({ key: d.key, title: d.title }));
  }

  linkFor(token: string): string {
    const frontendUrl = (this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:5173').replace(/\/$/, '');
    return `${frontendUrl}/f/${token}`;
  }

  // ───────── Admin ─────────

  // Um link por cliente+formulário: chamar de novo devolve o mesmo (não perde o que já foi respondido).
  async createOrGet(tenantId: string, formKey: string) {
    this.definition(formKey);
    const tenant = await this.configRepo.findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Cliente não encontrado');
    let form = await this.repo.findOne({ where: { tenantId, formKey } });
    if (!form) {
      form = await this.repo.save(
        this.repo.create({ tenantId, formKey, token: randomBytes(24).toString('hex'), answers: {}, files: [] }),
      );
    }
    return this.adminView(form, tenant.displayName ?? null);
  }

  async listForAdmin() {
    const forms = await this.repo.find({ order: { createdAt: 'DESC' } });
    const tenants = await this.configRepo.findByIds([...new Set(forms.map((f) => f.tenantId))]);
    const names = new Map(tenants.map((t) => [t.id, t.displayName ?? null]));
    return forms.map((f) => this.adminView(f, names.get(f.tenantId) ?? null));
  }

  private adminView(f: ClientForm, tenantName: string | null) {
    const def = FORM_DEFINITIONS[f.formKey];
    const answered = def ? def.questions.filter((q) => (f.answers?.[q.id] ?? '').trim() || f.files.some((x) => x.questionId === q.id)).length : 0;
    return {
      id: f.id,
      tenantId: f.tenantId,
      tenantName,
      formKey: f.formKey,
      link: this.linkFor(f.token),
      answered,
      total: def?.questions.length ?? 0,
      fileCount: f.files.length,
      submittedAt: f.submittedAt,
      updatedAt: f.updatedAt,
    };
  }

  // ───────── Público (por token) ─────────

  private async byToken(token: string): Promise<ClientForm> {
    if (!/^[0-9a-f]{48}$/.test(token ?? '')) throw new NotFoundException('Link inválido');
    const form = await this.repo.findOne({ where: { token } });
    if (!form) throw new NotFoundException('Link inválido');
    return form;
  }

  async publicView(token: string) {
    const form = await this.byToken(token);
    const def = this.definition(form.formKey);
    const tenant = await this.configRepo.findOne({ where: { id: form.tenantId } });
    return {
      title: def.title,
      intro: def.intro,
      businessName: tenant?.displayName ?? null,
      questions: def.questions,
      answers: form.answers ?? {},
      files: form.files ?? [],
      submittedAt: form.submittedAt,
    };
  }

  async saveAnswers(token: string, answers: Record<string, unknown>) {
    const form = await this.byToken(token);
    const def = this.definition(form.formKey);
    const valid = new Set(def.questions.filter((q) => q.type !== 'file').map((q) => q.id));
    const next = { ...(form.answers ?? {}) };
    for (const [k, v] of Object.entries(answers ?? {})) {
      if (!valid.has(k) || typeof v !== 'string') continue;
      next[k] = v.slice(0, MAX_ANSWER_CHARS);
    }
    form.answers = next;
    await this.repo.save(form);
    return { ok: true, savedAt: new Date().toISOString() };
  }

  async addFile(token: string, questionId: string, file: Express.Multer.File): Promise<ClientFormFile> {
    const form = await this.byToken(token);
    const def = this.definition(form.formKey);
    const q = def.questions.find((x) => x.id === questionId);
    if (!q || !(q.type === 'file' || q.allowFiles)) throw new BadRequestException('Pergunta não aceita anexo');
    if (!file) throw new BadRequestException('Arquivo não enviado');
    if (!ALLOWED_MIME.test(file.mimetype)) throw new BadRequestException('Envie foto, vídeo ou PDF');
    if ((form.files?.length ?? 0) >= MAX_FILES_PER_FORM) throw new BadRequestException('Limite de arquivos atingido');

    const safeName = (file.originalname || 'arquivo').replace(/[^\w.\- ]+/g, '_').slice(-80);
    const id = randomUUID();
    const key = `forms/${form.tenantId}/${id}-${safeName}`;
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: file.buffer, ContentType: file.mimetype }));
    const entry: ClientFormFile = {
      id, questionId, name: safeName, key, size: file.size, mimetype: file.mimetype,
      url: this.publicUrl ? `${this.publicUrl}/${key}` : key,
    };
    form.files = [...(form.files ?? []), entry];
    await this.repo.save(form);
    return entry;
  }

  async removeFile(token: string, fileId: string) {
    const form = await this.byToken(token);
    const f = (form.files ?? []).find((x) => x.id === fileId);
    if (!f) throw new NotFoundException('Arquivo não encontrado');
    form.files = form.files.filter((x) => x.id !== fileId);
    await this.repo.save(form);
    try {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: f.key }));
    } catch (err) {
      this.logger.warn(`[FORMS] Não consegui apagar ${f.key} do R2: ${err.message}`);
    }
    return { ok: true };
  }

  // Envio final: espelha em onboarding_forms (chave = texto da pergunta, igual ao Google Form),
  // pra tela de Onboarding mostrar as respostas e gerar rascunho de prompt. Reenvio atualiza a mesma linha.
  async submit(token: string, answers?: Record<string, unknown>) {
    if (answers) await this.saveAnswers(token, answers);
    const form = await this.byToken(token);
    const def = this.definition(form.formKey);

    const flat: Record<string, string> = {};
    for (const q of def.questions) {
      const text = (form.answers?.[q.id] ?? '').trim();
      const urls = (form.files ?? []).filter((f) => f.questionId === q.id).map((f) => `${f.name}: ${f.url}`);
      const parts = [text, urls.length ? `Anexos:\n${urls.join('\n')}` : ''].filter(Boolean);
      flat[q.label] = parts.join('\n\n');
    }

    if (form.onboardingFormId) {
      await this.onboardingRepo.update(form.onboardingFormId, { answers: flat });
    } else {
      const saved = await this.onboardingRepo.save(
        this.onboardingRepo.create({ tenantId: form.tenantId, email: null, answers: flat }),
      );
      form.onboardingFormId = saved.id;
    }
    form.submittedAt = new Date();
    await this.repo.save(form);
    await this.configRepo.update(form.tenantId, { promptFormSubmittedAt: new Date() });
    this.logger.log(`[FORMS] Formulário "${form.formKey}" enviado → tenant ${form.tenantId}`);
    return { ok: true };
  }
}
