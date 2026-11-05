import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bot, CalendarCheck2, CheckCircle2, AlertTriangle, CircleDashed, Loader2, RefreshCw, Plus, XCircle, History, Settings2, ListChecks } from 'lucide-react'
import {
  getTrinksStatus, getTrinksServices, syncTrinks, linkTrinksService, approveTrinksService, unapproveTrinksService,
  setTrinksAutoConfirm, getTrinksLog, updateAgendaSettings, createAgendaService, listAgendaAppointments,
} from '../services/api'

const TABS = [
  { key: 'services', label: 'Serviços para agendamento', icon: ListChecks },
  { key: 'log', label: 'Agendamentos da IA', icon: Bot },
  { key: 'settings', label: 'Configurações', icon: Settings2 },
  { key: 'old', label: 'Agenda antiga', icon: History },
]

const STATUS_UI = {
  approved: { label: 'Aprovado', cls: 'text-green-700 bg-green-50 border-green-200', Icon: CheckCircle2 },
  pending: { label: 'Confirmar', cls: 'text-amber-700 bg-amber-50 border-amber-200', Icon: AlertTriangle },
  unlinked: { label: 'Sem ligação', cls: 'text-gray-600 bg-gray-50 border-gray-200', Icon: CircleDashed },
  changed: { label: 'Mudou na Trinks', cls: 'text-red-700 bg-red-50 border-red-200', Icon: XCircle },
}

const APPT_STATUS = { agendado: 'Aguardando confirmação', confirmado: 'Confirmado', cancelado: 'Cancelado', realizado: 'Realizado', nao_compareceu: 'Faltou' }

function fmtDateTime(v) {
  if (!v) return '—'
  return new Date(v).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).replace('.', '')
}

