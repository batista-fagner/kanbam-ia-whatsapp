import { buildTranscript, estimateCostUsd, parseReportContent } from './sales-report.prompt';
import { SalesReportService, SALES_REPORT_TENANT_IDS } from './sales-report.service';

const DALU = SALES_REPORT_TENANT_IDS[0];
const msg = (direction: 'inbound' | 'outbound', sender: string, content: string) => ({ direction, sender, content, createdAt: new Date('2026-10-20T15:00:00Z') });

describe('Relatório de vendas — material e resposta da IA', () => {
  it('transcrição: conversas maiores primeiro e rótulo de quem falou', () => {
    const t = buildTranscript([
      { leadName: 'Ana', stage: 'novo_lead', temperature: null, messages: [msg('inbound', '55', 'oi')] },
      { leadName: 'Bia', stage: 'lead_quente', temperature: 'quente', messages: [msg('inbound', '55', 'quanto custa?'), msg('outbound', 'ai', 'R$ 300'), msg('outbound', 'operator', 'posso agendar?')] },
    ]);
    expect(t.text.indexOf('Bia')).toBeLessThan(t.text.indexOf('Ana'));
    expect(t.text).toContain('Cliente: quanto custa?');
    expect(t.text).toContain('IA: R$ 300');
    expect(t.text).toContain('Equipe: posso agendar?');
    expect(t.text).toContain('raia: Lead quente');
    expect(t.included).toBe(2);
  });

  it('transcrição: passa do teto → corta as menores e conta quantas ficaram de fora', () => {
    const big = 'x'.repeat(500);
    const convs = Array.from({ length: 30 }, (_, i) => ({
      leadName: `L${i}`, stage: 'novo_lead', temperature: null,
      messages: Array.from({ length: 80 }, () => msg('inbound', '55', big)),
    }));
    const t = buildTranscript(convs);
    expect(t.text.length).toBeLessThanOrEqual(600_000);
    expect(t.omitted).toBeGreaterThan(0);
    expect(t.included + t.omitted).toBe(30);
  });

  it('JSON da IA: normaliza campos faltando e item sem título (sem nota)', () => {
    const c = parseReportContent('```json\n' + JSON.stringify({
      resumo: 'Semana boa', nota: 14,
      acertos: [{ titulo: 'Respostas rápidas', detalhe: 'IA respondeu em segundos' }, { detalhe: 'sem título' }],
      melhoriasIa: [{ problema: 'Falou preço cedo', sugestao: 'Mostrar vídeo antes' }],
    }) + '\n```');
    expect((c as any).nota).toBeUndefined();
    expect(c.acertos).toHaveLength(1);
    expect(c.erros).toEqual([]);
    expect(c.melhoriasIa[0].sugestao).toBe('Mostrar vídeo antes');
    expect(c.planoSemana).toEqual([]);
  });

  it('ação da oportunidade sem o rótulo repetido pela IA', () => {
    const c = parseReportContent(JSON.stringify({ oportunidades: [{ cliente: 'Lia', situacao: 'pediu parcelamento', acao: 'Mensagem/ação sugerida: Lia, qual opção ficou melhor?' }] }));
    expect(c.oportunidades[0].acao).toBe('Lia, qual opção ficou melhor?');
  });

  it('JSON inválido lança (o serviço tenta o próximo modelo)', () => {
    expect(() => parseReportContent('não é json')).toThrow();
  });

  it('custo: Gemini 2.5 Flash por 1M tokens (input, cacheado, output)', () => {
    expect(estimateCostUsd('gemini-2.5-flash', 1_000_000, 0, 0)).toBeCloseTo(0.30);
    expect(estimateCostUsd('gemini-2.5-flash', 0, 0, 1_000_000)).toBeCloseTo(2.50);
    expect(estimateCostUsd('gemini-2.5-flash', 1_000_000, 1_000_000, 0)).toBeCloseTo(0.03);
  });
});

describe('Relatório de vendas — limite semanal e piloto', () => {
  const make = (recent: Array<{ created_at: Date }>, processing = false) => {
    const reportRepo: any = {
      findOne: jest.fn(async () => (processing ? { id: 'p' } : null)),
      query: jest.fn(async () => recent),
    };
    const configRepo: any = { findOne: jest.fn(async () => ({ notificationPhone: '5584999990000' })) };
    const config: any = { get: () => undefined };
    return new SalesReportService(reportRepo, configRepo, {} as any, {} as any, {} as any, config);
  };

  it('cliente fora do piloto → desabilitado', async () => {
    const st = await make([]).status('outro-tenant', false);
    expect(st.enabled).toBe(false);
    expect(st.canGenerate).toBe(false);
  });

  it('nenhum relatório nos últimos 7 dias → pode gerar', async () => {
    const st = await make([]).status(DALU, false);
    expect(st.canGenerate).toBe(true);
    expect(st.nextAvailableAt).toBeNull();
  });

  it('já gerou nesta semana → bloqueia e diz quando libera (7 dias depois)', async () => {
    const at = new Date('2026-10-24T13:00:00Z');
    const st = await make([{ created_at: at }]).status(DALU, false);
    expect(st.canGenerate).toBe(false);
    expect(st.nextAvailableAt).toBe(new Date(at.getTime() + 7 * 24 * 3600_000).toISOString());
  });

  it('admin gera sem limite (teste/suporte)', async () => {
    const st = await make([{ created_at: new Date() }]).status(DALU, true);
    expect(st.canGenerate).toBe(true);
  });

  it('relatório em andamento → ninguém gera outro', async () => {
    const st = await make([], true).status(DALU, true);
    expect(st.canGenerate).toBe(false);
    expect(st.processing).toBe(true);
  });
});
