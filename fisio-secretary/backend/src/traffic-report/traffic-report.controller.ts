import { Body, Controller, Get, Header, HttpCode, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { TrafficReportService } from './traffic-report.service';
import { fmtDay } from './traffic-report.format';

const esc = (s: string) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function page(title: string, body: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style>
:root{color-scheme:light dark;--bg:#f6f6f4;--card:#fff;--fg:#1c1c1a;--mut:#6b6b66;--line:#deded9;--ok:#1f7a4d;--no:#a3372b}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--card:#20201e;--fg:#ecece8;--mut:#a0a09a;--line:#3a3a36;--ok:#3fae78;--no:#d9705f}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:640px;margin:0 auto;padding:24px 16px 48px}h1{font-size:20px;margin:0 0 4px}
.mut{color:var(--mut);font-size:14px;margin:0 0 20px}label{display:block;font-weight:600;font-size:14px;margin:0 0 6px}
textarea{width:100%;min-height:340px;padding:12px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--fg);font:15px/1.5 inherit;resize:vertical}
pre{white-space:pre-wrap;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;font:14px/1.5 inherit;margin:0 0 20px}
.row{display:flex;gap:12px;flex-wrap:wrap;margin-top:16px}button{flex:1;min-width:150px;padding:14px;border-radius:10px;border:1px solid var(--line);font:600 16px inherit;cursor:pointer;background:var(--card);color:var(--fg)}
button.ok{background:var(--ok);border-color:var(--ok);color:#fff}button.no{color:var(--no)}
.msg{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px}
</style></head><body><main>${body}</main></body></html>`;
}

// Página pública de aprovação do relatório semanal de tráfego. Sem login de propósito: o
// aprovador abre pelo link que chegou no WhatsApp dele; quem protege é o token do link
// (48 caracteres aleatórios, um por relatório). O GET só MOSTRA — enviar exige o POST do
// botão, então a pré-visualização de link do WhatsApp não aprova nada sozinha.
@Controller('traffic-reports')
export class TrafficReportApprovalController {
  constructor(private readonly service: TrafficReportService) {}

  @Get('approve/:token')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async show(@Param('token') token: string): Promise<string> {
    const found = await this.service.findByToken(token);
    if (!found || !found.client) throw new NotFoundException('Relatório não encontrado');
    const { report, client, expired } = found;
    const title = `Relatório ${client.name}`;
    const head = `<h1>${esc(title)}</h1><p class="mut">Período: ${fmtDay(report.periodStart)} a ${fmtDay(report.periodEnd)} · vai para o grupo do cliente no WhatsApp</p>`;

    if (report.status !== 'pending' || expired) {
      const msg = expired && report.status === 'pending'
        ? 'Este link expirou. O relatório da semana seguinte já deve ter sido gerado.'
        : this.service.statusMessage(report.status);
      return page(title, `${head}<div class="msg">${esc(msg)}</div>${report.text ? `<p class="mut" style="margin-top:20px">Texto:</p><pre>${esc(report.text)}</pre>` : ''}`);
    }

    return page(title, `${head}
<form method="post">
<label for="text">Texto que será enviado (pode editar)</label>
<textarea id="text" name="text" required>${esc(report.text)}</textarea>
<p class="mut" style="margin:16px 0 6px">Só para você (não vai para o grupo):</p>
<pre>${esc(report.internalNote)}</pre>
<div class="row">
<button class="ok" type="submit" name="action" value="send">Aprovar e enviar</button>
<button class="no" type="submit" name="action" value="discard">Descartar</button>
</div></form>`);
  }

  @Post('approve/:token')
  @HttpCode(200)
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async submit(@Param('token') token: string, @Body() body: { action?: string; text?: string }): Promise<string> {
    const result = body?.action === 'discard'
      ? await this.service.discard(token)
      : await this.service.approve(token, String(body?.text ?? ''));
    return page('Relatório de tráfego', `<h1>${result.ok ? '✅ Feito' : '⚠️ Atenção'}</h1><div class="msg">${esc(result.message)}</div>`);
  }
}

// Cadastro dos clientes de tráfego e "gerar agora" — só admin.
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/traffic-reports')
export class TrafficReportAdminController {
  constructor(private readonly service: TrafficReportService) {}

  @Get('clients')
  clients() {
    return this.service.listClients();
  }

  @Post('clients')
  save(@Body() body: any) {
    return this.service.saveClient(body ?? {});
  }

  @Post('clients/:id/generate')
  async generate(@Param('id') id: string) {
    const report = await this.service.generateNow(id);
    if (!report) throw new NotFoundException('Cliente não encontrado');
    return { id: report.id, status: report.status, periodStart: report.periodStart, periodEnd: report.periodEnd, error: report.error };
  }
}
