import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PriceConfig } from '../common/entities/price-config.entity';

export interface PriceConfigDto {
  isActive?: boolean;
  products?: { key?: string; label: string; price100g: number | string }[];
  telaPerGram?: number | string | null;
  cartaoSurchargePer100g?: number | string | null;
  especieDiscountPer100g?: number | string | null;
  minGram?: number | string;
  gramStep?: number | string;
}

const MAX_PRODUCTS = 200;

// Valor monetário opcional: '' / null → null ("essa forma de cobrança não existe").
function optionalMoney(v: unknown, field: string): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) throw new BadRequestException(`${field}: valor inválido`);
  return Math.round(n * 100) / 100;
}

function slugify(label: string): string {
  return label
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'produto';
}

// Tabela de preços editável pelo próprio cliente (Configurações → Tabela de preços).
// O motor de cálculo (price-calc.ts) relê a config a cada mensagem, então o que
// for salvo aqui vale na próxima resposta da IA.
@Injectable()
export class PriceConfigService {
  private readonly logger = new Logger(PriceConfigService.name);

  constructor(@InjectRepository(PriceConfig) private readonly repo: Repository<PriceConfig>) {}

  async get(tenantId: string) {
    const config = await this.repo.findOne({ where: { tenantId } });
    if (!config) return { exists: false };
    return { exists: true, ...this.serialize(config) };
  }

  // canToggle: só o admin liga/desliga o cálculo automático. Desligar faz a IA
  // voltar a calcular de cabeça (errava ~20% no S&A) — o cliente edita preços,
  // mas não consegue derrubar o motor sem querer.
  async save(tenantId: string, dto: PriceConfigDto, opts: { canToggle?: boolean; actor?: string } = {}) {
    const existing = await this.repo.findOne({ where: { tenantId } });
    const before = existing ? JSON.stringify(this.serialize(existing)) : null;
    const config = existing ?? this.repo.create({ tenantId, isActive: false, products: [] });

    if (dto.products !== undefined) config.products = this.normalizeProducts(dto.products, config.products);
    if (dto.isActive !== undefined && opts.canToggle) config.isActive = !!dto.isActive;
    if (dto.telaPerGram !== undefined) config.telaPerGram = optionalMoney(dto.telaPerGram, 'Tela');
    if (dto.cartaoSurchargePer100g !== undefined) config.cartaoSurchargePer100g = optionalMoney(dto.cartaoSurchargePer100g, 'Cartão');
    if (dto.especieDiscountPer100g !== undefined) config.especieDiscountPer100g = optionalMoney(dto.especieDiscountPer100g, 'Espécie');
    if (dto.minGram !== undefined) config.minGram = this.positiveInt(dto.minGram, 'Gramatura mínima');
    if (dto.gramStep !== undefined) config.gramStep = this.positiveInt(dto.gramStep, 'Passo de gramatura');

    if (config.isActive && config.products.length === 0) {
      throw new BadRequestException('Cadastre pelo menos um produto antes de ligar a tabela.');
    }

    const saved = await this.repo.save(config);
    // Antes/depois completos no log — se o cliente apagar ou errar um preço,
    // dá pra restaurar a versão anterior a partir daqui.
    this.logger.log(`[PRICE_CONFIG] tenant=${tenantId} por=${opts.actor ?? '?'} antes=${before} depois=${JSON.stringify(this.serialize(saved))}`);
    return { exists: true, ...this.serialize(saved) };
  }

  // A `key` é o que a IA usa no JSON (priceQuotes.productKey) — tem que ser
  // estável. Produto existente mantém a key mesmo se o nome mudar; produto novo
  // ganha uma key derivada do nome, única dentro da tabela.
  private normalizeProducts(input: PriceConfigDto['products'], current: PriceConfig['products']) {
    if (!Array.isArray(input)) throw new BadRequestException('products deve ser uma lista');
    if (input.length > MAX_PRODUCTS) throw new BadRequestException(`Máximo de ${MAX_PRODUCTS} produtos`);

    const currentKeys = new Set((current ?? []).map((p) => p.key));
    const used = new Set<string>();
    const labels = new Set<string>();

    return input.map((p, i) => {
      const label = String(p?.label ?? '').trim();
      if (!label) throw new BadRequestException(`Produto ${i + 1}: nome obrigatório`);
      if (label.length > 120) throw new BadRequestException(`Produto ${i + 1}: nome muito longo`);
      const labelKey = label.toLowerCase();
      if (labels.has(labelKey)) throw new BadRequestException(`Produto repetido: "${label}"`);
      labels.add(labelKey);

      const price = Number(String(p?.price100g ?? '').replace(',', '.'));
      if (!Number.isFinite(price) || price <= 0) throw new BadRequestException(`"${label}": preço inválido`);

      let key = typeof p?.key === 'string' && currentKeys.has(p.key) && !used.has(p.key) ? p.key : '';
      if (!key) {
        const base = slugify(label);
        key = base;
        for (let n = 2; used.has(key) || currentKeys.has(key); n++) key = `${base}_${n}`;
      }
      used.add(key);

      return { key, label, price100g: Math.round(price * 100) / 100 };
    });
  }

  private positiveInt(v: unknown, field: string): number {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0 || n > 5000) throw new BadRequestException(`${field}: valor inválido`);
    return n;
  }

  private serialize(c: PriceConfig) {
    const num = (v: number | string | null) => (v === null || v === undefined ? null : Number(v));
    return {
      isActive: c.isActive,
      products: c.products ?? [],
      telaPerGram: num(c.telaPerGram),
      cartaoSurchargePer100g: num(c.cartaoSurchargePer100g),
      especieDiscountPer100g: num(c.especieDiscountPer100g),
      minGram: c.minGram,
      gramStep: c.gramStep,
      updatedAt: c.updatedAt,
    };
  }
}
