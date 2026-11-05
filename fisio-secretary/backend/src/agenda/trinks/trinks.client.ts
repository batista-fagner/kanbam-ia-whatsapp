// Cliente HTTP da API da Trinks (https://trinks.readme.io). Sem estado: recebe a chave e o
// estabelecimento por chamada; quem conta a cota (5.000/mês) é o `beforeCall` injetado.

export const TRINKS_BASE_URL = 'https://api.trinks.com/v1';

// Status do agendamento na Trinks (StatusDTO).
export const TRINKS_STATUS = { aguardando: 3, confirmado: 4, faltou: 6, emAtendimento: 7, finalizado: 8, cancelado: 9 } as const;
export const TRINKS_ACTIVE_STATUS: number[] = [TRINKS_STATUS.aguardando, TRINKS_STATUS.confirmado, TRINKS_STATUS.emAtendimento];

// Trinks indisponível para a IA: cota, limite por minuto, chave inválida ou fora do ar.
// Nunca vira "agendado" — a IA responde que a equipe confirma.
export class TrinksUnavailableError extends Error {
  constructor(public readonly reason: 'quota' | 'rate_limit' | 'auth' | 'down' | 'not_connected', message: string) {
    super(message);
  }
}

// Erro de validação da Trinks (400/404) — a mensagem dela vai pro log.
export class TrinksApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export interface TrinksCreds {
  apiKey: string;
  establishmentId: string | null;
}

export interface TrinksProfessionalSlots {
  id: number;
  nome: string;
  horariosVagos: string[];
}

export interface TrinksAppointment {
  id: number;
  status: { id: number; nome: string | null } | null;
  cliente: { id: number; nome: string } | null;
  servico: { id: number; nome: string } | null;
  profissional: { id: number; nome: string } | null;
  dataHoraInicio: string; // local, sem fuso
  duracaoEmMinutos: number;
  valor: number | null;
  observacoesDoEstabelecimento?: string | null;
}

export interface TrinksAppointmentInput {
  clienteId: number;
  servicoId: number;
  profissionalId: number;
  dataHoraInicio: string; // "2026-11-07T13:00:00"
  duracaoEmMinutos: number;
  valor: number;
  observacoes?: string;
}

type FetchLike = (url: string, init?: any) => Promise<{ ok: boolean; status: number; text(): Promise<string>; headers?: { get(name: string): string | null } }>;

export interface TrinksClientOptions {
  beforeCall?: () => Promise<void>; // conta a cota; lança TrinksUnavailableError se estourou
  fetchImpl?: FetchLike;
  baseUrl?: string;
  retryDelayMs?: number;
  // Espaço mínimo entre chamadas deste cliente — a Trinks barra rajada (429) mesmo abaixo de 60/min.
  minIntervalMs?: number;
  // Quantas vezes esperar e repetir uma LEITURA que levou 429 (escrita nunca repete).
  rateLimitRetries?: number;
  maxRateLimitWaitMs?: number;
}

const PAGE_SIZE = 50;
const MAX_PAGES = 20;

export class TrinksClient {
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;
  private readonly retryDelayMs: number;
  private lastCallAt = 0;

