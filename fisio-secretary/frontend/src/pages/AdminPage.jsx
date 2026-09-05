import { useState, useEffect, useRef } from 'react'
import { Users, Plus, Power, PowerOff, Loader2, X, AlertCircle, Wifi, WifiOff, Check, Calendar, KeyRound, BarChart2, Trash2, CreditCard, Send, Link2, Download, Copy, MessageSquare, DollarSign, RefreshCw, TrendingUp, Eye, Wrench } from 'lucide-react'
import { QRCodeCanvas } from 'qrcode.react'
import { getClients, createClient, setClientActive, updateClientBilling, resetClientPassword, getTokenUsage, deleteClient, clearClientPastDue, resendMonthlyPix, getBillingEvents, getAdminCheckoutSettings, updateAdminCheckoutSettings, getAdminOnboardingSettings, updateAdminOnboardingSettings, createOnboardingTestGroup, getFinanceOverview, syncClientOrigins, createToolExpense, updateToolExpense, deleteToolExpense } from '../services/api'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import ClientDrawer from '../components/ClientDrawer'

// Link público do checkout — mesmo formulário pra qualquer cliente, sem dado pré-preenchido.
// Usado pra gerar o QR Code exibido/baixado na aba Checkout (ex: pra mostrar numa live).
const CHECKOUT_URL = 'https://app.converthair.com.br/checkout'

function daysUntil(dateStr) {
  if (!dateStr) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const d = new Date(dateStr); d.setHours(0, 0, 0, 0)
  return Math.round((d - today) / 86400000)
}

// Data de hoje no fuso de Brasília ('YYYY-MM-DD'). toISOString() usa UTC e adianta o dia à noite.
const brToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())

// --- Helpers da aba Financeiro ---

const fmtBRL = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// Churn manual tem prioridade sobre o status derivado — "perdido" = assinatura cancelada
// OU conta suspensa; "em atraso" cobre os estados de cobrança pendente (PIX expirado também).
function statusLabel(c) {
  if (c.churned_at) return 'churn'
  if (c.plan_status === 'canceled' || !c.is_active) return 'perdido'
  if (['past_due', 'expired', 'pending'].includes(c.plan_status)) return 'em atraso'
  return 'ativo'
}

function filterFinanceClients(clients, filter) {
  if (filter === 'all') return clients
  if (filter === 'active') return clients.filter(c => statusLabel(c) === 'ativo')
  if (filter === 'past_due') return clients.filter(c => statusLabel(c) === 'em atraso')
  if (filter === 'churn') return clients.filter(c => statusLabel(c) === 'churn')
  return clients.filter(c => statusLabel(c) === 'perdido')
}

// Normaliza a linha (do /admin/finance/overview, snake_case) pro formato que o ClientDrawer
// espera (camelCase) — os dois endpoints não compartilham a mesma convenção de nomes.
function financeRowToDrawerClient(c) {
  return { ...c, isTest: false, churnedAt: c.churned_at, churnReason: c.churn_reason }
}

// Cor por origem: pago (facebook/ctwa) x base (whatsapp/sdr) x resto.
function originBadgeClass(source) {
  const s = String(source).toLowerCase()
  if (s.includes('facebook') || s.includes('instagram') || s.includes('ctwa')) return 'bg-violet-100 text-violet-700'
  if (s.includes('whatsapp') || s.includes('organico') || s.includes('sdr')) return 'bg-emerald-100 text-emerald-700'
  return 'bg-gray-100 text-gray-600'
}

// Google Form de onboarding (agente de CS) — link pré-preenchido por tenant via campo oculto
// "Código interno". Ver agente-suporte-cs.md e backend/src/forms/forms.controller.ts.
const ONBOARDING_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSeY2IZLnw5Cw5FbRI2scRipQFT-qHrnUt3ujBfdoTWgUETiVw/viewform'
const ONBOARDING_FORM_ENTRY = 'entry.995908210'
const buildOnboardingLink = (tenantId) => `${ONBOARDING_FORM_URL}?usp=pp_url&${ONBOARDING_FORM_ENTRY}=${tenantId}`

