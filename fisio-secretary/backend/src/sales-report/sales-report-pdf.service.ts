import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { ReportMetrics, SalesReportContent } from './sales-report.prompt';
import { LOGO_WHITE_PNG } from './logo-white';

// Identidade Convert Hair (logo): rosa + marinho.
const NAVY = '#131A49';
const PINK = '#FF1DA6';
const INK = '#1F2937';
const MUTED = '#6B7280';
const LINE = '#E5E7EB';
const CARD = '#F7F7FB';

const SECTION = {
  acertos: { color: '#16A34A', soft: '#ECFDF3', label: 'O que deu certo' },
  erros: { color: '#DC2626', soft: '#FEF2F2', label: 'O que deu errado' },
  ia: { color: PINK, soft: '#FFF0F8', label: 'Onde a IA precisa melhorar' },
  equipe: { color: NAVY, soft: '#EEF0FA', label: 'Onde a equipe pode melhorar' },
  oportunidades: { color: '#EA580C', soft: '#FFF4EC', label: 'Clientes para retomar' },
} as const;

// Fonte padrão do pdfkit (Helvetica/WinAnsi): desenha Latin-1 e a pontuação do cp1252
// (travessão, aspas curvas, reticências). Emoji e o resto viram lixo — saem do texto.
const pdfText = (s: string | undefined | null) =>
  (s ?? '').replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF–—‘’“”•…]/g, '').replace(/[ \t]{2,}/g, ' ').trim();

const PAGE_W = 595.28;
const M = 40;
const CW = PAGE_W - M * 2; // largura útil
const BOTTOM = 842 - 60; // acima do rodapé

type Doc = PDFKit.PDFDocument;