  constructor(private readonly creds: TrinksCreds, private readonly opts: TrinksClientOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init) as any);
    this.baseUrl = (opts.baseUrl ?? TRINKS_BASE_URL).replace(/\/$/, '');
    this.retryDelayMs = opts.retryDelayMs ?? 800;
  }

  private async request<T>(method: string, path: string, opts: { query?: Record<string, string | number | boolean | undefined>; body?: unknown; withEstablishment?: boolean } = {}): Promise<T> {
    const qs = Object.entries(opts.query ?? {})
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    const url = `${this.baseUrl}${path}${qs ? `?${qs}` : ''}`;
    const headers: Record<string, string> = { 'X-Api-Key': this.creds.apiKey, Accept: 'application/json' };
    if (opts.withEstablishment !== false) {
      if (!this.creds.establishmentId) throw new TrinksUnavailableError('not_connected', 'Estabelecimento da Trinks não definido');
      headers.estabelecimentoId = this.creds.establishmentId;
    }
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

    // Só repete leitura (GET). Escrita repetida poderia gravar agendamento em dobro.
    const attempts = method === 'GET' ? 3 : 1;
    let rateLimitLeft = method === 'GET' ? (this.opts.rateLimitRetries ?? 2) : 0;
    let lastErr: unknown = null;
    for (let i = 0; i < attempts; i++) {
      const gap = (this.opts.minIntervalMs ?? 0) - (Date.now() - this.lastCallAt);
      if (gap > 0) await sleep(gap);
      this.lastCallAt = Date.now();
      if (this.opts.beforeCall) await this.opts.beforeCall();
      let res: Awaited<ReturnType<FetchLike>>;
      try {
        res = await this.fetchImpl(url, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
      } catch (err) {
        lastErr = new TrinksUnavailableError('down', `Trinks não respondeu: ${(err as Error)?.message ?? err}`);
        if (i < attempts - 1) await sleep(this.retryDelayMs);
        continue;
      }
      const text = await res.text();
      if (res.ok) return (text ? JSON.parse(text) : null) as T;
      if (res.status === 429) {
        // Espera o que a Trinks pedir (Retry-After) e tenta a leitura de novo; escrita não repete.
        const retryAfter = Number(res.headers?.get?.('retry-after'));
        const wait = Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * (3 - rateLimitLeft), this.opts.maxRateLimitWaitMs ?? 8000);
        if (rateLimitLeft > 0) {
          rateLimitLeft--;
          i--; // não conta como tentativa de erro de rede/5xx
          await sleep(wait);
          continue;
        }
        throw new TrinksUnavailableError('rate_limit', 'Trinks recusou por excesso de chamadas (429)');
      }
      if (res.status === 401 || res.status === 403) throw new TrinksUnavailableError('auth', `Trinks recusou a chave (HTTP ${res.status})`);
      if (res.status >= 500) {
        lastErr = new TrinksUnavailableError('down', `Trinks fora do ar (HTTP ${res.status})`);
        if (i < attempts - 1) await sleep(this.retryDelayMs);
        continue;
      }
      throw new TrinksApiError(res.status, `Trinks HTTP ${res.status}: ${errorMessage(text)}`);
    }
    throw lastErr ?? new TrinksUnavailableError('down', 'Trinks não respondeu');
  }

  private async paged<T>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const r = await this.request<{ data: T[]; totalPages?: number }>('GET', path, { query: { ...query, page, pageSize: PAGE_SIZE } });
      out.push(...(r?.data ?? []));
      if (!r?.data?.length || (r.totalPages ?? 1) <= page) break;
    }
    return out;
  }

  listEstablishments(): Promise<{ data: { id: number; nome: string }[] }> {
    return this.request('GET', '/estabelecimentos', { withEstablishment: false });
  }

  listServices() {
    return this.paged<{ id: number; nome: string; duracaoEmMinutos: number; preco: number | null; visivelParaCliente?: boolean }>('/servicos');
  }

  listProfessionals() {
    return this.paged<{ id: number; nome: string; apelido: string | null; status: string; possuiAgenda: boolean }>('/profissionais');
  }

  listProfessionalServices(professionalId: number) {
    return this.paged<{ id: number }>(`/profissionais/${professionalId}/servicos`);
  }

  async availability(date: string, serviceId: number): Promise<TrinksProfessionalSlots[]> {
    const r = await this.request<{ data: TrinksProfessionalSlots[] }>('GET', `/agendamentos/profissionais/${date}`, { query: { servicoId: serviceId } });
    return (r?.data ?? []).map((p) => ({ id: p.id, nome: p.nome, horariosVagos: Array.isArray(p.horariosVagos) ? p.horariosVagos : [] }));
  }

  // Busca por trecho do telefone (a Trinks aceita trecho). Quem chama confere DDD + número.
  async searchClientsByPhone(fragment: string): Promise<{ id: number; nome: string; telefones: { ddi?: string; ddd?: string; telefone?: string }[] }[]> {
    const r = await this.request<{ data: any[] }>('GET', '/clientes', { query: { Telefone: fragment, PageSize: PAGE_SIZE } });
    return (r?.data ?? []).map((c) => ({ id: c.id, nome: c.nome, telefones: Array.isArray(c.telefones) ? c.telefones : [] }));
  }

  async createClient(input: { nome: string; ddd: string; numero: string }): Promise<number> {
    const r = await this.request<{ id: number }>('POST', '/clientes', {
      body: { nome: input.nome, telefones: [{ ddi: '55', ddd: input.ddd, numero: input.numero, tipoId: 3 }] },
    });
    if (!r?.id) throw new TrinksApiError(500, 'Trinks não devolveu o id da cliente criada');
    return r.id;
  }

  async createAppointment(input: TrinksAppointmentInput & { confirmado: boolean }): Promise<number> {
    const r = await this.request<{ id: number }>('POST', '/agendamentos', { body: input });
    if (!r?.id) throw new TrinksApiError(500, 'Trinks não devolveu o id do agendamento');
    return r.id;
  }

  getAppointment(id: number | string): Promise<TrinksAppointment> {
    return this.request('GET', `/agendamentos/${id}`);
  }

  listClientAppointments(clientId: number | string, from: string, to: string) {
    return this.paged<TrinksAppointment>('/agendamentos', { clienteId: clientId, dataInicio: from, dataFim: to });
  }

  async updateAppointment(id: number | string, input: TrinksAppointmentInput): Promise<void> {
    await this.request('PUT', `/agendamentos/${id}`, { body: input });
  }

  async cancelAppointment(id: number | string, motivo: string): Promise<void> {
    // quemCancelou: 1 = Cliente (foi ela que pediu pelo WhatsApp).
    await this.request('PATCH', `/agendamentos/${id}/status/cancelado`, { body: { quemCancelou: 1, motivo: motivo.slice(0, 250) } });
  }
}

function errorMessage(text: string): string {
  try {
    const j = JSON.parse(text);
    const errs = Array.isArray(j?.Errors) ? j.Errors.map((e: any) => e?.ErrorMessage).filter(Boolean).join('; ') : '';
    return [j?.Message ?? j?.title ?? j?.detail, errs].filter(Boolean).join(' — ') || text.slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// "5584999998888" → { ddd: "84", numero: "999998888" }. Celular com 8 dígitos ganha o 9.
export function splitBrazilPhone(phone: string): { ddd: string; numero: string } | null {
  let d = (phone ?? '').replace(/\D/g, '');
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  if (d.length < 10 || d.length > 11) return null;
  const ddd = d.slice(0, 2);
  let numero = d.slice(2);
  if (numero.length === 8 && /^[6-9]/.test(numero)) numero = `9${numero}`;
  return { ddd, numero };
}

// Mesmo telefone? Compara DDD + últimos 8 dígitos (ignora o 9 extra e o DDI).
export function samePhone(a: { ddd?: string; telefone?: string }, target: { ddd: string; numero: string }): boolean {
  const ddd = (a.ddd ?? '').replace(/\D/g, '').replace(/^0+/, '');
  const num = (a.telefone ?? '').replace(/\D/g, '');
  if (num.length < 8 || num.slice(-8) !== target.numero.slice(-8)) return false;
  // Alguns cadastros trazem o DDD dentro do número e o campo ddd vazio.
  return ddd ? ddd === target.ddd : num.length >= 10 && num.startsWith(target.ddd);
}
