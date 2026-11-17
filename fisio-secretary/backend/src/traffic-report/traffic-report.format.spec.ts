import {
  parseInsightsRow, parseTopAd, reportPeriod, previousPeriod, nextReportDate,
  fmtMoney, fmtInt, buildClientText, buildInternalNote, MESSAGING_ACTION,
} from './traffic-report.format';

// Números reais da Paraíso dos Fios, 10 a 15/11/2026 (conferidos no Gerenciador).
const paraisoRow = {
  spend: '598.36', impressions: '54168', reach: '31690', frequency: '1.709309', ctr: '4.57', cpm: '11.05',
  actions: [
    { action_type: 'link_click', value: '936' },
    { action_type: MESSAGING_ACTION, value: '550' },
  ],
};

describe('traffic-report.format', () => {
  it('lê a linha de insights da Meta', () => {
    const m = parseInsightsRow(paraisoRow);
    expect(m).toMatchObject({ spend: 598.36, impressions: 54168, reach: 31690, conversations: 550 });
  });

  it('conta sem veiculação vira zeros (não quebra)', () => {
    expect(parseInsightsRow(undefined)).toMatchObject({ spend: 0, reach: 0, conversations: 0 });
    expect(parseInsightsRow({ spend: '10' }).conversations).toBe(0);
  });

  it('período = 7 dias completos antes do dia do envio', () => {
    expect(reportPeriod('2026-11-23')).toEqual({ since: '2026-11-16', until: '2026-11-22' });
    expect(previousPeriod({ since: '2026-11-16' })).toEqual({ since: '2026-11-09', until: '2026-11-15' });
    // virada de mês
    expect(reportPeriod('2026-12-03')).toEqual({ since: '2026-11-26', until: '2026-12-02' });
  });

  it('próximo envio é 7 dias depois, mantendo o dia da semana mesmo se pulou rodada', () => {
    expect(nextReportDate('2026-11-23', '2026-11-23')).toBe('2026-11-30');
    expect(nextReportDate('2026-11-23', '2026-12-02')).toBe('2026-12-07');
  });

  it('formata dinheiro e milhar em pt-BR', () => {
    expect(fmtMoney(598.36)).toBe('R$ 598,36');
    expect(fmtMoney(1234.5)).toBe('R$ 1.234,50');
    expect(fmtInt(31690)).toBe('31.690');
  });

  it('texto do cliente traz os números certos e nenhum jargão', () => {
    const cur = parseInsightsRow(paraisoRow);
    const prev = parseInsightsRow({ spend: '481.14', actions: [{ action_type: MESSAGING_ACTION, value: '594' }] });
    const text = buildClientText('Paraíso dos Fios', { since: '2026-11-10', until: '2026-11-16' }, cur, prev);
    expect(text).toContain('*Relatório Paraíso dos Fios | 10/11 a 16/11*');
    expect(text).toContain('*550 pessoas* chamaram no WhatsApp');
    expect(text).toContain('Investido: *R$ 598,36*');
    expect(text).toContain('Cada conversa saiu por *R$ 1,09*');
    expect(text).toContain('*31.690 pessoas* diferentes');
    expect(text).toContain('Na semana anterior foram 594 conversas, a R$ 0,81 cada.');
    expect(text).not.toMatch(/CTR|frequ[êe]ncia|CPM|criativo/i);
  });

  it('sem conversa não inventa custo por conversa nem comparação', () => {
    const cur = parseInsightsRow({ spend: '50', reach: '900' });
    const text = buildClientText('X', { since: '2026-11-16', until: '2026-11-22' }, cur, null);
    expect(text).not.toContain('Cada conversa');
    expect(text).not.toContain('semana anterior');
    expect(buildInternalNote(cur, null, null)).toContain('nenhuma conversa');
  });

  it('nota interna mostra o anúncio que mais trouxe conversa', () => {
    const top = parseTopAd([
      { ad_name: '0005', spend: '64.8', actions: [{ action_type: MESSAGING_ACTION, value: '63' }] },
      { ad_name: '0004', spend: '445.06', actions: [{ action_type: MESSAGING_ACTION, value: '418' }] },
      { ad_name: 'sem conversa', spend: '5' },
    ]);
    expect(top).toMatchObject({ name: '0004', conversations: 418 });
    const note = buildInternalNote(parseInsightsRow(paraisoRow), null, top);
    expect(note).toContain('"0004" (418 conversas, 76% do total)');
    expect(note).toContain('Frequência 1,71 · CTR 4,57%');
  });
});
