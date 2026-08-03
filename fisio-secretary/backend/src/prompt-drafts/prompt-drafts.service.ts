import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { GeneratedPrompt } from '../common/entities/generated-prompt.entity';
import { OnboardingForm } from '../common/entities/onboarding-form.entity';
import { WhatsappConfig } from '../common/entities/whatsapp-config.entity';
import { AiService } from '../ai/ai.service';

@Injectable()
export class PromptDraftsService {
  private readonly logger = new Logger(PromptDraftsService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly aiService: AiService,
    @InjectRepository(GeneratedPrompt) private readonly draftRepo: Repository<GeneratedPrompt>,
    @InjectRepository(OnboardingForm) private readonly formRepo: Repository<OnboardingForm>,
    @InjectRepository(WhatsappConfig) private readonly configRepo: Repository<WhatsappConfig>,
  ) {}

  // Lista os formulários recebidos (mais recente primeiro), com o nome do cliente e o
  // status do rascunho mais recente daquele tenant (se já foi gerado algum). É a tela
  // principal da revisão — mostra o que chegou e o que já tem/não tem rascunho.
  async listOnboardingForms(): Promise<Array<OnboardingForm & { tenantName: string | null; latestDraftId: string | null; latestDraftStatus: string | null }>> {
    const forms = await this.formRepo.find({ order: { createdAt: 'DESC' } });
    if (forms.length === 0) return [];

    const tenantIds = [...new Set(forms.map((f) => f.tenantId).filter((id): id is string => !!id))];
    const tenants = tenantIds.length
      ? await this.configRepo.find({ where: tenantIds.map((id) => ({ id })) as any })
      : [];
    const tenantNameById = new Map(tenants.map((t) => [t.id, t.displayName ?? t.profileName ?? t.id]));

    const drafts = tenantIds.length
      ? await this.draftRepo.find({ where: tenantIds.map((id) => ({ tenantId: id })) as any, order: { createdAt: 'DESC' } })
      : [];
    const latestDraftByTenant = new Map<string, GeneratedPrompt>();
    for (const d of drafts) {
      if (!latestDraftByTenant.has(d.tenantId)) latestDraftByTenant.set(d.tenantId, d);
    }

    return forms.map((f) => ({
      ...f,
      tenantName: f.tenantId ? tenantNameById.get(f.tenantId) ?? null : null,
      latestDraftId: f.tenantId ? latestDraftByTenant.get(f.tenantId)?.id ?? null : null,
      latestDraftStatus: f.tenantId ? latestDraftByTenant.get(f.tenantId)?.status ?? null : null,
    }));
  }

  async listDrafts(status?: string): Promise<Array<GeneratedPrompt & { tenantName: string | null }>> {
    const drafts = await this.draftRepo.find({
      where: status ? { status: status as any } : {},
      order: { createdAt: 'DESC' },
    });
    if (drafts.length === 0) return [];

    const tenantIds = [...new Set(drafts.map((d) => d.tenantId))];
    const tenants = await this.configRepo.find({ where: tenantIds.map((id) => ({ id })) as any });
    const tenantNameById = new Map(tenants.map((t) => [t.id, t.displayName ?? t.profileName ?? t.id]));

    return drafts.map((d) => ({ ...d, tenantName: tenantNameById.get(d.tenantId) ?? null }));
  }

  // Retorna o rascunho + o que a UI de revisão precisa junto: respostas do form que
  // originou este rascunho e o nome do cliente (evita round-trips extras do frontend).
  async getDraft(id: string): Promise<GeneratedPrompt & { tenantName: string | null; formAnswers: Record<string, string> | null }> {
    const draft = await this.draftRepo.findOne({ where: { id } });
    if (!draft) throw new NotFoundException('Rascunho não encontrado');

    const [tenant, form] = await Promise.all([
      this.configRepo.findOne({ where: { id: draft.tenantId } }),
      draft.sourceFormId ? this.formRepo.findOne({ where: { id: draft.sourceFormId } }) : Promise.resolve(null),
    ]);

    return {
      ...draft,
      tenantName: tenant?.displayName ?? tenant?.profileName ?? null,
      formAnswers: form?.answers ?? null,
    };
  }