// PDF do relatório de vendas — enviado ao WhatsApp de notificações e baixável no CRM.
@Injectable()
export class SalesReportPdfService {
  async build(input: { businessName: string; periodLabel: string; metrics: ReportMetrics; content: SalesReportContent }): Promise<Buffer> {
    const { businessName, periodLabel, metrics: m, content: c } = input;
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      this.header(doc, businessName, periodLabel);
      let y = 132;
      y = this.summary(doc, y, c);
      y = this.kpis(doc, y + 14, m);
      y = this.charts(doc, y + 14, m);

      doc.y = y + 18;
      this.section(doc, 'acertos', c.acertos.map((x) => ({ title: x.titulo, body: x.detalhe, example: x.exemplo })));
      this.section(doc, 'erros', c.erros.map((x) => ({ title: x.titulo, body: x.detalhe, example: x.exemplo })));
      this.section(doc, 'ia', c.melhoriasIa.map((x) => ({ title: x.problema, body: x.sugestao, example: x.exemplo })));
      this.section(doc, 'equipe', c.melhoriasEquipe.map((x) => ({ title: x.problema, body: x.sugestao, example: x.exemplo })));
      this.section(doc, 'oportunidades', c.oportunidades.map((x) => ({ title: x.cliente, body: x.situacao, example: x.acao ? `Ação sugerida: ${x.acao}` : undefined })));
      this.plan(doc, c.planoSemana);

      this.footers(doc);
      doc.end();
    });
  }

  // ── Cabeçalho: faixa marinho com logo, título e período ──
  private header(doc: Doc, businessName: string, periodLabel: string): void {
    doc.rect(0, 0, PAGE_W, 104).fill(NAVY);
    doc.rect(0, 104, PAGE_W, 5).fill(PINK);
    doc.image(LOGO_WHITE_PNG, M, 34, { height: 36 });
    const rx = PAGE_W - M - 260;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(PINK).text('RELATÓRIO DE VENDAS', rx, 30, { width: 260, align: 'right', characterSpacing: 1.5 });
    doc.font('Helvetica-Bold').fontSize(20).fillColor('#FFFFFF').text(pdfText(businessName), rx, 44, { width: 260, align: 'right' });
    doc.font('Helvetica').fontSize(9.5).fillColor('#C7CBE6').text(`Semana de ${periodLabel}`, rx, 72, { width: 260, align: 'right' });
  }

  // ── Resumo da semana ──
  // (Sem nota de atendimento por enquanto: os critérios ainda vão ser definidos.)
  private summary(doc: Doc, y: number, c: SalesReportContent): number {
    const sumX = M;
    const sumW = CW;
    const resumo = pdfText(c.resumo) || 'Sem resumo.';
    doc.font('Helvetica').fontSize(9.5);
    const textH = doc.heightOfString(resumo, { width: sumW - 28, lineGap: 2 });
    const h = textH + 46;

    this.card(doc, sumX, y, sumW, h);
    doc.rect(sumX, y, 4, h).fill(PINK);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY).text('Resumo da semana', sumX + 14, y + 13);
    doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(resumo, sumX + 14, y + 32, { width: sumW - 28, lineGap: 2 });
    return y + h;
  }

  // ── Cartões de números ──
  private kpis(doc: Doc, y: number, m: ReportMetrics): number {
    const items: Array<{ label: string; value: number; tone?: 'pink' | 'alert' }> = [
      { label: 'Conversas', value: m.conversas },
      { label: 'Leads novos', value: m.novosLeads },
      { label: 'Agendados', value: m.agendados },
      { label: 'Vendas', value: m.vendas, tone: 'pink' },
      { label: 'Aguardando resposta', value: m.aguardandoResposta, tone: 'alert' },
    ];
    const gap = 8;
    const w = (CW - gap * (items.length - 1)) / items.length;
    const h = 60;
    items.forEach((it, i) => {
      const x = M + i * (w + gap);
      const bg = it.tone === 'pink' ? PINK : CARD;
      doc.roundedRect(x, y, w, h, 8).fill(bg);
      const numColor = it.tone === 'pink' ? '#FFFFFF' : it.tone === 'alert' ? '#DC2626' : NAVY;
      const labColor = it.tone === 'pink' ? '#FFE3F3' : MUTED;
      doc.font('Helvetica-Bold').fontSize(22).fillColor(numColor).text(String(it.value ?? 0), x, y + 10, { width: w, align: 'center' });
      doc.font('Helvetica').fontSize(8).fillColor(labColor).text(it.label, x + 4, y + 40, { width: w - 8, align: 'center' });
    });
    return y + h;
  }

  // ── Gráficos: mensagens por dia (barras) + funil ──
  private charts(doc: Doc, y: number, m: ReportMetrics): number {
    const h = 178;
    const leftW = 318;
    const rightX = M + leftW + 12;
    const rightW = CW - leftW - 12;

    // Barras agrupadas por dia
    this.card(doc, M, y, leftW, h);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY).text('Mensagens por dia', M + 14, y + 12);
    const legend = [['Clientes', '#B7BCE0'], ['IA', PINK], ['Equipe', NAVY]] as const;
    let lx = M + leftW - 14;
    for (const [name, color] of [...legend].reverse()) {
      doc.font('Helvetica').fontSize(7.5);
      const tw = doc.widthOfString(name);
      lx -= tw;
      doc.fillColor(MUTED).text(name, lx, y + 14, { lineBreak: false });
      lx -= 10;
      doc.roundedRect(lx, y + 14, 7, 7, 1.5).fill(color);
      lx -= 10;
    }
    const days = m.porDia ?? [];
    const plotX = M + 30;
    const plotY = y + 38;
    const plotW = leftW - 44;
    const plotH = h - 70;
    const max = Math.max(1, ...days.map((d) => Math.max(d.recebidas, d.ia, d.equipe)));
    // linhas de grade
    for (let g = 0; g <= 4; g++) {
      const gy = plotY + plotH - (plotH * g) / 4;
      doc.moveTo(plotX, gy).lineTo(plotX + plotW, gy).lineWidth(0.5).strokeColor(LINE).stroke();
      doc.font('Helvetica').fontSize(6.5).fillColor(MUTED).text(String(Math.round((max * g) / 4)), M + 6, gy - 3, { width: 20, align: 'right' });
    }
    if (days.length) {
      const slot = plotW / days.length;
      const bw = Math.min(9, (slot - 8) / 3);
      days.forEach((d, i) => {
        const sx = plotX + i * slot + (slot - bw * 3 - 4) / 2;
        [[d.recebidas, '#B7BCE0'], [d.ia, PINK], [d.equipe, NAVY]].forEach(([val, color], k) => {
          const bh = (plotH * Number(val)) / max;
          if (bh > 0) doc.roundedRect(sx + k * (bw + 2), plotY + plotH - bh, bw, bh, 1.5).fill(color as string);
        });
        doc.font('Helvetica').fontSize(7).fillColor(MUTED).text(d.dia, plotX + i * slot, plotY + plotH + 5, { width: slot, align: 'center' });
      });
    } else {
      doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('Sem dados por dia neste relatório.', plotX, plotY + plotH / 2, { width: plotW, align: 'center' });
    }

    // Funil
    this.card(doc, rightX, y, rightW, h);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY).text('Funil da semana', rightX + 14, y + 12);
    const steps: Array<[string, number, string]> = [
      ['Conversas', m.conversas, NAVY],
      ['Agendados', m.agendados, '#4F57A8'],
      ['Vendas', m.vendas, PINK],
      ['Perdidos', m.perdidos, '#9CA3AF'],
    ];
    const top = Math.max(1, m.conversas);
    const barMaxW = rightW - 28;
    steps.forEach(([label, val, color], i) => {
      const by = y + 38 + i * 33;
      doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(label, rightX + 14, by, { lineBreak: false });
      doc.font('Helvetica-Bold').fontSize(8).fillColor(INK).text(String(val), rightX + 14, by, { width: barMaxW, align: 'right' });
      doc.roundedRect(rightX + 14, by + 12, barMaxW, 9, 4.5).fill('#ECEDF5');
      const bw = Math.max(val > 0 ? 9 : 0, (barMaxW * val) / top);
      if (bw > 0) doc.roundedRect(rightX + 14, by + 12, bw, 9, 4.5).fill(color);
    });
    const conv = m.conversas ? ((m.vendas / m.conversas) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : '0';
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(`Conversão em venda: ${conv}% das conversas`, rightX + 14, y + h - 18, { width: barMaxW });
    return y + h;
  }

  // ── Seções em blocos ──
  private section(doc: Doc, key: keyof typeof SECTION, items: { title: string; body: string; example?: string }[]): void {
    if (!items.length) return;
    const s = SECTION[key];
    this.sectionTitle(doc, s.label, s.color, items.length);
    for (const it of items) {
      const title = pdfText(it.title);
      const body = pdfText(it.body);
      const example = it.example ? pdfText(it.example) : '';
      const innerW = CW - 30;
      doc.font('Helvetica-Bold').fontSize(9.5);
      const th = doc.heightOfString(title, { width: innerW });
      doc.font('Helvetica').fontSize(9);
      const bh = body ? doc.heightOfString(body, { width: innerW, lineGap: 1.5 }) + 3 : 0;
      doc.font('Helvetica-Oblique').fontSize(8.5);
      const eh = example ? doc.heightOfString(`“${example}”`, { width: innerW - 10 }) + 8 : 0;
      const h = th + bh + eh + 18;
      this.ensure(doc, h + 8);
      const y = doc.y;
      doc.roundedRect(M, y, CW, h, 7).fill(s.soft);
      doc.roundedRect(M, y, 4, h, 2).fill(s.color);
      let ty = y + 9;
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(title, M + 16, ty, { width: innerW });
      ty += th + 3;
      if (body) {
        doc.font('Helvetica').fontSize(9).fillColor('#374151').text(body, M + 16, ty, { width: innerW, lineGap: 1.5 });
        ty += bh;
      }
      if (example) {
        doc.moveTo(M + 16, ty + 2).lineTo(M + 16, ty + eh - 4).lineWidth(1.5).strokeColor(s.color).stroke();
        doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(MUTED).text(`“${example}”`, M + 24, ty + 2, { width: innerW - 10 });
      }
      doc.y = y + h + 7;
    }
    doc.y += 8;
  }

  private plan(doc: Doc, plan: string[]): void {
    if (!plan.length) return;
    this.sectionTitle(doc, 'Plano para a próxima semana', NAVY, plan.length);
    plan.forEach((p, i) => {
      const text = pdfText(p);
      doc.font('Helvetica').fontSize(9.5);
      const th = doc.heightOfString(text, { width: CW - 40, lineGap: 1.5 });
      const h = Math.max(24, th + 12);
      this.ensure(doc, h + 6);
      const y = doc.y;
      doc.circle(M + 11, y + 11, 10).fill(PINK);
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#FFFFFF').text(String(i + 1), M + 1, y + 6, { width: 20, align: 'center' });
      doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(text, M + 30, y + 5, { width: CW - 40, lineGap: 1.5 });
      doc.y = y + h + 4;
    });
  }

  private sectionTitle(doc: Doc, label: string, color: string, count: number): void {
    this.ensure(doc, 70);
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(12.5).fillColor(color).text(label, M, y);
    doc.font('Helvetica-Bold').fontSize(12.5);
    const w = doc.widthOfString(label);
    doc.roundedRect(M + w + 8, y + 1, 18, 13, 6.5).fill(color);
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#FFFFFF').text(String(count), M + w + 8, y + 3.5, { width: 18, align: 'center' });
    doc.y = y + 22;
  }

  private card(doc: Doc, x: number, y: number, w: number, h: number): void {
    doc.roundedRect(x, y, w, h, 9).fill(CARD);
  }

  private ensure(doc: Doc, needed: number): void {
    if (doc.y + needed > BOTTOM) {
      doc.addPage();
      doc.rect(0, 0, PAGE_W, 6).fill(PINK);
      doc.y = M;
    }
  }

  private footers(doc: Doc): void {
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // O rodapé fica abaixo da margem inferior; sem zerar a margem o pdfkit abriria página nova.
      const bottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const fy = 842 - 38;
      doc.moveTo(M, fy).lineTo(PAGE_W - M, fy).lineWidth(0.5).strokeColor(LINE).stroke();
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
        .text('Gerado pela IA da Convert Hair  ·  análise das conversas do WhatsApp', M, fy + 8, { lineBreak: false });
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(PINK)
        .text(`${i + 1} / ${range.count}`, M, fy + 8, { width: CW, align: 'right', lineBreak: false });
      doc.page.margins.bottom = bottomMargin;
    }
  }
}