export default function AdminPage() {
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', password: '', billingPhone: '' })
  const [created, setCreated] = useState(null)
  const [resetModal, setResetModal] = useState(null) // { id, name }
  const [newPassword, setNewPassword] = useState('')
  const [resetting, setResetting] = useState(false)
  const [deleteModal, setDeleteModal] = useState(null) // { id, name }
  const [deleting, setDeleting] = useState(false)
  const [activeTab, setActiveTab] = useState('clients') // 'clients' | 'usage'
  const [usage, setUsage] = useState([])
  const today = brToday()
  const [usageFrom, setUsageFrom] = useState(today)
  const [usageTo, setUsageTo] = useState(today)
  const [loadingUsage, setLoadingUsage] = useState(false)
  const [checkoutSettings, setCheckoutSettings] = useState(null)
  const [checkoutForm, setCheckoutForm] = useState(null)
  const [loadingCheckout, setLoadingCheckout] = useState(false)
  const [savingCheckout, setSavingCheckout] = useState(false)
  const [checkoutSaved, setCheckoutSaved] = useState(false)
  const [pixSendingId, setPixSendingId] = useState(null)
  const [billingEvents, setBillingEvents] = useState([])
  const [loadingBilling, setLoadingBilling] = useState(false)
  const [billingFilter, setBillingFilter] = useState('')
  const [linkCopied, setLinkCopied] = useState(false)
  const qrCanvasRef = useRef(null)
  const [onboardingForm, setOnboardingForm] = useState(null)
  const [loadingOnboarding, setLoadingOnboarding] = useState(false)
  const [savingOnboarding, setSavingOnboarding] = useState(false)
  const [onboardingSaved, setOnboardingSaved] = useState(false)
  const [testingGroup, setTestingGroup] = useState(false)
  const [testGroupResult, setTestGroupResult] = useState('')
  const [newTeamPhone, setNewTeamPhone] = useState('')
  const [finance, setFinance] = useState(null)
  const [loadingFinance, setLoadingFinance] = useState(false)
  const [financeStatusFilter, setFinanceStatusFilter] = useState('all')
  const [syncingOrigins, setSyncingOrigins] = useState(false)
  const [syncResult, setSyncResult] = useState('')
  const [newTool, setNewTool] = useState({ name: '', monthlyCost: '', billingDay: '' })
  const [savingTool, setSavingTool] = useState(false)
  const [drawerClient, setDrawerClient] = useState(null)

  const load = async () => {
    try {
      setClients(await getClients())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const loadUsage = async (from, to) => {
    setLoadingUsage(true)
    try { setUsage(await getTokenUsage(from, to)) } catch (e) { setError(e.message) } finally { setLoadingUsage(false) }
  }

  const setShortcut = (days) => {
    // Ancora ao meio-dia da data de Brasília p/ evitar deslocamento de fuso ao subtrair dias.
    const anchor = new Date(brToday() + 'T12:00:00')
    const f = new Date(anchor); f.setDate(f.getDate() - (days - 1))
    const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    setUsageFrom(fmt(f)); setUsageTo(brToday())
  }

  useEffect(() => { if (activeTab === 'usage') loadUsage(usageFrom, usageTo) }, [activeTab, usageFrom, usageTo])

  const loadCheckoutSettings = async () => {
    setLoadingCheckout(true)
    try {
      const s = await getAdminCheckoutSettings()
      setCheckoutSettings(s)
      setCheckoutForm({
        pixEnabled: s.pixEnabled,
        cardEnabled: s.cardEnabled,
        implantacaoEnabled: s.implantacaoEnabled,
        planoEnabled: s.planoEnabled,
        implantacaoPrice: Number(s.implantacaoPrice),
        planoPrice: Number(s.planoPrice),
      })
    } catch (e) { setError(e.message) } finally { setLoadingCheckout(false) }
  }

  useEffect(() => { if (activeTab === 'checkout' && !checkoutSettings) loadCheckoutSettings() }, [activeTab])

  async function loadBillingEvents(tenantId) {
    setLoadingBilling(true)
    try {
      setBillingEvents(await getBillingEvents(tenantId || undefined))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoadingBilling(false)
    }
  }
  useEffect(() => { if (activeTab === 'billing') loadBillingEvents(billingFilter) }, [activeTab, billingFilter])

  async function handleSaveCheckout(e) {
    e.preventDefault()
    setError('')
    if (!checkoutForm.planoEnabled && !checkoutForm.implantacaoEnabled) {
      setError('Pelo menos um plano (Mensal ou Implantação) precisa ficar ligado.')
      return
    }
    setSavingCheckout(true); setCheckoutSaved(false)
    try {
      const updated = await updateAdminCheckoutSettings({
        ...checkoutForm,
        implantacaoPrice: Number(checkoutForm.implantacaoPrice),
        planoPrice: Number(checkoutForm.planoPrice),
      })
      setCheckoutSettings(updated)
      setCheckoutSaved(true)
      setTimeout(() => setCheckoutSaved(false), 2500)
    } catch (e) { setError(e.message) } finally { setSavingCheckout(false) }
  }

  // --- Financeiro (mapeamento de clientes, receita, custo, margem) ---

  const loadFinance = async () => {
    setLoadingFinance(true)
    try { setFinance(await getFinanceOverview()) } catch (e) { setError(e.message) } finally { setLoadingFinance(false) }
  }

  useEffect(() => { if (activeTab === 'finance' && !finance) loadFinance() }, [activeTab])

  async function handleAddTool(e) {
    e.preventDefault()
    if (!newTool.name.trim() || !newTool.monthlyCost) return
    setSavingTool(true)
    try {
      await createToolExpense(newTool.name.trim(), Number(newTool.monthlyCost), newTool.billingDay ? Number(newTool.billingDay) : null)
      setNewTool({ name: '', monthlyCost: '', billingDay: '' })
      await loadFinance()
    } catch (e) { setError(e.message) } finally { setSavingTool(false) }
  }

  async function handleUpdateTool(id, field, value) {
    try {
      await updateToolExpense(id, { [field]: value })
      await loadFinance()
    } catch (e) { setError(e.message) }
  }

  async function handleDeleteTool(id) {
    try {
      await deleteToolExpense(id)
      await loadFinance()
    } catch (e) { setError(e.message) }
  }

  async function handleSyncOrigins() {
    setSyncingOrigins(true); setSyncResult(''); setError('')
    try {
      const res = await syncClientOrigins()
      setSyncResult(`${res.updated} origem(ns) preenchida(s) de ${res.checked} cliente(s) sem origem.`)
      await loadFinance()
    } catch (e) { setError(e.message) } finally { setSyncingOrigins(false) }
  }

  // --- Onboarding (grupo automático pós-pagamento) ---

  const loadOnboarding = async () => {
    setLoadingOnboarding(true)
    try {
      const s = await getAdminOnboardingSettings()
      setOnboardingForm({
        groupEnabled: s.groupEnabled,
        teamPhones: s.teamPhones ?? [],
        welcomeMessage: s.welcomeMessage ?? '',
        formMessageEnabled: s.formMessageEnabled,
        formMessage: s.formMessage ?? '',
        formDelayMinutes: s.formDelayMinutes ?? 60,
        formUrl: s.formUrl ?? '',
        formEntryField: s.formEntryField ?? '',
      })
    } catch (e) { setError(e.message) } finally { setLoadingOnboarding(false) }
  }

  useEffect(() => { if (activeTab === 'onboarding' && !onboardingForm) loadOnboarding() }, [activeTab])

  async function handleSaveOnboarding(e) {
    e.preventDefault()
    setError('')
    setSavingOnboarding(true); setOnboardingSaved(false)
    try {
      const updated = await updateAdminOnboardingSettings({
        ...onboardingForm,
        formDelayMinutes: Number(onboardingForm.formDelayMinutes),
      })
      setOnboardingForm({ ...onboardingForm, teamPhones: updated.teamPhones ?? [] })
      setOnboardingSaved(true)
      setTimeout(() => setOnboardingSaved(false), 2500)
    } catch (e) { setError(e.message) } finally { setSavingOnboarding(false) }
  }

  function addTeamPhone() {
    const digits = newTeamPhone.replace(/\D/g, '')
    if (digits.length < 10) return
    if (onboardingForm.teamPhones.includes(digits)) { setNewTeamPhone(''); return }
    setOnboardingForm({ ...onboardingForm, teamPhones: [...onboardingForm.teamPhones, digits] })
    setNewTeamPhone('')
  }

  async function handleTestGroup() {
    setTestingGroup(true); setTestGroupResult(''); setError('')
    try {
      const res = await createOnboardingTestGroup()
      setTestGroupResult(res.jid
        ? `Grupo "${res.name}" criado com ${res.participants.length} participante(s). Confere no WhatsApp.`
        : `A API não devolveu o identificador do grupo — confere no WhatsApp mesmo assim.`)
    } catch (e) { setError(e.message) } finally { setTestingGroup(false) }
  }

  function copyCheckoutLink() {
    navigator.clipboard.writeText(CHECKOUT_URL)
    setLinkCopied(true)
    setTimeout(() => setLinkCopied(false), 2000)
  }

  function downloadQrCode() {
    const canvas = qrCanvasRef.current
    if (!canvas) return
    const link = document.createElement('a')
    link.download = 'qrcode-checkout-converthair.png'
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  async function handleCreate(e) {
    e.preventDefault()
    setError(''); setCreating(true)
    try {
      await createClient(form)
      setCreated({ email: form.email, password: form.password })
      setForm({ name: '', email: '', password: '', billingPhone: '' })
      setShowCreate(false)
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteClient(deleteModal.id)
      setDeleteModal(null)
      await load()
    } catch (e) {
      setError(e.message)
      setDeleteModal(null)
    } finally {
      setDeleting(false)
    }
  }

  async function toggleActive(c) {
    await setClientActive(c.id, !c.isActive)
    await load()
  }

  async function handleResendPix(c) {
    if (!confirm(`Reenviar o PIX mensal agora para ${c.displayName || 'este cliente'} (${c.planValue ? `R$ ${c.planValue}` : 'valor padrão'})?`)) return
    setPixSendingId(c.id)
    try {
      await resendMonthlyPix(c.id)
      alert('PIX enviado (WhatsApp + e-mail).')
    } catch (e) {
      alert(`Falha ao enviar: ${e.message}`)
    } finally {
      setPixSendingId(null)
    }
  }

  async function handleReset(e) {
    e.preventDefault()
    setError(''); setResetting(true)
    try {
      await resetClientPassword(resetModal.id, newPassword)
      setResetModal(null); setNewPassword('')
    } catch (e) { setError(e.message) }
    finally { setResetting(false) }
  }

  // Prioriza nextPaymentDate (data real gravada no pagamento/renovação) — só recai pro
  // cálculo "próxima ocorrência do dia X" em clientes antigos que nunca tiveram esse
  // campo preenchido. Sem isso, um cliente que ACABOU de assinar hoje aparecia com
  // "vence hoje" (billingDay bate com o dia de hoje só porque foi setado na assinatura).
  function nextDueDate(client) {
    if (client?.nextPaymentDate) {
      const d = new Date(client.nextPaymentDate)
      d.setHours(0, 0, 0, 0)
      return d
    }
    const billingDay = client?.billingDay
    if (!billingDay) return null
    const now = new Date(); now.setHours(0, 0, 0, 0)
    const y = now.getFullYear(), m = now.getMonth()
    const lastDay = new Date(y, m + 1, 0).getDate()
    const day = Math.min(billingDay, lastDay)
    const due = new Date(y, m, day)
    if (due < now) { // já passou esse mês → próximo mês
      const lastDayNext = new Date(y, m + 2, 0).getDate()
      return new Date(y, m + 1, Math.min(billingDay, lastDayNext))
    }
    return due
  }

  function daysUntilDay(client) {
    const due = nextDueDate(client)
    if (!due) return null
    const today = new Date(); today.setHours(0, 0, 0, 0)
    return Math.round((due - today) / 86400000)
  }

  if (loading) {
    return <div className="p-8 text-gray-400 text-sm">Carregando clientes...</div>
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => setActiveTab('clients')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition ${activeTab === 'clients' ? 'bg-teal-700 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
            <Users className="w-4 h-4" /> Clientes
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${activeTab === 'clients' ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-500'}`}>{clients.length}</span>
          </button>
          <button onClick={() => setActiveTab('usage')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition ${activeTab === 'usage' ? 'bg-teal-700 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
            <BarChart2 className="w-4 h-4" /> Uso de Tokens
          </button>
          <button onClick={() => setActiveTab('checkout')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition ${activeTab === 'checkout' ? 'bg-teal-700 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
            <CreditCard className="w-4 h-4" /> Checkout
          </button>
          <button onClick={() => setActiveTab('billing')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition ${activeTab === 'billing' ? 'bg-teal-700 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
            <Send className="w-4 h-4" /> Cobranças
          </button>
          <button onClick={() => setActiveTab('onboarding')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition ${activeTab === 'onboarding' ? 'bg-teal-700 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
            <MessageSquare className="w-4 h-4" /> Onboarding
          </button>
          <button onClick={() => setActiveTab('finance')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition ${activeTab === 'finance' ? 'bg-teal-700 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
            <DollarSign className="w-4 h-4" /> Financeiro
          </button>
        </div>
        {activeTab === 'clients' && (
          <button
            onClick={() => { setShowCreate(true); setCreated(null) }}
            className="flex items-center gap-2 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
          >
            <Plus className="w-4 h-4" /> Novo cliente
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-3 rounded-xl mb-4 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {/* Aba: Uso de Tokens */}
      {activeTab === 'usage' && (
        <div>
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <button onClick={() => setShortcut(7)}
              className="px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-200 text-gray-500 hover:bg-gray-50 transition">
              7 dias
            </button>
            <button onClick={() => setShortcut(30)}
              className="px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-200 text-gray-500 hover:bg-gray-50 transition">
              30 dias
            </button>
            <div className="flex items-center gap-2 ml-2">
              <input type="date" value={usageFrom} max={usageTo}
                onChange={e => setUsageFrom(e.target.value)}
                className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-teal-500" />
              <span className="text-gray-400 text-sm">até</span>
              <input type="date" value={usageTo} min={usageFrom} max={today}
                onChange={e => setUsageTo(e.target.value)}
                className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
            {loadingUsage && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
          </div>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Cliente</th>
                  <th className="px-4 py-3 text-right">Input</th>
                  <th className="px-4 py-3 text-right">Cache hit</th>
                  <th className="px-4 py-3 text-right">Output</th>
                  <th className="px-4 py-3 text-right">Custo (USD)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {usage.length === 0 && !loadingUsage && (
                  <tr><td colSpan={5} className="p-8 text-center text-gray-400">Nenhum dado para o período.</td></tr>
                )}
                {Object.values(
                  usage.reduce((acc, row) => {
                    const key = row.tenant_id
                    if (!acc[key]) acc[key] = { tenant_name: row.tenant_name?.trim() || row.tenant_id?.slice(0, 8), input: 0, cached: 0, output: 0, cost: 0 }
                    acc[key].input += Number(row.input_tokens)
                    acc[key].cached += Number(row.cached_tokens)
                    acc[key].output += Number(row.output_tokens)
                    acc[key].cost += Number(row.cost_usd)
                    return acc
                  }, {})
                ).sort((a, b) => b.cost - a.cost).map((row, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-700">{row.tenant_name}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{row.input.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-green-600">{row.cached.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{row.output.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-mono text-gray-800">${row.cost.toFixed(5)}</td>
                  </tr>
                ))}
              </tbody>
              {usage.length > 0 && (
                <tfoot className="bg-gray-50 text-xs font-semibold text-gray-700">
                  <tr>
                    <td colSpan={4} className="px-4 py-3 text-right">Total — {usageFrom === usageTo ? usageFrom : `${usageFrom} → ${usageTo}`}</td>
                    <td className="px-4 py-3 text-right font-mono">${usage.reduce((s, r) => s + Number(r.cost_usd), 0).toFixed(5)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {/* Aba: Checkout */}
      {activeTab === 'checkout' && (
        <div className="max-w-lg space-y-5">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-1">Link e QR Code de pagamento</h3>
            <p className="text-xs text-gray-400 mb-4">Use pra divulgar numa live ou compartilhar direto — leva pro checkout público com os planos/valores configurados abaixo.</p>
            <div className="flex items-center gap-2 mb-4">
              <input readOnly value={CHECKOUT_URL}
                className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 bg-gray-50 focus:outline-none" />
              <button onClick={copyCheckoutLink}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white transition shrink-0">
                <Copy className="w-3.5 h-3.5" /> {linkCopied ? 'Copiado!' : 'Copiar'}
              </button>
            </div>
            <div className="flex flex-col items-center gap-3 p-4 bg-gray-50 rounded-lg">
              <QRCodeCanvas ref={qrCanvasRef} value={CHECKOUT_URL} size={200} level="M" marginSize={2} />
              <button onClick={downloadQrCode}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg text-teal-700 hover:bg-teal-50 transition">
                <Download className="w-3.5 h-3.5" /> Baixar QR Code
              </button>
            </div>
          </div>

          {loadingCheckout && !checkoutForm && (
            <div className="flex items-center gap-2 text-gray-400 text-sm py-8"><Loader2 className="w-4 h-4 animate-spin" /> Carregando configurações...</div>
          )}
          {checkoutForm && (
            <form onSubmit={handleSaveCheckout} className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-1">Planos disponíveis</h3>
                <p className="text-xs text-gray-400 mb-3">
                  Se só um estiver ligado, o checkout mostra direto essa opção (sem seletor).
                </p>
                <div className="space-y-2">
                  <label className="flex items-center justify-between px-3 py-2.5 border border-gray-200 rounded-lg">
                    <span className="text-sm text-gray-700">Plano Mensal</span>
                    <input type="checkbox" checked={checkoutForm.planoEnabled}
                      onChange={e => setCheckoutForm({ ...checkoutForm, planoEnabled: e.target.checked })}
                      className="w-4 h-4 accent-teal-700" />
                  </label>
                  <label className="flex items-center justify-between px-3 py-2.5 border border-gray-200 rounded-lg">
                    <span className="text-sm text-gray-700">Implantação (taxa única)</span>
                    <input type="checkbox" checked={checkoutForm.implantacaoEnabled}
                      onChange={e => setCheckoutForm({ ...checkoutForm, implantacaoEnabled: e.target.checked })}
                      className="w-4 h-4 accent-teal-700" />
                  </label>
                </div>
                {!checkoutForm.planoEnabled && !checkoutForm.implantacaoEnabled && (
                  <p className="text-xs text-red-500 mt-2">Pelo menos um dos dois precisa ficar ligado.</p>
                )}
              </div>

              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-1">Formas de pagamento (Plano Mensal)</h3>
                <p className="text-xs text-gray-400 mb-3">A implantação é sempre via PIX.</p>
                <div className="space-y-2">
                  <label className="flex items-center justify-between px-3 py-2.5 border border-gray-200 rounded-lg">
                    <span className="text-sm text-gray-700">PIX</span>
                    <input type="checkbox" checked={checkoutForm.pixEnabled}
                      onChange={e => setCheckoutForm({ ...checkoutForm, pixEnabled: e.target.checked })}
                      className="w-4 h-4 accent-teal-700" />
                  </label>
                  <label className="flex items-center justify-between px-3 py-2.5 border border-gray-200 rounded-lg">
                    <span className="text-sm text-gray-700">Cartão</span>
                    <input type="checkbox" checked={checkoutForm.cardEnabled}
                      onChange={e => setCheckoutForm({ ...checkoutForm, cardEnabled: e.target.checked })}
                      className="w-4 h-4 accent-teal-700" />
                  </label>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Valores</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Plano mensal (R$)</label>
                    <input type="number" min="0.01" step="0.01" value={checkoutForm.planoPrice}
                      onChange={e => setCheckoutForm({ ...checkoutForm, planoPrice: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Implantação (R$)</label>
                    <input type="number" min="0.01" step="0.01" value={checkoutForm.implantacaoPrice}
                      onChange={e => setCheckoutForm({ ...checkoutForm, implantacaoPrice: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button type="submit" disabled={savingCheckout}
                  className="flex items-center gap-2 bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition">
                  {savingCheckout ? <><Loader2 className="w-4 h-4 animate-spin" /> Salvando...</> : 'Salvar'}
                </button>
                {checkoutSaved && (
                  <span className="flex items-center gap-1 text-green-600 text-sm"><Check className="w-4 h-4" /> Salvo</span>
                )}
              </div>
            </form>
          )}
        </div>
      )}

      {/* Aba: Financeiro (mapeamento de clientes, receita, custo de token e margem) */}
      {activeTab === 'finance' && (
        <div>
          {loadingFinance || !finance ? (
            <div className="flex items-center gap-2 text-gray-400 text-sm py-8">
              <Loader2 className="w-4 h-4 animate-spin" /> Carregando financeiro...
            </div>
          ) : (
            <div className="space-y-5">
              {/* KPIs */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <p className="text-xs text-gray-400 mb-1">MRR (recorrente/mês)</p>
                  <p className="text-2xl font-bold text-gray-800 tabular-nums">{fmtBRL(finance.kpis.mrr)}</p>
                  <p className="text-xs text-gray-400 mt-1">{finance.kpis.activeCount} cliente(s) ativo(s)</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <p className="text-xs text-gray-400 mb-1">Receita acumulada</p>
                  <p className="text-2xl font-bold text-gray-800 tabular-nums">{fmtBRL(finance.kpis.revenueAllTime)}</p>
                  <p className="text-xs text-gray-400 mt-1">{fmtBRL(finance.kpis.revenueThisMonth)} neste mês</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <p className="text-xs text-gray-400 mb-1">Margem do mês</p>
                  <p className={`text-2xl font-bold tabular-nums ${finance.kpis.marginThisMonth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {fmtBRL(finance.kpis.marginThisMonth)}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">IA: {fmtBRL(finance.kpis.tokenCostPeriodBrl)} · ferramentas: {fmtBRL(finance.kpis.toolsCostMonthly)}</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <p className="text-xs text-gray-400 mb-1">Clientes</p>
                  <p className="text-2xl font-bold text-gray-800 tabular-nums">
                    {finance.kpis.activeCount}<span className="text-base text-gray-400 font-normal"> / {finance.kpis.totalCount}</span>
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {finance.kpis.pastDueCount} em atraso · {finance.kpis.lostCount} perdido(s)
                  </p>
                </div>
                {finance.kpis.churnCount > 0 && (
                  <div className="bg-white rounded-xl border border-purple-200 p-4">
                    <p className="text-xs text-gray-400 mb-1">Churn</p>
                    <p className="text-2xl font-bold text-purple-700 tabular-nums">{finance.kpis.churnCount}</p>
                    <p className="text-xs text-gray-400 mt-1">{fmtBRL(finance.kpis.churnRevenueTotal)} gerados antes de sair</p>
                  </div>
                )}
              </div>

              {/* Receita por mês */}
              {finance.monthly?.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-teal-600" /> Receita por mês
                  </h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={finance.monthly}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v) => fmtBRL(v)} />
                      <Bar dataKey="total" fill="#0f766e" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Filtro + sync */}
              <div className="flex items-center gap-2 flex-wrap">
                <select value={financeStatusFilter} onChange={e => setFinanceStatusFilter(e.target.value)}
                  className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-500">
                  <option value="all">Todos os clientes</option>
                  <option value="active">Ativos</option>
                  <option value="past_due">Em atraso</option>
                  <option value="churn">Churn</option>
                  <option value="lost">Perdidos</option>
                </select>
                <button onClick={loadFinance} className="text-xs text-teal-600 hover:underline">Atualizar</button>
                <button onClick={handleSyncOrigins} disabled={syncingOrigins}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-60 transition ml-auto"
                  title="Preenche a origem cruzando por telefone com o convertHairCRM">
                  {syncingOrigins ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  Atualizar origens
                </button>
              </div>
              {syncResult && <p className="text-xs text-green-600">{syncResult}</p>}

              {/* Tabela de clientes */}
              <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-medium">Cliente</th>
                      <th className="text-left px-4 py-2.5 font-medium">Origem</th>
                      <th className="text-right px-4 py-2.5 font-medium">Plano</th>
                      <th className="text-left px-4 py-2.5 font-medium">Vencimento</th>
                      <th className="text-right px-4 py-2.5 font-medium">Receita gerada</th>
                      <th className="text-right px-4 py-2.5 font-medium">Custo IA</th>
                      <th className="text-right px-4 py-2.5 font-medium">Margem</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filterFinanceClients(finance.clients, financeStatusFilter).length === 0 ? (
                      <tr><td colSpan={7} className="text-center text-gray-400 py-8">Nenhum cliente neste filtro.</td></tr>
                    ) : filterFinanceClients(finance.clients, financeStatusFilter).map(c => {
                      const dleft = daysUntil(c.next_payment_date)
                      const label = statusLabel(c)
                      return (
                        <tr key={c.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setDrawerClient(financeRowToDrawerClient(c))}>
                          <td className="px-4 py-2.5">
                            <div className="font-medium text-gray-800">{c.name}</div>
                            <div className="text-xs text-gray-400">
                              cliente desde {c.client_since ? new Date(c.client_since + 'T12:00:00').toLocaleDateString('pt-BR') : '—'}
                              {c.payment_method && c.payment_method !== 'manual' && ` · ${c.payment_method === 'card' ? '💳 cartão' : '⚡ pix'}`}
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            {c.origin_source ? (
                              <>
                                <span className={`text-xs px-1.5 py-0.5 rounded-full ${originBadgeClass(c.origin_source)}`}>{c.origin_source}</span>
                                {c.origin_campaign && <div className="text-xs text-gray-400 mt-0.5 max-w-[180px] truncate" title={c.origin_campaign}>{c.origin_campaign}</div>}
                              </>
                            ) : <span className="text-xs text-gray-300">—</span>}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{fmtBRL(c.plan_value)}</td>
                          <td className="px-4 py-2.5">
                            {c.next_payment_date ? (
                              <span className={`text-xs ${dleft !== null && dleft < 0 ? 'text-red-600 font-medium' : dleft !== null && dleft <= 3 ? 'text-amber-600 font-medium' : 'text-gray-500'}`}>
                                {new Date(c.next_payment_date + 'T12:00:00').toLocaleDateString('pt-BR')}
                                {dleft !== null && (dleft < 0 ? ` (${Math.abs(dleft)}d atrasado)` : dleft === 0 ? ' (hoje)' : dleft <= 3 ? ` (${dleft}d)` : '')}
                              </span>
                            ) : <span className="text-xs text-gray-300">—</span>}
                            <div className={`text-xs mt-0.5 ${label === 'churn' ? 'text-purple-600 font-medium' : 'text-gray-400'}`}>{label}</div>
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-medium text-gray-800">{fmtBRL(c.revenue_total)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">{fmtBRL(c.token_cost_brl)}</td>
                          <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${c.margin_brl >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmtBRL(c.margin_brl)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Quem mais custa */}
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-1">Quem mais custa em IA</h3>
                <p className="text-xs text-gray-400 mb-3">Consumo de token no período ({finance.period.from} a {finance.period.to}) · dólar a R$ {finance.period.usdBrl}</p>
                <div className="divide-y divide-gray-100">
                  {[...finance.clients].sort((a, b) => b.token_cost_brl - a.token_cost_brl).slice(0, 10).filter(c => c.token_cost_brl > 0).map((c, i) => (
                    <div key={c.id} className="flex items-center justify-between py-2">
                      <span className="text-sm text-gray-700"><span className="text-gray-300 mr-2 tabular-nums">{i + 1}.</span>{c.name}</span>
                      <span className="text-sm tabular-nums text-gray-600">
                        {fmtBRL(c.token_cost_brl)}
                        <span className="text-xs text-gray-400 ml-2">({((c.token_cost_brl / (c.plan_value || 1)) * 100).toFixed(1)}% do plano)</span>
                      </span>
                    </div>
                  ))}
                  {finance.clients.every(c => c.token_cost_brl <= 0) && (
                    <p className="text-sm text-gray-400 py-3">Nenhum consumo registrado no período.</p>
                  )}
                </div>
              </div>

              {/* Ferramentas & Custos (Supabase, uazapi, etc.) */}
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-2">
                  <Wrench className="w-4 h-4 text-teal-600" /> Ferramentas &amp; custos
                </h3>
                <p className="text-xs text-gray-400 mb-3">
                  Custo fixo mensal da operação (Supabase, uazapi, etc.) — total de {fmtBRL(finance.kpis.toolsCostMonthly)}/mês, já descontado na margem acima.
                </p>

                <div className="divide-y divide-gray-100 mb-3">
                  {(finance.toolExpenses ?? []).map(t => (
                    <div key={t.id} className="flex items-center gap-2 py-2">
                      <input
                        defaultValue={t.name}
                        onBlur={e => e.target.value.trim() && e.target.value !== t.name && handleUpdateTool(t.id, 'name', e.target.value.trim())}
                        className="flex-1 min-w-0 px-2 py-1.5 border border-transparent hover:border-gray-200 focus:border-teal-500 rounded-lg text-sm focus:outline-none"
                      />
                      <input
                        type="number" min="0" step="0.01"
                        defaultValue={t.monthlyCost}
                        onBlur={e => e.target.value && Number(e.target.value) !== Number(t.monthlyCost) && handleUpdateTool(t.id, 'monthlyCost', Number(e.target.value))}
                        className="w-28 px-2 py-1.5 border border-transparent hover:border-gray-200 focus:border-teal-500 rounded-lg text-sm text-right tabular-nums focus:outline-none"
                        title="Valor mensal (R$)"
                      />
                      <input
                        type="number" min="1" max="31"
                        defaultValue={t.billingDay ?? ''}
                        placeholder="dia"
                        onBlur={e => {
                          const v = e.target.value ? Number(e.target.value) : null
                          if (v !== (t.billingDay ?? null)) handleUpdateTool(t.id, 'billingDay', v)
                        }}
                        className="w-16 px-2 py-1.5 border border-transparent hover:border-gray-200 focus:border-teal-500 rounded-lg text-sm text-center tabular-nums focus:outline-none"
                        title="Dia do vencimento (opcional)"
                      />
                      <button onClick={() => handleDeleteTool(t.id)} className="text-gray-300 hover:text-red-500 shrink-0" title="Remover">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  {(finance.toolExpenses ?? []).length === 0 && (
                    <p className="text-sm text-gray-400 py-3">Nenhuma ferramenta cadastrada ainda.</p>
                  )}
                </div>

                <form onSubmit={handleAddTool} className="flex items-center gap-2">
                  <input
                    value={newTool.name}
                    onChange={e => setNewTool({ ...newTool, name: e.target.value })}
                    placeholder="Ferramenta (ex: Supabase)"
                    className="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                  <input
                    type="number" min="0" step="0.01"
                    value={newTool.monthlyCost}
                    onChange={e => setNewTool({ ...newTool, monthlyCost: e.target.value })}
                    placeholder="Valor/mês"
                    className="w-28 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                  <input
                    type="number" min="1" max="31"
                    value={newTool.billingDay}
                    onChange={e => setNewTool({ ...newTool, billingDay: e.target.value })}
                    placeholder="Dia"
                    className="w-16 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                    title="Dia do vencimento (opcional)"
                  />
                  <button type="submit" disabled={savingTool || !newTool.name.trim() || !newTool.monthlyCost}
                    className="flex items-center justify-center w-9 h-9 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-40 text-white transition shrink-0">
                    {savingTool ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Aba: Onboarding (grupo automático criado quando o pagamento é confirmado) */}
      {activeTab === 'onboarding' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          {loadingOnboarding || !onboardingForm ? (
            <p className="text-sm text-gray-400">Carregando configurações...</p>
          ) : (
            <form onSubmit={handleSaveOnboarding} className="space-y-6 max-w-2xl">
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-1">Grupo automático</h3>
                <p className="text-xs text-gray-400 mb-3">
                  Assim que um pagamento é confirmado (PIX ou cartão), o sistema cria o grupo <span className="font-medium">Projeto {'{nome da cliente}'}</span> com ela e a equipe. Só vale pra clientes novos — renovação não cria grupo.
                </p>
                <label className="flex items-center justify-between px-3 py-2.5 border border-gray-200 rounded-lg">
                  <span className="text-sm text-gray-700">Criar grupo automaticamente</span>
                  <input type="checkbox" checked={onboardingForm.groupEnabled}
                    onChange={e => setOnboardingForm({ ...onboardingForm, groupEnabled: e.target.checked })}
                    className="w-4 h-4 accent-teal-700" />
                </label>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-1">Números da equipe</h3>
                <p className="text-xs text-gray-400 mb-3">Entram em todo grupo junto com a cliente. Só dígitos (com DDD; o 55 é adicionado sozinho).</p>
                <div className="space-y-2 mb-2">
                  {onboardingForm.teamPhones.length === 0 && (
                    <p className="text-xs text-gray-400">Nenhum número cadastrado.</p>
                  )}
                  {onboardingForm.teamPhones.map(phone => (
                    <div key={phone} className="flex items-center justify-between px-3 py-2 border border-gray-200 rounded-lg">
                      <span className="text-sm text-gray-700 font-mono">{phone}</span>
                      <button type="button"
                        onClick={() => setOnboardingForm({ ...onboardingForm, teamPhones: onboardingForm.teamPhones.filter(p => p !== phone) })}
                        className="text-gray-400 hover:text-red-500">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input type="tel" value={newTeamPhone}
                    onChange={e => setNewTeamPhone(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTeamPhone() } }}
                    placeholder="ex: 71992867765"
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                  <button type="button" onClick={addTeamPhone}
                    className="flex items-center gap-1 text-sm text-teal-700 hover:bg-teal-50 px-3 py-2 rounded-lg transition">
                    <Plus className="w-4 h-4" /> Adicionar
                  </button>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-1">Mensagem de boas-vindas</h3>
                <p className="text-xs text-gray-400 mb-2">Enviada no grupo assim que ele é criado. Use <span className="font-mono bg-gray-100 px-1 rounded">{'{nome}'}</span> pro nome da cliente.</p>
                <textarea value={onboardingForm.welcomeMessage}
                  onChange={e => setOnboardingForm({ ...onboardingForm, welcomeMessage: e.target.value })}
                  rows={6}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-y" />
              </div>

              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-1">Segunda mensagem (formulário)</h3>
                <p className="text-xs text-gray-400 mb-3">Enviada no mesmo grupo depois do tempo abaixo, com o link do formulário já preenchido pra essa cliente.</p>
                <label className="flex items-center justify-between px-3 py-2.5 border border-gray-200 rounded-lg mb-3">
                  <span className="text-sm text-gray-700">Enviar a segunda mensagem</span>
                  <input type="checkbox" checked={onboardingForm.formMessageEnabled}
                    onChange={e => setOnboardingForm({ ...onboardingForm, formMessageEnabled: e.target.checked })}
                    className="w-4 h-4 accent-teal-700" />
                </label>
                <div className="mb-3">
                  <label className="block text-xs text-gray-500 mb-1">Enviar depois de (minutos)</label>
                  <div className="flex items-center gap-2">
                    <input type="number" min="0" step="1" value={onboardingForm.formDelayMinutes}
                      onChange={e => setOnboardingForm({ ...onboardingForm, formDelayMinutes: e.target.value })}
                      className="w-28 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                    {[30, 60, 360, 1440].map(m => (
                      <button key={m} type="button"
                        onClick={() => setOnboardingForm({ ...onboardingForm, formDelayMinutes: m })}
                        className={`text-xs px-2.5 py-1 rounded-full transition ${Number(onboardingForm.formDelayMinutes) === m ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                        {m === 30 ? '30min' : m === 60 ? '1h' : m === 360 ? '6h' : '24h'}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-gray-400 mb-2">Use <span className="font-mono bg-gray-100 px-1 rounded">{'{nome}'}</span> e <span className="font-mono bg-gray-100 px-1 rounded">{'{link}'}</span>.</p>
                <textarea value={onboardingForm.formMessage}
                  onChange={e => setOnboardingForm({ ...onboardingForm, formMessage: e.target.value })}
                  rows={5}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-y" />
              </div>

              <details className="border border-gray-200 rounded-lg px-3 py-2">
                <summary className="text-sm text-gray-600 cursor-pointer">Avançado — formulário de onboarding</summary>
                <div className="mt-3 space-y-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">URL do formulário</label>
                    <input type="url" value={onboardingForm.formUrl}
                      onChange={e => setOnboardingForm({ ...onboardingForm, formUrl: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-teal-500" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Campo oculto que recebe o código do cliente</label>
                    <input type="text" value={onboardingForm.formEntryField}
                      onChange={e => setOnboardingForm({ ...onboardingForm, formEntryField: e.target.value })}
                      placeholder="entry.123456789"
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-teal-500" />
                  </div>
                </div>
              </details>

              <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
                <button type="submit" disabled={savingOnboarding}
                  className="flex items-center gap-2 bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition">
                  {savingOnboarding ? <><Loader2 className="w-4 h-4 animate-spin" /> Salvando...</> : 'Salvar'}
                </button>
                {onboardingSaved && (
                  <span className="flex items-center gap-1 text-green-600 text-sm"><Check className="w-4 h-4" /> Salvo</span>
                )}
                <button type="button" onClick={handleTestGroup} disabled={testingGroup}
                  className="flex items-center gap-2 text-sm text-teal-700 hover:bg-teal-50 disabled:opacity-60 px-3 py-2 rounded-lg transition ml-auto"
                  title="Cria um grupo só com a equipe (sem cliente) pra testar">
                  {testingGroup ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
                  Criar grupo de teste
                </button>
              </div>
              {testGroupResult && (
                <p className="text-xs text-green-600">{testGroupResult}</p>
              )}
            </form>
          )}
        </div>
      )}

      {/* Aba: Cobranças (histórico de envios PIX) */}
      {activeTab === 'billing' && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <select
              value={billingFilter}
              onChange={e => setBillingFilter(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-500"
            >
              <option value="">Todos os clientes</option>
              {clients.filter(c => c.paymentMethod === 'pix').map(c => (
                <option key={c.id} value={c.id}>{c.displayName || c.email || c.id}</option>
              ))}
            </select>
            <button onClick={() => loadBillingEvents(billingFilter)} className="text-xs text-teal-600 hover:underline">Atualizar</button>
          </div>

          {loadingBilling && <div className="flex items-center gap-2 text-gray-400 text-sm py-8"><Loader2 className="w-4 h-4 animate-spin" /> Carregando...</div>}

          {!loadingBilling && billingEvents.length === 0 && (
            <div className="text-center text-gray-400 text-sm py-8">Nenhum envio registrado ainda.</div>
          )}

          {!loadingBilling && billingEvents.length > 0 && (() => {
            const channelLabel = { pix: '⚡ QR', whatsapp: '💬 whatsapp', email: '📧 e-mail', pagamento: '✅ pago' }
            const groups = new Map()
            for (const ev of billingEvents) {
              const bucket = Math.floor(new Date(ev.createdAt).getTime() / 60000)
              const key = `${ev.tenantId}-${ev.amount}-${bucket}`
              if (!groups.has(key)) groups.set(key, { ...ev, events: [] })
              groups.get(key).events.push(ev)
            }
            const grouped = Array.from(groups.values()).sort(
              (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
            )
            return (
              <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
                {grouped.map(g => {
                  const allOk = g.events.every(e => e.status === 'sent' || e.status === 'confirmado')
                  const failed = g.events.filter(e => e.status === 'failed')
                  return (
                    <div key={g.id} className="p-3 flex items-center justify-between gap-3 text-sm">
                      <div className="flex items-center gap-3 min-w-0">
                        {allOk
                          ? <Check className="w-4 h-4 text-green-600 shrink-0" />
                          : <X className="w-4 h-4 text-red-600 shrink-0" />}
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-gray-700 truncate">{g.tenantName || g.tenantId}</span>
                            {g.events.map(e => (
                              <span
                                key={e.id}
                                className={`text-xs px-1.5 py-0.5 rounded-full ${
                                  e.status === 'confirmado' ? 'bg-green-50 text-green-600 font-medium'
                                  : e.status === 'sent' ? 'bg-gray-100 text-gray-500'
                                  : 'bg-red-50 text-red-500'
                                }`}
                              >
                                {channelLabel[e.channel] || e.channel}
                              </span>
                            ))}
                          </div>
                          {failed.length > 0 && failed[0].errorMessage && (
                            <p className="text-xs text-red-500 truncate max-w-md" title={failed[0].errorMessage}>{failed[0].errorMessage}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-400 shrink-0">
                        {g.amount && <span>R$ {Number(g.amount).toFixed(2)}</span>}
                        <span>{new Date(g.createdAt).toLocaleString('pt-BR')}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })()}
        </div>
      )}

      {/* Aba: Clientes */}
      {activeTab === 'clients' && <>

      {/* Alerta de PIX em atraso ou expirado sem pagar — admin decide bloquear manualmente */}
      {clients.filter(c => ['past_due', 'expired'].includes(c.planStatus)).length > 0 && (
        <div className="bg-amber-50 border border-amber-300 text-amber-800 text-sm px-4 py-3 rounded-xl mb-4 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {clients.filter(c => ['past_due', 'expired'].includes(c.planStatus)).length} cliente(s) com pagamento PIX em atraso/expirado — revise e suspenda manualmente se necessário.
        </div>
      )}

      {/* Credenciais recém-criadas — repassar ao cliente */}
      {created && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-4">
          <p className="text-sm font-semibold text-green-700 mb-1">Cliente criado! Repasse o acesso:</p>
          <p className="text-sm text-green-700">E-mail: <span className="font-mono">{created.email}</span></p>
          <p className="text-sm text-green-700">Senha: <span className="font-mono">{created.password}</span></p>
          <p className="text-xs text-green-600 mt-2">O cliente pode trocar a senha depois de entrar.</p>
        </div>
      )}

      {/* Lista */}
      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {clients.length === 0 && (
          <div className="p-8 text-center text-gray-400 text-sm">Nenhum cliente ainda. Crie o primeiro.</div>
        )}
        {clients.map(c => {
          const dleft = daysUntilDay(c)
          const dueSoon = dleft !== null && dleft <= 2
          const due = nextDueDate(c)
          return (
            <div key={c.id} className="p-4 flex items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-800">{c.displayName || '(sem nome)'}</span>
                  {c.connected
                    ? <span className="inline-flex items-center gap-1 text-xs text-green-600"><Wifi className="w-3 h-3" /> conectado</span>
                    : c.isActive
                      ? <span className="inline-flex items-center gap-1 text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-semibold"><WifiOff className="w-3 h-3" /> desconectado — IA parada</span>
                      : <span className="inline-flex items-center gap-1 text-xs text-gray-400"><WifiOff className="w-3 h-3" /> desconectado</span>}
                  {!c.isActive && <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">suspenso</span>}
                  {['past_due', 'expired'].includes(c.planStatus) && (
                    <span className="inline-flex items-center gap-1 text-xs bg-amber-100 text-amber-700 pl-2 pr-1 py-0.5 rounded-full">
                      {c.planStatus === 'expired' ? 'PIX expirado sem pagar' : 'PIX em atraso'}
                      <button
                        onClick={() => { if (confirm('Remover a tag deste cliente?')) clearClientPastDue(c.id).then(load) }}
                        title="Remover tag"
                        className="hover:bg-amber-200 rounded-full w-3.5 h-3.5 inline-flex items-center justify-center leading-none"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </span>
                  )}
                  {c.paymentMethod && c.paymentMethod !== 'manual' && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{c.paymentMethod === 'card' ? '💳 cartão' : '⚡ pix'}</span>}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {c.email && <span className="font-mono mr-2">{c.email}</span>}
                  {c.leadsCount} leads · {c.usersCount} usuário(s)
                  {c.phone ? ` · WA: ${c.phone}` : ''}
                </div>
                <div className="flex items-center gap-1 mt-1">
                  <span className="text-xs text-gray-400">Cobrança:</span>
                  <input
                    type="tel"
                    defaultValue={c.billingPhone ?? ''}
                    onBlur={(e) => {
                      const v = e.target.value.trim()
                      if (v !== (c.billingPhone ?? '')) updateClientBilling(c.id, { billingPhone: v || null }).then(load)
                    }}
                    placeholder="ex: 27996972230"
                    className="text-xs border border-gray-200 rounded px-2 py-1 w-36 focus:outline-none focus:ring-1 focus:ring-teal-500"
                  />
                </div>
                {/* Dia de vencimento mensal */}
                <div className="flex items-center gap-2 mt-2">
                  <Calendar className="w-3.5 h-3.5 text-gray-400" />
                  <span className="text-xs text-gray-400">Vence dia</span>
                  <input
                    type="number" min="1" max="31"
                    defaultValue={c.billingDay ?? ''}
                    onBlur={(e) => {
                      const v = parseInt(e.target.value)
                      const day = v >= 1 && v <= 31 ? v : null
                      if (day !== c.billingDay) updateClientBilling(c.id, { billingDay: day }).then(load)
                    }}
                    placeholder="—"
                    className="text-xs border border-gray-200 rounded px-2 py-1 w-14 focus:outline-none focus:ring-1 focus:ring-teal-500"
                  />
                  <span className="text-xs text-gray-400">de cada mês</span>
                  {c.paymentMethod === 'pix' && (
                    <>
                      <span className="text-xs text-gray-400 ml-2">R$</span>
                      <input
                        type="number" min="0" step="0.01"
                        defaultValue={c.planValue ?? ''}
                        onBlur={(e) => {
                          const v = e.target.value.trim()
                          const value = v === '' ? null : parseFloat(v)
                          if (value !== (c.planValue != null ? parseFloat(c.planValue) : null)) updateClientBilling(c.id, { planValue: value }).then(load)
                        }}
                        placeholder="390,00"
                        className="text-xs border border-gray-200 rounded px-2 py-1 w-20 focus:outline-none focus:ring-1 focus:ring-teal-500"
                      />
                    </>
                  )}
                  {due && (
                    <span className={`text-xs px-2 py-0.5 rounded-full ${dueSoon ? 'bg-amber-100 text-amber-700 font-medium' : 'bg-gray-100 text-gray-500'}`}>
                      {due.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                      {dleft === 0 ? ' — hoje' : dleft <= 2 ? ` — ${dleft}d` : ''}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(buildOnboardingLink(c.id))
                    alert('Link de onboarding copiado! Já vem com o campo "Código interno" preenchido — o cliente não precisa alterar.')
                  }}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition"
                  title="Copiar link de onboarding (form pré-preenchido pra este cliente)"
                >
                  <Link2 className="w-3.5 h-3.5" />
                </button>
                {c.paymentMethod === 'pix' && (
                  <button
                    onClick={() => handleResendPix(c)}
                    disabled={pixSendingId === c.id}
                    className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg text-teal-600 hover:bg-teal-50 transition disabled:opacity-50"
                    title="Reenviar PIX mensal agora"
                  >
                    {pixSendingId === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  </button>
                )}
                <button
                  onClick={() => setDrawerClient(c)}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition"
                  title="Ver detalhes"
                >
                  <Eye className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => { setResetModal({ id: c.id, name: c.displayName }); setNewPassword('') }}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition"
                  title="Resetar senha"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => toggleActive(c)}
                  className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition ${
                    c.isActive ? 'text-red-600 hover:bg-red-50' : 'text-green-600 hover:bg-green-50'
                  }`}
                >
                  {c.isActive ? <><PowerOff className="w-3.5 h-3.5" /> Suspender</> : <><Power className="w-3.5 h-3.5" /> Reativar</>}
                </button>
                <button
                  onClick={() => setDeleteModal({ id: c.id, name: c.displayName })}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600 transition"
                  title="Remover cliente"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Drawer de detalhes do cliente (teste/lead, churn, serviços extras) */}
      {drawerClient && (
        <ClientDrawer
          client={drawerClient}
          onClose={() => setDrawerClient(null)}
          onChanged={() => { load(); if (activeTab === 'finance') loadFinance() }}
        />
      )}

      {/* Modal resetar senha */}
      {resetModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-800">Resetar senha</h2>
              <button onClick={() => setResetModal(null)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-sm text-gray-500 mb-4">Cliente: <span className="font-medium text-gray-700">{resetModal.name}</span></p>
            <form onSubmit={handleReset} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nova senha</label>
                <input
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  required minLength={5} autoFocus
                  placeholder="mínimo 5 caracteres"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
                <p className="text-xs text-gray-400 mt-1">Repasse a senha nova ao cliente após salvar.</p>
              </div>
              <button type="submit" disabled={resetting}
                className="w-full bg-teal-700 hover:bg-teal-800 disabled:bg-teal-400 text-white font-semibold py-2.5 rounded-lg transition text-sm flex items-center justify-center gap-2">
                {resetting ? <><Loader2 className="w-4 h-4 animate-spin" /> Salvando...</> : <><Check className="w-4 h-4" /> Salvar nova senha</>}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal confirmar exclusão */}
      {deleteModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Trash2 className="w-5 h-5 text-red-600" />
            </div>
            <h2 className="text-lg font-semibold text-gray-800 text-center mb-2">Remover cliente?</h2>
            <p className="text-sm text-gray-500 text-center mb-6">
              <span className="font-medium text-gray-700">{deleteModal.name}</span> será removido permanentemente.<br />
              Esta ação não pode ser desfeita.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteModal(null)} disabled={deleting}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 transition">
                Cancelar
              </button>
              <button onClick={handleDelete} disabled={deleting}
                className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-semibold transition flex items-center justify-center gap-2">
                {deleting ? <><Loader2 className="w-4 h-4 animate-spin" /> Removendo...</> : 'Sim, remover'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal criar cliente */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-800">Novo cliente</h2>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome do cliente/negócio</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">E-mail de acesso</label>
                <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Senha inicial</label>
                <input value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required minLength={5}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                <p className="text-xs text-gray-400 mt-1">Você repassa pro cliente; ele troca depois.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">WhatsApp de cobrança <span className="text-gray-400 font-normal">(opcional)</span></label>
                <input type="tel" value={form.billingPhone} onChange={e => setForm({ ...form, billingPhone: e.target.value })}
                  placeholder="ex: 27996972230"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                <p className="text-xs text-gray-400 mt-1">Número que receberá o lembrete de vencimento (5 dias antes).</p>
              </div>
              <button type="submit" disabled={creating}
                className="w-full bg-teal-700 hover:bg-teal-800 disabled:bg-teal-400 text-white font-semibold py-2.5 rounded-lg transition text-sm flex items-center justify-center gap-2">
                {creating ? <><Loader2 className="w-4 h-4 animate-spin" /> Criando...</> : <><Check className="w-4 h-4" /> Criar cliente</>}
              </button>
            </form>
          </div>
        </div>
      )}
      </>}
    </div>
  )
}
