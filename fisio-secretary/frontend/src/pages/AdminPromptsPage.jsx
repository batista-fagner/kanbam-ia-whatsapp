import { useState, useEffect } from 'react'
import { FileText, Loader2, AlertCircle, ChevronDown, Bot, X } from 'lucide-react'
import { getAdminPrompts, getAdminMonolithPrompt, getAdminAgentPrompt } from '../services/api'
import PromptSearchViewer from '../components/PromptSearchViewer'

const CHAR_LIMIT = 5000 // trava futura do plano de R$310 — por enquanto só alerta visual

function LengthBadge({ length }) {
  const over = length > CHAR_LIMIT
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${over ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'}`}>
      {length.toLocaleString('pt-BR')} caracteres{over ? ' — acima de 5k' : ''}
    </span>
  )
}

export default function AdminPromptsPage() {
  const [tenants, setTenants] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(null) // tenantId aberto na lista
  const [viewer, setViewer] = useState(null) // { title, text, loading }

  useEffect(() => {
    getAdminPrompts()
      .then(setTenants)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  async function openMonolith(tenantId, kind, title) {
    setViewer({ title, text: '', loading: true })
    try {
      const { text } = await getAdminMonolithPrompt(tenantId, kind)
      setViewer({ title, text, loading: false })
    } catch (e) {
      setViewer({ title, text: `Erro ao carregar: ${e.message}`, loading: false })
    }
  }

  async function openAgent(tenantId, agentId, title) {
    setViewer({ title, text: '', loading: true })
    try {
      const { text } = await getAdminAgentPrompt(tenantId, agentId)
      setViewer({ title, text, loading: false })
    } catch (e) {
      setViewer({ title, text: `Erro ao carregar: ${e.message}`, loading: false })
    }
  }

  if (loading) {
    return <div className="p-8 text-gray-400 text-sm">Carregando prompts...</div>
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        <FileText className="w-5 h-5 text-teal-700" />
        <h1 className="text-lg font-semibold text-gray-800">Prompts dos clientes</h1>
        <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">{tenants.length}</span>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-3 rounded-xl mb-4 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {tenants.map(t => {
          const isOpen = expanded === t.tenantId
          const megahairLen = t.monolith.megahair?.length ?? 0
          const sofiaLen = t.monolith.sofia?.length ?? 0
          const monolithLen = megahairLen || sofiaLen
          const hasMonolith = !!(t.monolith.megahair || t.monolith.sofia)
          return (
            <div key={t.tenantId}>
              <button
                onClick={() => setExpanded(isOpen ? null : t.tenantId)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition text-left"
              >
                <div className="flex items-center gap-3">
                  <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  <div>
                    <p className="text-sm font-medium text-gray-800">{t.displayName || t.tenantId.slice(0, 8)}</p>
                    <p className="text-xs text-gray-400">{t.agentType} {t.multiAgentEnabled && '· multi-agente ativo'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {hasMonolith && <LengthBadge length={monolithLen} />}
                  {t.multiAgent.length > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 font-medium flex items-center gap-1">
                      <Bot className="w-3 h-3" /> {t.multiAgent.length} agentes
                    </span>
                  )}
                </div>
              </button>

              {isOpen && (
                <div className="px-4 pb-4 pl-11 space-y-2">
                  {t.monolith.megahair && (
                    <button
                      onClick={() => openMonolith(t.tenantId, 'megahair', `${t.displayName} — Prompt monólito (Mega Hair)`)}
                      className="w-full flex items-center justify-between text-sm px-3 py-2 rounded-lg border border-gray-100 hover:border-teal-200 hover:bg-teal-50/40 transition text-left"
                    >
                      <span className="text-gray-700">Prompt monólito — Mega Hair</span>
                      <LengthBadge length={t.monolith.megahair.length} />
                    </button>
                  )}
                  {t.monolith.sofia && (
                    <button
                      onClick={() => openMonolith(t.tenantId, 'sofia', `${t.displayName} — Prompt monólito (Sofia)`)}
                      className="w-full flex items-center justify-between text-sm px-3 py-2 rounded-lg border border-gray-100 hover:border-teal-200 hover:bg-teal-50/40 transition text-left"
                    >
                      <span className="text-gray-700">Prompt monólito — Sofia</span>
                      <LengthBadge length={t.monolith.sofia.length} />
                    </button>
                  )}
                  {t.multiAgent.map(a => (
                    <button
                      key={a.agentId}
                      onClick={() => openAgent(t.tenantId, a.agentId, `${t.displayName} — ${a.name}`)}
                      className="w-full flex items-center justify-between text-sm px-3 py-2 rounded-lg border border-gray-100 hover:border-teal-200 hover:bg-teal-50/40 transition text-left"
                    >
                      <span className="text-gray-700 flex items-center gap-2">
                        {a.name}
                        {!a.isActive && <span className="text-xs text-gray-400">(inativo)</span>}
                      </span>
                      <LengthBadge length={a.length} />
                    </button>
                  ))}
                  {!hasMonolith && t.multiAgent.length === 0 && (
                    <p className="text-sm text-gray-400">Nenhum prompt configurado.</p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Viewer do prompt completo com busca */}
      {viewer && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-3xl p-6 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-800">{viewer.title}</h2>
              <button onClick={() => setViewer(null)} className="p-1 rounded hover:bg-gray-100 transition">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
            {viewer.loading ? (
              <div className="flex-1 flex items-center justify-center text-gray-400 text-sm gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Carregando...
              </div>
            ) : (
              <>
                <div className="mb-2"><LengthBadge length={viewer.text.length} /></div>
                <div className="flex-1 overflow-hidden">
                  <PromptSearchViewer value={viewer.text} readOnly heightClass="h-[55vh]" />
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
