import { useState, useEffect } from 'react'
import { Bell, Flame, MessageSquareWarning, Clock, Info, CreditCard, RefreshCw, Calendar, Loader2 } from 'lucide-react'
import { authFetch } from '../services/api'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

// ── Follow-up automático ────────────────────────────────────────────────────

const FOLLOWUP_STAGES = [
  { key: 'novo_lead', label: 'Novo Lead', defaultValue: 1 },
  { key: 'lead_frio', label: 'Lead Frio', defaultValue: 4 },
  { key: 'lead_quente', label: 'Lead Quente', defaultValue: 1 },
]

const emptyFollowup = () => ({
  novo_lead:   { enabled: false, value: 1, unit: 'horas', message: '' },
  lead_frio:   { enabled: false, value: 4, unit: 'horas', message: '' },
  lead_quente: { enabled: false, value: 1, unit: 'horas', message: '' },
})

const minutesToVU = (min) => {
  if (min && min % 60 === 0) return { value: min / 60, unit: 'horas' }
  return { value: min || 1, unit: 'minutos' }
}

const followupToConfig = (state) => {
  const out = {}
  for (const { key } of FOLLOWUP_STAGES) {
    const s = state[key]
    const idleMinutes = s.unit === 'horas' ? Math.round(s.value * 60) : Math.round(s.value)
    out[key] = { enabled: !!s.enabled, idleMinutes: Math.max(1, idleMinutes || 1), message: (s.message ?? '').trim() }
  }
  return out
}

// ── Regras informativas ─────────────────────────────────────────────────────

