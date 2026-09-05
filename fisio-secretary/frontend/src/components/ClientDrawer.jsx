import { useState, useEffect } from 'react'
import { X, Loader2, Trash2, Plus, AlertTriangle, FlaskConical } from 'lucide-react'
import {
  updateClientTestFlag,
  updateClientChurn,
  getClientExtraCharges,
  addClientExtraCharge,
  deleteClientExtraCharge,
} from '../services/api'

const fmtBRL = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// Primeiro side-drawer do projeto (o resto do Admin usa modal centralizado) — usado tanto na
// aba Clientes quanto ao clicar numa linha da aba Financeiro. Mesmo `client` (do /admin/clients
// ou /admin/finance/overview) serve de entrada; os campos que faltarem ficam undefined e a UI
// trata como "sem essa info" em vez de quebrar.
export default function ClientDrawer({ client, onClose, onChanged }) {
  const [open, setOpen] = useState(false)
  const [isTest, setIsTest] = useState(!!client?.isTest)
  const [churned, setChurned] = useState(!!(client?.churnedAt))
  const [churnReason, setChurnReason] = useState(client?.churnReason || '')
  const [savingTest, setSavingTest] = useState(false)
  const [savingChurn, setSavingChurn] = useState(false)
  const [charges, setCharges] = useState([])
  const [loadingCharges, setLoadingCharges] = useState(true)
  const [newDesc, setNewDesc] = useState('')
  const [newAmount, setNewAmount] = useState('')
  const [addingCharge, setAddingCharge] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const id = requestAnimationFrame(() => setOpen(true))
    return () => cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    if (!client?.id) return
    setLoadingCharges(true)
    getClientExtraCharges(client.id)
      .then(setCharges)
      .catch(e => setError(e.message))
      .finally(() => setLoadingCharges(false))
  }, [client?.id])

  function handleClose() {
    setOpen(false)
    setTimeout(onClose, 200)
  }

  async function handleToggleTest(next) {
    setSavingTest(true); setError('')
    try {
      await updateClientTestFlag(client.id, next)
      setIsTest(next)
      onChanged?.()
    } catch (e) { setError(e.message) } finally { setSavingTest(false) }
  }

  async function handleToggleChurn(next) {
    setSavingChurn(true); setError('')
    try {
      await updateClientChurn(client.id, next, next ? churnReason : undefined)
      setChurned(next)
      onChanged?.()
    } catch (e) { setError(e.message) } finally { setSavingChurn(false) }
  }

  async function handleSaveChurnReason() {
    if (!churned) return
    setSavingChurn(true); setError('')
    try {
      await updateClientChurn(client.id, true, churnReason)
      onChanged?.()
    } catch (e) { setError(e.message) } finally { setSavingChurn(false) }
  }

  async function handleAddCharge(e) {
    e.preventDefault()
    if (!newDesc.trim() || !newAmount) return
    setAddingCharge(true); setError('')
    try {
      const created = await addClientExtraCharge(client.id, newDesc.trim(), Number(newAmount))
      setCharges(prev => [created, ...prev])
      setNewDesc(''); setNewAmount('')
      onChanged?.()
    } catch (e) { setError(e.message) } finally { setAddingCharge(false) }
  }

  async function handleDeleteCharge(chargeId) {
    try {
      await deleteClientExtraCharge(client.id, chargeId)
      setCharges(prev => prev.filter(c => c.id !== chargeId))
      onChanged?.()
    } catch (e) { setError(e.message) }
  }

  if (!client) return null
  const chargesTotal = charges.reduce((sum, c) => sum + Number(c.amount), 0)

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={handleClose} />
      <div
        className={`absolute inset-y-0 right-0 w-full max-w-md bg-white shadow-2xl overflow-y-auto transition-transform duration-200 ease-out ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="p-6">
          <div className="flex items-start justify-between mb-1">
            <div className="min-w-0">
              <p className="text-base font-semibold text-gray-800 truncate">{client.name || client.displayName || '(sem nome)'}</p>
              <p className="text-sm text-gray-400">{client.billingPhone || client.phone || 'sem telefone'}</p>
            </div>
            <button onClick={handleClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 shrink-0">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap mt-3 mb-6">
            {isTest && <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">🧪 teste/lead</span>}
            {churned && <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium">Churn</span>}
            {!isTest && !churned && client.plan_status && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-teal-100 text-teal-700 font-medium">{client.plan_status}</span>
            )}
          </div>

          {error && <p className="text-xs text-red-600 mb-4">{error}</p>}

          {/* Teste/lead */}
          <div className="mb-5 border border-gray-200 rounded-xl p-4">
            <label className="flex items-center justify-between cursor-pointer">
              <span className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <FlaskConical className="w-4 h-4 text-gray-400" /> Conta de teste / lead
              </span>
              <input
                type="checkbox"
                checked={isTest}
                disabled={savingTest}
                onChange={e => handleToggleTest(e.target.checked)}
                className="w-4 h-4 accent-gray-600"
              />
            </label>
            <p className="text-xs text-gray-400 mt-1.5">Exclui esse cliente por completo da tela Financeiro (MRR, receita, listas) — nunca pagou de verdade.</p>
          </div>

          {/* Churn */}
          <div className="mb-5 border border-gray-200 rounded-xl p-4">
            <label className="flex items-center justify-between cursor-pointer">
              <span className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <AlertTriangle className="w-4 h-4 text-purple-400" /> Deu churn
              </span>
              <input
                type="checkbox"
                checked={churned}
                disabled={savingChurn}
                onChange={e => handleToggleChurn(e.target.checked)}
                className="w-4 h-4 accent-purple-600"
              />
            </label>
            <p className="text-xs text-gray-400 mt-1.5">Pagou ao menos 1 vez e saiu — some do MRR/ativos, mas a receita que já gerou continua contando no acumulado. Serve pra medir saúde e lembrar de tentar recuperar.</p>
            {churned && (
              <div className="mt-3">
                <textarea
                  value={churnReason}
                  onChange={e => setChurnReason(e.target.value)}
                  onBlur={handleSaveChurnReason}
                  placeholder="Motivo (ex: não renovou, pagou mas nunca usou...)"
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 resize-none"
                />
              </div>
            )}
          </div>

          {/* Serviços extras */}
          <div className="border border-gray-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-semibold text-gray-700">Serviços extras</h3>
              {chargesTotal > 0 && <span className="text-sm font-medium text-teal-700">{fmtBRL(chargesTotal)}</span>}
            </div>
            <p className="text-xs text-gray-400 mb-3">Upgrades/upsells além da assinatura (ex.: plano de tráfego pago) — somam na receita dele na tela Financeiro.</p>

            {loadingCharges ? (
              <p className="text-xs text-gray-400 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando...</p>
            ) : charges.length === 0 ? (
              <p className="text-xs text-gray-400 mb-3">Nenhum serviço extra lançado.</p>
            ) : (
              <div className="divide-y divide-gray-100 mb-3">
                {charges.map(c => (
                  <div key={c.id} className="flex items-center justify-between py-2">
                    <div className="min-w-0">
                      <p className="text-sm text-gray-700 truncate">{c.description}</p>
                      <p className="text-xs text-gray-400">{new Date(c.createdAt).toLocaleDateString('pt-BR')}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-sm font-medium text-gray-700">{fmtBRL(c.amount)}</span>
                      <button onClick={() => handleDeleteCharge(c.id)} className="text-gray-300 hover:text-red-500" title="Remover">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={handleAddCharge} className="flex items-center gap-2">
              <input
                value={newDesc}
                onChange={e => setNewDesc(e.target.value)}
                placeholder="Descrição (ex: Plano tráfego pago)"
                className="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
              <input
                type="number" min="0.01" step="0.01"
                value={newAmount}
                onChange={e => setNewAmount(e.target.value)}
                placeholder="Valor"
                className="w-24 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
              <button type="submit" disabled={addingCharge || !newDesc.trim() || !newAmount}
                className="flex items-center justify-center w-9 h-9 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-40 text-white transition shrink-0">
                {addingCharge ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