function duration(min) {
  if (!min) return '—'
  const h = Math.floor(min / 60)
  const m = min % 60
  return h ? (m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`) : `${m} min`
}

// /calendar para cliente com a agenda da Trinks (tenant_schedules.mode='trinks'): a agenda em si
// fica na Trinks; aqui ela aprova quais serviços a IA pode agendar e acompanha o que a IA marcou.
export default function TrinksAgendaPage() {
  const [tab, setTab] = useState('services')
  const [status, setStatus] = useState(null)
  const [error, setError] = useState('')

  const loadStatus = useCallback(() => getTrinksStatus().then(setStatus).catch((e) => setError(e.message)), [])
  useEffect(() => { loadStatus() }, [loadStatus])

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-800 flex items-center gap-2"><CalendarCheck2 className="w-5 h-5 text-teal-600" /> Agenda Trinks</h1>
          <p className="text-sm text-gray-500">
            {status?.connected ? `Conectada a ${status.establishmentName || 'Trinks'}. ` : 'Trinks ainda não conectada — peça ao administrador. '}
            A agenda do salão fica na Trinks; a IA consulta e marca direto nela.
          </p>
        </div>
        {status && (
          <span className={`text-xs font-medium px-3 py-1.5 rounded-full border ${status.enabled ? 'text-pink-700 bg-pink-50 border-pink-200' : 'text-gray-600 bg-gray-50 border-gray-200'}`}>
            <Bot className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />{status.enabled ? 'IA agendando' : 'IA não agenda'}
          </span>
        )}
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-gray-200 mb-4">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)} className={`flex items-center gap-1.5 px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px ${tab === key ? 'border-pink-600 text-pink-700 font-medium' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
      {tab === 'services' && <ServicesTab status={status} onStatus={loadStatus} />}
      {tab === 'log' && <LogTab />}
      {tab === 'settings' && <SettingsTab status={status} onChanged={loadStatus} />}
      {tab === 'old' && <OldAgendaTab />}
    </div>
  )
}

// ───────── Serviços para agendamento ─────────

function ServicesTab({ status, onStatus }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [choice, setChoice] = useState({})
  const [newName, setNewName] = useState('')

  const load = useCallback(() => getTrinksServices().then((d) => { setData(d); setChoice({}) }).catch((e) => setError(e.message)), [])
  useEffect(() => { load() }, [load])

  const catalog = useMemo(() => [...(data?.catalog ?? [])].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')), [data])

  async function run(key, fn) {
    setBusy(key); setError('')
    try { await fn(); await load() } catch (e) { setError(e.message) } finally { setBusy('') }
  }

  if (!data) return error ? <p className="text-sm text-red-600">{error}</p> : <Loader2 className="w-5 h-5 animate-spin text-gray-400" />

  const links = data.links.filter((l) => l.active)
  const approvedCount = links.filter((l) => l.status === 'approved').length

  return (
    <div>
      <div className="rounded-xl border border-pink-200 bg-pink-50 p-3 text-sm text-pink-900 mb-4">
        <b>A IA só agenda os serviços aprovados.</b> Para cada serviço da sua tabela, confira qual é o serviço correspondente na Trinks e a duração (é ela que ocupa a agenda). Se estiver certo, clique em <b>Aprovar</b>. Os preços continuam vindo da sua tabela de preços, não da Trinks.
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <span className="text-sm text-gray-600">{approvedCount} de {links.length} serviços aprovados</span>
        <button
          onClick={() => run('sync', async () => { await syncTrinks(); onStatus() })}
          disabled={!!busy || !status?.connected}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40"
        >
          {busy === 'sync' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Atualizar da Trinks
        </button>
      </div>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      <div className="space-y-2">
        {links.map((l) => {
          const ui = STATUS_UI[l.status]
          const selected = choice[l.id] ?? (l.externalId ? String(l.externalId) : l.suggestion ? String(l.suggestion.id) : '')
          const selectedSvc = catalog.find((c) => String(c.id) === selected)
          const dirty = selected !== (l.externalId ? String(l.externalId) : '')
          return (
            <div key={l.id} className="border border-gray-200 rounded-xl p-3 grid gap-2 sm:grid-cols-[1fr_1.4fr_auto_auto] sm:items-center">
              <div>
                <div className="text-sm font-medium text-gray-800">{l.name}</div>
                <div className="text-xs text-gray-400">Serviço na sua tabela</div>
              </div>
              <div className="min-w-0">
                <select
                  value={selected}
                  onChange={(e) => setChoice({ ...choice, [l.id]: e.target.value })}
                  className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white"
                >
                  <option value="">— escolha o serviço na Trinks —</option>
                  {catalog.map((c) => <option key={c.id} value={c.id}>{c.nome} ({duration(c.duracaoEmMinutos)})</option>)}
                </select>
                <div className="text-xs text-gray-400 mt-0.5">
                  {!l.externalId && l.suggestion && !choice[l.id] ? 'Sugestão pelo nome — confira' : 'Serviço na Trinks'}
                  {selectedSvc ? ` · duração ${duration(selectedSvc.duracaoEmMinutos)}` : ''}
                </div>
              </div>
              <div>
                <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full border ${ui.cls}`}>
                  <ui.Icon className="w-3.5 h-3.5" /> {dirty ? 'Não salvo' : ui.label}
                </span>
                {!dirty && l.problem && <div className="text-xs text-red-600 mt-1 max-w-[220px]">{l.problem}</div>}
                {!dirty && l.status === 'approved' && l.approvedBy && <div className="text-xs text-gray-400 mt-1">por {l.approvedBy} em {fmtDateTime(l.approvedAt)}</div>}
              </div>
              <div className="flex gap-2 sm:justify-end">
                {(dirty || l.status !== 'approved') ? (
                  <button
                    onClick={() => run(`ap-${l.id}`, async () => {
                      if (dirty) await linkTrinksService(l.id, selected || null)
                      if (selected) await approveTrinksService(l.id)
                    })}
                    disabled={!!busy || !selected || (selectedSvc && !selectedSvc.duracaoEmMinutos)}
                    className="px-3 py-1.5 text-sm font-medium text-white bg-pink-600 rounded-lg hover:bg-pink-700 disabled:opacity-40"
                  >
                    {busy === `ap-${l.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Aprovar'}
                  </button>
                ) : (
                  <button
                    onClick={() => run(`un-${l.id}`, () => unapproveTrinksService(l.id))}
                    disabled={!!busy}
                    className="px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40"
                  >
                    Tirar da IA
                  </button>
                )}
              </div>
            </div>
          )
        })}
        {!links.length && <p className="text-sm text-gray-500">Nenhum serviço cadastrado ainda. Adicione abaixo os serviços que a IA pode agendar.</p>}
      </div>

      <div className="flex gap-2 mt-4">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Adicionar serviço (nome como está na sua tabela)"
          className="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-lg text-sm"
        />
        <button
          onClick={() => run('new', async () => { await createAgendaService({ name: newName.trim() }); setNewName('') })}
          disabled={!!busy || newName.trim().length < 2}
          className="flex items-center gap-1 px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40"
        >
          <Plus className="w-4 h-4" /> Adicionar
        </button>
      </div>
    </div>
  )
}

// ───────── Agendamentos feitos pela IA ─────────

function LogTab() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { getTrinksLog().then(setRows).catch((e) => setError(e.message)) }, [])
  if (error) return <p className="text-sm text-red-600">{error}</p>
  if (!rows) return <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
  if (!rows.length) return <p className="text-sm text-gray-500">A IA ainda não marcou nada na Trinks.</p>
  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500">Tudo o que a IA marcou, remarcou ou cancelou na Trinks — com o que a cliente respondeu ao confirmar. A situação mostrada é a da última conferência com a Trinks.</p>
      {rows.map((r) => (
        <div key={r.id} className="border border-gray-200 rounded-xl p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-gray-800">{r.clientName}{r.clientPhone ? <span className="text-gray-400 font-normal"> · {r.clientPhone}</span> : null}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${r.status === 'cancelado' ? 'bg-gray-100 text-gray-500' : r.status === 'confirmado' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>{APPT_STATUS[r.status] ?? r.status}</span>
          </div>
          <div className="text-gray-600 mt-1">{r.service} — <b>{fmtDateTime(r.startDateTime)}</b>{r.professional ? ` · ${r.professional}` : ''}</div>
          {r.notes && <div className="text-xs text-gray-400 mt-1">{r.notes}</div>}
          <div className="text-xs text-gray-400 mt-1">Registrado em {fmtDateTime(r.createdAt)}{r.externalId ? ` · nº Trinks ${r.externalId}` : ''}</div>
        </div>
      ))}
    </div>
  )
}

