import { useState, useEffect } from 'react'
import { Users, Plus, Power, PowerOff, Loader2, X, AlertCircle, Wifi, WifiOff, Check, Calendar } from 'lucide-react'
import { getClients, createClient, setClientActive, updateClientBilling } from '../services/api'

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
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [created, setCreated] = useState(null) // credenciais p/ repassar ao cliente

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
      setForm({ name: '', email: '', password: '' })
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

  async function saveBilling(id, nextPaymentDate) {
    await updateClientBilling(id, { nextPaymentDate: nextPaymentDate || null })
    await load()
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
          const dleft = daysUntil(c.nextPaymentDate)
          const dueSoon = dleft !== null && dleft <= 5
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
                  {c.leadsCount} leads · {c.usersCount} usuário(s)
                  {c.phone ? ` · ${c.phone}` : ''}
                </div>
                {/* Vencimento */}
                <div className="flex items-center gap-2 mt-2">
                  <Calendar className="w-3.5 h-3.5 text-gray-400" />
                  <input
                    type="date"
                    defaultValue={c.nextPaymentDate ? String(c.nextPaymentDate).slice(0, 10) : ''}
                    onBlur={(e) => saveBilling(c.id, e.target.value)}
                    className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-teal-500"
                  />
                  {dleft !== null && (
                    <span className={`text-xs px-2 py-0.5 rounded-full ${dueSoon ? 'bg-amber-100 text-amber-700 font-medium' : 'bg-gray-100 text-gray-500'}`}>
                      {dleft < 0 ? `vencido há ${-dleft}d` : dleft === 0 ? 'vence hoje' : `vence em ${dleft}d`}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => toggleActive(c)}
                className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition ${
                  c.isActive ? 'text-red-600 hover:bg-red-50' : 'text-green-600 hover:bg-green-50'
                }`}
              >
                {c.isActive ? <><PowerOff className="w-3.5 h-3.5" /> Suspender</> : <><Power className="w-3.5 h-3.5" /> Reativar</>}
              </button>
            </div>
          )
        })}
      </div>

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