const rules = [
  {
    icon: <RefreshCw className="w-5 h-5 text-teal-600" />,
    title: 'Follow-up Automático por Raia',
    bg: 'bg-teal-50 border-teal-200',
    headerBg: 'bg-teal-100',
    description: 'Leads que pararam de responder recebem uma única mensagem de reengajamento por raia. Configurável por raia com texto e tempo de ociosidade personalizados.',
    items: [
      { label: 'Gatilho',       color: 'bg-teal-50 text-teal-700 border-teal-200',    rule: 'Última mensagem foi nossa (IA ou operador) + lead sem responder pelo tempo configurado', reason: 'Não cobra leads que estão esperando nossa resposta.' },
      { label: 'Frequência',    color: 'bg-gray-50 text-gray-700 border-gray-200',    rule: 'Verificação a cada minuto',                                                             reason: 'Cron detecta leads ociosos e agenda o envio automaticamente.' },
      { label: 'Limite',        color: 'bg-amber-50 text-amber-700 border-amber-200', rule: '1 mensagem por raia, para sempre',                                                       reason: 'Mesmo que o lead volte à raia, não recebe novamente.' },
      { label: 'Raias cobertas', color: 'bg-purple-50 text-purple-700 border-purple-200', rule: 'Novo Lead · Lead Frio · Lead Quente',                                               reason: 'Cada raia tem sua própria mensagem e tempo configurados.' },
      { label: 'Pré-requisitos', color: 'bg-rose-50 text-rose-700 border-rose-200',   rule: 'IA ligada no lead + telefone preenchido',                                               reason: 'Leads com IA desativada (atendimento manual) não recebem.' },
      { label: 'Variável',      color: 'bg-blue-50 text-blue-700 border-blue-200',    rule: '{nome} → primeiro nome do lead',                                                        reason: 'Se o lead não tiver nome, o placeholder é removido automaticamente.' },
    ],
    extra: 'O envio é feito pelo mesmo mecanismo do follow-up manual. A mensagem aparece na conversa do lead e atualiza o Kanban em tempo real.',
  },
  {
    icon: <Calendar className="w-5 h-5 text-blue-600" />,
    title: 'Lembrete de Agendamento',
    bg: 'bg-blue-50 border-blue-200',
    headerBg: 'bg-blue-100',
    description: 'Clientes com agendamento no calendário interno recebem uma mensagem automática ~24h antes do horário marcado. Diferente do follow-up — aqui o cliente já tem hora confirmada.',
    items: [
      { label: 'Antecedência',   color: 'bg-blue-50 text-blue-700 border-blue-200',    rule: '~24h antes (janela 22h–26h)',                                         reason: 'Janela de 4h garante o envio mesmo se o cron atrasar 1 ciclo.' },
      { label: 'Frequência',     color: 'bg-gray-50 text-gray-700 border-gray-200',    rule: 'Verificação a cada hora',                                              reason: 'Suficiente para um lembrete — tolerância de horas é aceitável.' },
      { label: 'Limite',         color: 'bg-amber-50 text-amber-700 border-amber-200', rule: '1 lembrete por agendamento',                                           reason: 'reminder_sent_at impede reenvio mesmo dentro da janela.' },
      { label: 'Status válidos', color: 'bg-teal-50 text-teal-700 border-teal-200',    rule: 'agendado · confirmado',                                                reason: 'Cancelados e realizados são ignorados automaticamente.' },
      { label: 'Variáveis',      color: 'bg-purple-50 text-purple-700 border-purple-200', rule: '{nome} · {hora} (ex: 14:00) · {data} (ex: 28/06)',                  reason: 'Interpolados com os dados reais do agendamento.' },
    ],
    extra: 'Se a data já passou, o agendamento nunca entra na janela de busca — o lembrete só sai para eventos futuros.',
  },
  {
    icon: <Flame className="w-5 h-5 text-orange-500" />,
    title: 'Leads Esfriando',
    bg: 'bg-orange-50 border-orange-200',
    headerBg: 'bg-orange-100',
    description: 'Leads em raias ativas sem nenhuma mensagem trocada há mais do limite definido por raia.',
    items: [
      { label: 'Lead Quente',   color: 'bg-orange-50 text-orange-700 border-orange-200', rule: 'Alerta após 1 dia sem contato',  reason: 'Lead de alta intenção — esfria rápido.' },
      { label: 'Qualificando',  color: 'bg-purple-50 text-purple-700 border-purple-200', rule: 'Alerta após 2 dias sem contato',  reason: 'Ainda em processo de qualificação.' },
      { label: 'Lead Frio',     color: 'bg-cyan-50 text-cyan-700 border-cyan-200',       rule: 'Alerta após 3 dias sem contato',  reason: 'Já é uma raia morna — alerta só se completamente abandonado.' },
    ],
    extra: 'O tempo é medido a partir da última mensagem enviada ou recebida (lastMessageAt). Se nunca houve mensagem, conta desde a criação do lead.',
  },
  {
    icon: <MessageSquareWarning className="w-5 h-5 text-amber-600" />,
    title: 'Sem Resposta',
    bg: 'bg-amber-50 border-amber-200',
    headerBg: 'bg-amber-100',
    description: 'Leads em raias ativas onde a última mensagem foi enviada por nós (IA ou operador) e o lead ainda não respondeu.',
    items: [
      { label: 'Threshold',         color: 'bg-amber-50 text-amber-700 border-amber-200', rule: '1h sem resposta do lead',                              reason: 'Janela mínima de espera antes de considerar sem resposta.' },
      { label: 'Raias monitoradas', color: 'bg-gray-50 text-gray-700 border-gray-200',    rule: 'Novo Lead · Qualificando · Lead Quente · Lead Frio',  reason: 'Leads em Agendado e Perdido não são monitorados.' },
    ],
    extra: null,
  },
  {
    icon: <CreditCard className="w-5 h-5 text-teal-600" />,
    title: 'Lembrete de Vencimento',
    bg: 'bg-teal-50 border-teal-200',
    headerBg: 'bg-teal-100',
    description: 'Clientes cadastrados no painel admin recebem uma mensagem automática no WhatsApp 5 dias antes do vencimento mensal do plano.',
    items: [
      { label: 'Antecedência',   color: 'bg-teal-50 text-teal-700 border-teal-200',    rule: '5 dias antes do billingDay',                          reason: 'Ex: billingDay=10 → lembrete enviado no dia 5 às 9h.' },
      { label: 'Horário',        color: 'bg-gray-50 text-gray-700 border-gray-200',    rule: 'Todo dia às 9h (horário de Brasília)',                 reason: 'Cron roda diariamente; envia apenas no dia correto.' },
      { label: 'Pré-requisitos', color: 'bg-amber-50 text-amber-700 border-amber-200', rule: 'billingDay + billingPhone preenchidos no painel admin', reason: 'Clientes sem esses campos configurados são ignorados.' },
      { label: 'Remetente',      color: 'bg-purple-50 text-purple-700 border-purple-200', rule: 'Número do admin (via BILLING_SENDER_TENANT_ID no Railway)', reason: 'Instância uazapi configurada nas variáveis de ambiente.' },
    ],
    extra: 'O lembrete é enviado mesmo que o lead não esteja com a IA ativa. Clientes suspensos (isActive=false) não recebem o aviso.',
  },
  {
    icon: <Clock className="w-5 h-5 text-rose-500" />,
    title: 'Alerta Visual no Kanban',
    bg: 'bg-rose-50 border-rose-200',
    headerBg: 'bg-rose-100',
    description: 'Cards no Kanban mudam de cor quando um lead está sem resposta.',
    items: [
      { label: 'Amarelo', color: 'bg-yellow-50 text-yellow-700 border-yellow-300', rule: '1h a 3h sem resposta', reason: 'Atenção — lead aguardando retorno.' },
      { label: 'Vermelho', color: 'bg-red-50 text-red-700 border-red-300',         rule: '3h ou mais sem resposta', reason: 'Urgente — lead pode estar perdendo interesse.' },
    ],
    extra: 'O alerta só aparece quando a última mensagem foi enviada por nós (IA ou operador). Se o lead foi o último a falar, o card fica normal.',
  },
]