// ───────── Configurações ─────────

function SettingsTab({ status, onChanged }) {
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (status && !form) setForm({ enabled: !!status.enabled, minNoticeHours: status.minNoticeHours ?? 2, bookingWindowDays: status.bookingWindowDays ?? 14, autoConfirm: !!status.autoConfirm })
  }, [status, form])

  if (!form) return <Loader2 className="w-5 h-5 animate-spin text-gray-400" />

  async function save() {
    setSaving(true); setError('')
    try {
      await updateAgendaSettings({ enabled: form.enabled, minNoticeHours: Number(form.minNoticeHours), bookingWindowDays: Number(form.bookingWindowDays) })
      if (status?.connected && form.autoConfirm !== !!status.autoConfirm) await setTrinksAutoConfirm(form.autoConfirm)
      setSaved(true); setTimeout(() => setSaved(false), 2000)
      onChanged()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <label className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer ${form.enabled ? 'border-pink-300 bg-pink-50' : 'border-gray-200'}`}>
        <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} className="mt-0.5 w-4 h-4 accent-pink-600" />
        <div>
          <div className="text-sm font-medium text-gray-800 flex items-center gap-1.5"><Bot className="w-4 h-4" /> A IA pode agendar sozinha pelo WhatsApp</div>
          <div className="text-xs text-gray-500 mt-0.5">Ela consulta os horários livres na Trinks e, depois que a cliente confirma o resumo, marca, remarca ou cancela lá. Só nos serviços aprovados.</div>
        </div>
      </label>

      <label className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer ${form.autoConfirm ? 'border-teal-300 bg-teal-50' : 'border-gray-200'}`}>
        <input type="checkbox" checked={form.autoConfirm} onChange={(e) => setForm({ ...form, autoConfirm: e.target.checked })} className="mt-0.5 w-4 h-4 accent-teal-600" />
        <div>
          <div className="text-sm font-medium text-gray-800">Agendamento da IA entra já confirmado na Trinks</div>
          <div className="text-xs text-gray-500 mt-0.5">Desligado (recomendado no começo): entra como "Aguardando confirmação" e a recepção confere e confirma na Trinks.</div>
        </div>
      </label>

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="text-sm text-gray-700">
          Antecedência mínima (horas)
          <input type="number" min="0" max="72" value={form.minNoticeHours} onChange={(e) => setForm({ ...form, minNoticeHours: e.target.value })} className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
        </label>
        <label className="text-sm text-gray-700">
          Agendar até quantos dias à frente
          <input type="number" min="1" max="90" value={form.bookingWindowDays} onChange={(e) => setForm({ ...form, bookingWindowDays: e.target.value })} className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="px-4 py-2 text-sm font-medium text-white bg-pink-600 rounded-lg hover:bg-pink-700 disabled:opacity-40">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Salvar'}
        </button>
        {saved && <span className="text-sm text-green-600">Salvo!</span>}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>

      {status && (
        <div className="text-xs text-gray-500 border-t border-gray-100 pt-3 space-y-1">
          <div>Consultas à Trinks neste mês: <b>{status.usage?.count ?? 0}</b> de {status.usage?.limit ?? 5000} (a IA para de agendar perto do limite e passa para a equipe).</div>
          <div>Serviços e profissionais copiados da Trinks em: {fmtDateTime(status.catalogSyncedAt)} (atualiza sozinho todo dia às 6h).</div>
          {status.lastError && <div className="text-red-600">Último problema com a Trinks ({fmtDateTime(status.lastErrorAt)}): {status.lastError}</div>}
        </div>
      )}
    </div>
  )
}

