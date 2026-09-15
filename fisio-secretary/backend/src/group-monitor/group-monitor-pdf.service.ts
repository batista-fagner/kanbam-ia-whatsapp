import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

export interface GroupReportPdfRow {
  clientName: string;
  sentiment: 'positivo' | 'neutro' | 'risco';
  messageCount: number;
  summary: string;
  doubtCategories: string[];
  opportunitySignal: boolean;
  opportunityNote: string | null;
  awaitingClientResponse: boolean;
}

const SENTIMENT_LABEL: Record<GroupReportPdfRow['sentiment'], string> = {
  risco: 'RISCO',
  neutro: 'Neutro',
  positivo: 'Positivo',
};

const SENTIMENT_COLOR: Record<GroupReportPdfRow['sentiment'], string> = {
  risco: '#B91C1C',
  neutro: '#6B7280',
  positivo: '#15803D',
};

// PDF consolidado do dia (todos os grupos "Projeto <cliente>" num arquivo só), gerado por
// GroupMonitorReportService e enviado via GroupMonitorService.sendDocument(). Layout simples
// e legível de propósito (sem imagem/logo) — prioriza risco/sem-resposta no topo, cada
// cliente em sua própria seção com um separador, pra dar pra ler rápido no celular.
@Injectable()
export class GroupMonitorPdfService {
  async buildDailyReportPdf(reportDate: string, rows: GroupReportPdfRow[]): Promise<Buffer> {
    const ordered = this._orderByPriority(rows);

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const dateLabel = new Date(`${reportDate}T12:00:00`).toLocaleDateString('pt-BR', {
        weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
      });

      doc.fontSize(18).fillColor('#1F2937').font('Helvetica-Bold')
        .text('Relatório de Grupos — Projeto <cliente>', { align: 'left' });
      doc.fontSize(11).fillColor('#6B7280').font('Helvetica')
        .text(dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1));

      const riskCount = ordered.filter((r) => r.sentiment === 'risco').length;
      const awaitingCount = ordered.filter((r) => r.awaitingClientResponse).length;
      const opportunityCount = ordered.filter((r) => r.opportunitySignal).length;
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor('#374151')
        .text(`${ordered.length} grupo(s) com conversa · ${riskCount} em risco · ${awaitingCount} sem resposta do cliente · ${opportunityCount} sinal de oportunidade`);

      doc.moveDown(1);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#E5E7EB').stroke();
      doc.moveDown(1);

      for (const row of ordered) {
        this._renderRow(doc, row);
      }

      if (ordered.length === 0) {
        doc.fontSize(11).fillColor('#9CA3AF').text('Nenhum grupo com conversa neste dia.');
      }

      doc.end();
    });
  }

  private _orderByPriority(rows: GroupReportPdfRow[]): GroupReportPdfRow[] {
    const weight = (r: GroupReportPdfRow) => {
      if (r.sentiment === 'risco') return 0;
      if (r.awaitingClientResponse) return 1;
      return 2;
    };
    return [...rows].sort((a, b) => weight(a) - weight(b) || a.clientName.localeCompare(b.clientName, 'pt-BR'));
  }

  private _renderRow(doc: PDFKit.PDFDocument, row: GroupReportPdfRow): void {
    if (doc.y > 700) doc.addPage();

    doc.fontSize(13).fillColor('#111827').font('Helvetica-Bold').text(row.clientName, { continued: false });

    doc.fontSize(9).font('Helvetica-Bold').fillColor(SENTIMENT_COLOR[row.sentiment])
      .text(SENTIMENT_LABEL[row.sentiment], { continued: true })
      .fillColor('#9CA3AF').font('Helvetica')
      .text(`   ·   ${row.messageCount} mensagem(ns)`);

    if (row.awaitingClientResponse) {
      doc.moveDown(0.2);
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#B91C1C')
        .text('ATENÇÃO: equipe falou e cliente não respondeu no dia — considerar ligar');
    }

    if (row.opportunitySignal) {
      doc.moveDown(0.2);
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#B45309')
        .text(`OPORTUNIDADE${row.opportunityNote ? ': ' + row.opportunityNote : ''}`);
    }

    doc.moveDown(0.3);
    doc.fontSize(10).font('Helvetica').fillColor('#374151').text(row.summary || 'Sem resumo.', { width: 495 });

    if (row.doubtCategories?.length > 0) {
      doc.moveDown(0.2);
      doc.fontSize(9).font('Helvetica-Oblique').fillColor('#4338CA')
        .text(`Dúvidas: ${row.doubtCategories.join(' · ')}`, { width: 495 });
    }

    doc.moveDown(0.8);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#F3F4F6').stroke();
    doc.moveDown(0.8);
  }
}