// ── Componente ───────────────────────────────────────────────────────────────

export default function AlertRulesPage() {
  const [autoFollowup, setAutoFollowup]   = useState(emptyFollowup())
  const [savingFollowup, setSavingFollowup] = useState(false)
  const [followupSaved, setFollowupSaved]   = useState(false)

  const [apptReminder, setApptReminder]   = useState({ enabled: false, message: '' })
  const [savingReminder, setSavingReminder] = useState(false)
  const [reminderSaved, setReminderSaved]   = useState(false)

  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const res  = await authFetch(`${API_URL}/instance/config`)
        const data = await res.json()

        const fu = data?.autoFollowupConfig
        if (fu && typeof fu === 'object') {
          const next = emptyFollowup()
          for (const { key } of FOLLOWUP_STAGES) {
            const r = fu[key]
            if (r && typeof r === 'object') {
              const { value, unit } = minutesToVU(r.idleMinutes)
              next[key] = { enabled: !!r.enabled, value, unit, message: r.message ?? '' }
            }
          }
          setAutoFollowup(next)
        }

        const ar = data?.appointmentReminder
        if (ar && typeof ar === 'object') {
          setApptReminder({ enabled: !!ar.enabled, message: ar.message ?? '' })
        }
      } catch {
        // sem instância configurada ainda — deixa defaults
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const saveFollowup = async () => {
    setSavingFollowup(true)
    setFollowupSaved(false)
    try {
      await authFetch(`${API_URL}/instance/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoFollowupConfig: followupToConfig(autoFollowup) }),
      })
      setFollowupSaved(true)
      setTimeout(() => setFollowupSaved(false), 2500)
    } finally {
      setSavingFollowup(false)
    }
  }

  const saveReminder = async () => {
    setSavingReminder(true)
    setReminderSaved(false)
    try {
      await authFetch(`${API_URL}/instance/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appointmentReminder: apptReminder }),
      })
      setReminderSaved(true)
      setTimeout(() => setReminderSaved(false), 2500)
    } finally {
      setSavingReminder(false)
    }
  }

  return (
    <div className="p-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-orange-400 to-red-500 flex items-center justify-center">
          <Bell className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-800">Regras de Alertas</h1>
          <p className="text-xs text-gray-500">Automações de mensagem e alertas do sistema</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-400 mb-6">
          <Loader2 className="w-4 h-4 animate-spin" />
          Carregando configurações...
        </div>
      ) : (
        <div className="space-y-4 mb-8">

          {/* Card: Follow-up automático */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center gap-2 mb-1">
              <RefreshCw className="w-4 h-4 text-teal-600" />
              <h2 className="text-sm font-semibold text-gray-800">Follow-up automático</h2>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              Leads que pararam de responder recebem <strong>uma única</strong> mensagem por raia.
              Use <code className="px-1 py-0.5 bg-gray-100 rounded text-teal-700">{'{nome}'}</code> para o primeiro nome.
              Verificação a cada minuto.
            </p>

            <div className="space-y-3">
              {FOLLOWUP_STAGES.map(({ key, label }) => {
                const s = autoFollowup[key]
                const set = (patch) => setAutoFollowup(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }))
                return (
                  <div key={key} className={`border rounded-lg p-4 transition ${s.enabled ? 'border-teal-200 bg-teal-50/30' : 'border-gray-200'}`}>
                    <div className="flex items-center justify-between mb-3">
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={s.enabled}
                          onChange={e => set({ enabled: e.target.checked })}
                          className="w-4 h-4 accent-teal-600"
                        />
                        <span className="text-sm font-medium text-gray-800">{label}</span>
                      </label>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-500">Após</span>
                        <input
                          type="number"
                          min="1"
                          value={s.value}
                          disabled={!s.enabled}
                          onChange={e => set({ value: Math.max(1, parseInt(e.target.value) || 1) })}
                          className="w-16 px-2 py-1 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-50 text-gray-800"
                        />
                        <select
                          value={s.unit}
                          disabled={!s.enabled}
                          onChange={e => set({ unit: e.target.value })}
                          className="px-2 py-1 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-50 text-gray-800 bg-white"
                        >
                          <option value="minutos">minutos</option>
                          <option value="horas">horas</option>
                        </select>
                        <span className="text-sm text-gray-500">sem resposta</span>
                      </div>
                    </div>
                    <textarea
                      value={s.message}
                      disabled={!s.enabled}
                      onChange={e => set({ message: e.target.value })}
                      placeholder={`Ex: Oi {nome}, tudo bem? Vi que você ficou com alguma dúvida...`}
                      rows={2}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none disabled:opacity-50 disabled:bg-gray-50 text-gray-800 placeholder-gray-400"
                    />
                  </div>
                )
              })}
            </div>

            <div className="flex items-center gap-3 mt-4">
              <button
                onClick={saveFollowup}
                disabled={savingFollowup}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-teal-700 rounded-lg hover:bg-teal-800 transition disabled:opacity-50"
              >
                {savingFollowup ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {savingFollowup ? 'Salvando...' : 'Salvar follow-up'}
              </button>
              {followupSaved && <span className="text-sm text-green-600 font-medium">✓ Salvo</span>}
            </div>
          </div>

          {/* Card: Lembrete de agendamento */}
          <div className="bg-white rounded-xl border border-blue-100 p-6">
            <div className="flex items-center gap-2 mb-1">
              <Calendar className="w-4 h-4 text-blue-600" />
              <h2 className="text-sm font-semibold text-gray-800">Lembrete de agendamento</h2>
            </div>
            <p className="text-sm text-gray-500 mb-1">
              Envia uma mensagem automática <strong>~24h antes</strong> do horário agendado no calendário.
              Diferente do follow-up — aqui o cliente <em>já tem hora marcada</em>.
            </p>
            <p className="text-xs text-gray-400 mb-4">
              Use{' '}
              <code className="px-1 py-0.5 bg-gray-100 rounded text-blue-700">{'{nome}'}</code>,{' '}
              <code className="px-1 py-0.5 bg-gray-100 rounded text-blue-700">{'{hora}'}</code> (ex: 14:00) e{' '}
              <code className="px-1 py-0.5 bg-gray-100 rounded text-blue-700">{'{data}'}</code> (ex: 28/06).
            </p>

            <div className={`border rounded-lg p-4 transition ${apptReminder.enabled ? 'border-blue-200 bg-blue-50/30' : 'border-gray-200'}`}>
              <label className="flex items-center gap-2 cursor-pointer select-none mb-3">
                <input
                  type="checkbox"
                  checked={apptReminder.enabled}
                  onChange={e => setApptReminder(prev => ({ ...prev, enabled: e.target.checked }))}
                  className="w-4 h-4 accent-blue-600"
                />
                <span className="text-sm font-medium text-gray-800">Ativar lembrete de agendamento</span>
              </label>
              <textarea
                value={apptReminder.message}
                disabled={!apptReminder.enabled}
                onChange={e => setApptReminder(prev => ({ ...prev, message: e.target.value }))}
                placeholder="Ex: Olá {nome}! Lembrando do seu agendamento amanhã às {hora}. Confirma?"
                rows={3}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none disabled:opacity-50 disabled:bg-gray-50 text-gray-800 placeholder-gray-400"
              />
            </div>

            <div className="flex items-center gap-3 mt-4">
              <button
                onClick={saveReminder}
                disabled={savingReminder}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
              >
                {savingReminder ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {savingReminder ? 'Salvando...' : 'Salvar lembrete'}
              </button>
              {reminderSaved && <span className="text-sm text-green-600 font-medium">✓ Salvo</span>}
            </div>
          </div>

        </div>
      )}

      {/* Separador */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex-1 h-px bg-gray-200" />
        <span className="text-xs text-gray-400 uppercase tracking-wide">Alertas do sistema</span>
        <div className="flex-1 h-px bg-gray-200" />
      </div>

      {/* Cards informativos */}
      <div className="space-y-6">
        {rules.map((rule, i) => (
          <div key={i} className={`rounded-2xl border ${rule.bg} overflow-hidden`}>
            <div className={`${rule.headerBg} px-5 py-4 flex items-center gap-2`}>
              {rule.icon}
              <h2 className="text-sm font-bold text-gray-800">{rule.title}</h2>
            </div>
            <div className="px-5 py-4 space-y-4">
              <p className="text-sm text-gray-600">{rule.description}</p>
              <div className="space-y-2">
                {rule.items.map((item, j) => (
                  <div key={j} className="bg-white rounded-xl border border-white/80 p-3 flex items-start gap-3">
                    <span className={`text-xs px-2 py-1 rounded-md border whitespace-nowrap shrink-0 ${item.color}`}>
                      {item.label}
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-gray-800">{item.rule}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{item.reason}</p>
                    </div>
                  </div>
                ))}
              </div>
              {rule.extra && (
                <div className="flex items-start gap-2 bg-white/60 rounded-lg px-3 py-2">
                  <Info className="w-3.5 h-3.5 text-gray-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-gray-500">{rule.extra}</p>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