// ───────── Agenda antiga (CRM), só leitura ─────────

function OldAgendaTab() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const from = new Date(Date.now() - 60 * 86400000).toISOString()
    const to = new Date(Date.now() + 120 * 86400000).toISOString()
    listAgendaAppointments(from, to)
      .then((list) => setRows(list.filter((a) => !a.externalProvider).sort((a, b) => new Date(b.startDateTime) - new Date(a.startDateTime))))
      .catch((e) => setError(e.message))
  }, [])
  if (error) return <p className="text-sm text-red-600">{error}</p>
  if (!rows) return <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
  const future = rows.filter((a) => new Date(a.startDateTime) > new Date() && ['agendado', 'confirmado'].includes(a.status))
  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500">Agendamentos feitos na agenda do CRM antes da Trinks — só para consulta.</p>
      {future.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {future.length} agendamento(s) futuro(s) estão só aqui. Lance na Trinks para não perder o horário (o lembrete para a cliente continua saindo).
        </div>
      )}
      {rows.map((a) => (
        <div key={a.id} className="border border-gray-200 rounded-xl p-3 text-sm flex flex-wrap justify-between gap-2">
          <span><b>{fmtDateTime(a.startDateTime)}</b> — {a.clientName} · {a.service}</span>
          <span className="text-xs text-gray-500">{APPT_STATUS[a.status] ?? a.status}</span>
        </div>
      ))}
      {!rows.length && <p className="text-sm text-gray-500">Nenhum agendamento na agenda antiga.</p>}
    </div>
  )
}