  // Gera o rascunho a partir da última resposta de form do tenant + o prompt de um
  // cliente-referência (mesmo agentType). Não bloqueia se já houver rascunho anterior —
  // cada chamada cria um novo (histórico fica registrado, nada é sobrescrito).
  async generateDraft(tenantId: string, referenceTenantId?: string): Promise<GeneratedPrompt> {
    const tenant = await this.configRepo.findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Cliente não encontrado');

    const form = await this.formRepo.findOne({
      where: { tenantId },
      order: { createdAt: 'DESC' },
    });
    if (!form) throw new BadRequestException('Este cliente ainda não enviou o formulário de onboarding');

    const reference = referenceTenantId
      ? await this.configRepo.findOne({ where: { id: referenceTenantId } })
      : await this.findDefaultReference(tenant.agentType);
    if (!reference) throw new BadRequestException('Nenhum cliente-referência encontrado — informe referenceTenantId ou cadastre DEFAULT_REFERENCE_TENANT_ID');

    const referencePrompt = tenant.agentType === 'megahair' ? reference.customPromptMegaHair : reference.customPromptSofia;
    if (!referencePrompt) throw new BadRequestException(`Cliente-referência (${reference.displayName ?? reference.id}) não tem prompt customizado cadastrado`);

    const content = await this.aiService.generatePromptDraft(referencePrompt, form.answers ?? {});

    const draft = await this.draftRepo.save(
      this.draftRepo.create({
        tenantId,
        referenceTenantId: reference.id,
        sourceFormId: form.id,
        content,
        status: 'draft',
      }),
    );

    this.logger.log(`[PROMPT-DRAFT] Rascunho ${draft.id} criado pro tenant ${tenantId} (referência: ${reference.displayName ?? reference.id})`);
    await this.notifyDraftReady(tenant.displayName ?? tenantId, draft.id);
    return draft;
  }

  // Salva edições feitas na revisão sem aprovar ainda (a pessoa pode ir ajustando aos poucos).
  async updateDraftContent(id: string, content: string): Promise<GeneratedPrompt> {
    const draft = await this.draftRepo.findOne({ where: { id } });
    if (!draft) throw new NotFoundException('Rascunho não encontrado');
    if (draft.status !== 'draft') throw new BadRequestException('Só é possível editar rascunhos pendentes');
    draft.content = content;
    return this.draftRepo.save(draft);
  }

  // Aprova o rascunho: copia o conteúdo pro custom_prompt_{sofia|megahair} do tenant — só
  // aqui o prompt vira "de verdade" ativo. Nunca acontece sozinho, sempre exige esse clique.
  // Se vier "content", salva a edição final antes de aprovar (revisão feita na hora).
  async approveDraft(id: string, content?: string): Promise<GeneratedPrompt> {
    const draft = await this.draftRepo.findOne({ where: { id } });
    if (!draft) throw new NotFoundException('Rascunho não encontrado');
    const tenant = await this.configRepo.findOne({ where: { id: draft.tenantId } });
    if (!tenant) throw new NotFoundException('Cliente do rascunho não existe mais');

    const finalContent = content ?? draft.content;
    const field = tenant.agentType === 'megahair' ? 'customPromptMegaHair' : 'customPromptSofia';
    await this.configRepo.update(tenant.id, { [field]: finalContent } as any);

    draft.content = finalContent;
    draft.status = 'approved';
    await this.draftRepo.save(draft);
    this.logger.log(`[PROMPT-DRAFT] Rascunho ${id} aprovado e ativado pro tenant ${tenant.id} (${field})`);
    return draft;
  }

  async discardDraft(id: string): Promise<GeneratedPrompt> {
    const draft = await this.getDraft(id);
    draft.status = 'discarded';
    await this.draftRepo.save(draft);
    return draft;
  }

  // Sem indicação explícita de referência: usa o tenant fixado em DEFAULT_REFERENCE_TENANT_ID
  // (hoje: Julia da Cabelô/bbfagner2222@gmail.com, prompt megahair validado em produção) se ele
  // servir pro agentType pedido; senão cai no cliente mais recente ativo do mesmo tipo.
  private async findDefaultReference(agentType: string): Promise<WhatsappConfig | null> {
    const column = agentType === 'megahair' ? 'custom_prompt_megahair' : 'custom_prompt_sofia';

    const fixedId = this.config.get<string>('DEFAULT_REFERENCE_TENANT_ID');
    if (fixedId) {
      const fixed = await this.configRepo
        .createQueryBuilder('wc')
        .where('wc.id = :id', { id: fixedId })
        .andWhere(`wc.${column} IS NOT NULL`)
        .getOne();
      if (fixed) return fixed;
    }

    return this.configRepo
      .createQueryBuilder('wc')
      .where('wc.agent_type = :agentType', { agentType })
      .andWhere(`wc.${column} IS NOT NULL`)
      .andWhere('wc.is_active = true')
      .orderBy('wc.created_at', 'DESC')
      .getOne();
  }

  private async notifyDraftReady(clientName: string, draftId: string): Promise<void> {
    const adminPhone = this.config.get<string>('ADMIN_ALERT_PHONE');
    const adminToken = this.config.get<string>('UAZAPI_TOKEN');
    const baseUrl = this.config.get<string>('UAZAPI_BASE_URL') ?? '';
    if (!adminPhone || !adminToken) return;

    try {
      const text = `📝 *Rascunho de prompt gerado!*\n\nCliente: *${clientName}*\nID do rascunho: ${draftId}\n\nPronto pra revisar.`;
      await axios.post(`${baseUrl}/send/text`, { number: adminPhone, text }, { headers: { token: adminToken } });
    } catch (err) {
      this.logger.error(`[PROMPT-DRAFT] Falha ao notificar rascunho pronto: ${err.message}`);
    }
  }
}
