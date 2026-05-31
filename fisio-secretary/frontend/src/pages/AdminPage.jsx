import { useState, useEffect } from 'react'
import { Users, Plus, Power, PowerOff, Loader2, X, AlertCircle, Wifi, WifiOff, Check, Calendar, KeyRound } from 'lucide-react'
import { getClients, createClient, setClientActive, updateClientBilling, resetClientPassword } from '../services/api'

function daysUntil(dateStr) {
  if (!dateStr) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const d = new Date(dateStr); d.setHours(0, 0, 0, 0)
  return Math.round((d - today) / 86400000)
}

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

  async function toggleActive(c) {
    await setClientActive(c.id, !c.isActive)
    await load()
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

  function nextDueDate(billingDay) {
    if (!billingDay) return null
    const now = new Date()
    const y = now.getFullYear(), m = now.getMonth()
    const lastDay = new Date(y, m + 1, 0).getDate()
    const day = Math.min(billingDay, lastDay)
    const due = new Date(y, m, day)
    if (due <= now) { // já passou esse mês → próximo mês
      const lastDayNext = new Date(y, m + 2, 0).getDate()
      return new Date(y, m + 1, Math.min(billingDay, lastDayNext))
    }
    return due
  }

  function daysUntilDay(billingDay) {
    const due = nextDueDate(billingDay)
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
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-teal-700" />
          <h1 className="text-xl font-bold text-gray-800">Clientes</h1>
          <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{clients.length}</span>
        </div>
        <button
          onClick={() => { setShowCreate(true); setCreated(null) }}
          className="flex items-center gap-2 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
        >
          <Plus className="w-4 h-4" /> Novo cliente
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-3 rounded-xl mb-4 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {error}
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
          const dleft = daysUntilDay(c.billingDay)
          const dueSoon = dleft !== null && dleft <= 5
          const due = nextDueDate(c.billingDay)
          return (
            <div key={c.id} className="p-4 flex items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-800">{c.displayName || '(sem nome)'}</span>
                  {c.connected
                    ? <span className="inline-flex items-center gap-1 text-xs text-green-600"><Wifi className="w-3 h-3" /> conectado</span>
                    : <span className="inline-flex items-center gap-1 text-xs text-gray-400"><WifiOff className="w-3 h-3" /> desconectado</span>}
                  {!c.isActive && <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">suspenso</span>}
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
                  {due && (
                    <span className={`text-xs px-2 py-0.5 rounded-full ${dueSoon ? 'bg-amber-100 text-amber-700 font-medium' : 'bg-gray-100 text-gray-500'}`}>
                      {due.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                      {dleft === 0 ? ' — hoje' : dleft <= 5 ? ` — ${dleft}d` : ''}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
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
              </div>
            </div>
          )
        })}
      </div>

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
    </div>
  )
}
