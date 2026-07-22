import { useState, useEffect, useRef } from 'react'
import { Send, RotateCcw, Boxes, Loader2, Plus, Pencil, Trash2, X, Star, AlertTriangle } from 'lucide-react'
import { authFetch } from '../services/api'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

const emptyModule = {
  name: '',
  isCore: false,
  keywords: '',
  content: '',
  isActive: true,
  injectsMediaCatalog: false,
  injectsDateTable: false,
  sortOrder: 0,
}

// ───────────────────────── Modal de edição/criação de módulo ─────────────────────────
function ModuleModal({ module, onSave, onClose }) {
  const [form, setForm] = useState({ ...emptyModule, ...(module ?? {}) })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Dê um nome ao módulo'); return }
    if (!form.isCore && !form.keywords.trim()) { setError('Módulos não-core precisam de palavras-chave pra saber quando carregar'); return }
    setSaving(true)
    setError('')
    try {
      const method = module ? 'PATCH' : 'POST'
      const url = module ? `${API_URL}/prompt-modules/${module.id}` : `${API_URL}/prompt-modules`
      const res = await authFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message || 'Erro ao salvar módulo')
      onSave(data)
    } catch (e) {
      setError(e.message || 'Erro ao salvar módulo')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl flex flex-col max-h-[94vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Boxes className="w-4 h-4 text-violet-600" />
            <h2 className="text-sm font-semibold text-gray-800">{module ? 'Editar módulo' : 'Novo módulo'}</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 transition">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Nome *</label>
                <input
                  value={form.name}
                  onChange={set('name')}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-500"
                  placeholder="Ex: Preço & Gramatura, Catálogo & Vídeos"
                />
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-xs font-medium text-gray-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form.isCore}
                    onChange={(e) => setForm((f) => ({ ...f, isCore: e.target.checked }))}
                    className="w-4 h-4 accent-violet-600"
                  />
                  <Star className="w-3.5 h-3.5 text-amber-500" />
                  Bloco fixo (core — sempre incluído, só 1 por tenant)
                </label>
              </div>
            </div>

            {!form.isCore && (
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Palavras-chave <span className="text-gray-400">(1 por linha — regex ou texto simples, ativa este módulo quando bater na mensagem)</span>
                </label>
                <textarea
                  value={form.keywords}
                  onChange={set('keywords')}
                  rows={4}
                  className="w-full text-sm font-mono border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
                  placeholder={'pre[cç]o\nvalor\nquanto custa'}
                  spellCheck={false}
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Capacidades <span className="text-gray-400">(injeta blocos extras no prompt quando este módulo carrega)</span>
              </label>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-xs font-medium text-gray-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={!!form.injectsMediaCatalog}
                    onChange={(e) => setForm((f) => ({ ...f, injectsMediaCatalog: e.target.checked }))}
                    className="w-4 h-4 accent-violet-600"
                  />
                  Injeta catálogo de mídias (permite enviar vídeo)
                </label>
                <label className="flex items-center gap-2 text-xs font-medium text-gray-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={!!form.injectsDateTable}
                    onChange={(e) => setForm((f) => ({ ...f, injectsDateTable: e.target.checked }))}
                    className="w-4 h-4 accent-violet-600"
                  />
                  Injeta tabela de datas (necessário pra agendar de verdade)
                </label>
                <label className="flex items-center gap-2 text-xs font-medium text-gray-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form.isActive !== false}
                    onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                    className="w-4 h-4 accent-violet-600"
                  />
                  Ativo
                </label>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Ordem <span className="text-gray-400">(menor aparece primeiro no prompt)</span></label>
              <input
                type="number"
                value={form.sortOrder ?? 0}
                onChange={(e) => setForm((f) => ({ ...f, sortOrder: parseInt(e.target.value, 10) || 0 }))}
                className="w-24 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Conteúdo</label>
              <textarea
                value={form.content}
                onChange={set('content')}
                rows={20}
                className="w-full text-sm font-mono border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-500 resize-y"
                placeholder="Conhecimento/regras deste módulo..."
                spellCheck={false}
              />
              <p className="text-[11px] text-gray-400 mt-1">{form.content?.length ?? 0} caracteres</p>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-violet-700 rounded-lg hover:bg-violet-800 transition disabled:opacity-50">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {saving ? 'Salvando...' : 'Salvar módulo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ───────────────────────── Painel de gestão (lista + CRUD) ─────────────────────────
function ModulesManagerPanel({ modules, loading, onEdit, onCreate, onDelete }) {
  const [confirmDelete, setConfirmDelete] = useState(null)
  const sorted = [...modules].sort((a, b) => (a.isCore ? -1 : b.isCore ? 1 : (a.sortOrder ?? 0) - (b.sortOrder ?? 0)))

  return (
    <div className="w-full lg:w-80 flex-shrink-0 bg-white border border-gray-200 rounded-2xl shadow-sm flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-800">Módulos</h2>
        <button
          onClick={onCreate}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-white bg-violet-700 rounded-lg hover:bg-violet-800 transition"
        >
          <Plus className="w-3.5 h-3.5" /> Novo
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-gray-400 text-xs gap-1">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando...
          </div>
        ) : sorted.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-8">Nenhum módulo cadastrado ainda.</p>
        ) : (
          sorted.map((m) => (
            <div key={m.id} className="border border-gray-200 rounded-lg px-3 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {m.isCore && <Star className="w-3 h-3 text-amber-500 flex-shrink-0" />}
                    <p className="text-sm font-medium text-gray-800 truncate">{m.name}</p>
                  </div>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {m.isCore ? 'bloco fixo' : `${m.keywords?.split('\n').filter(Boolean).length ?? 0} palavras-chave`}
                    {!m.isActive && <span className="text-red-500"> · inativo</span>}
                  </p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => onEdit(m)} className="p-1.5 rounded hover:bg-gray-100 transition text-gray-400 hover:text-gray-600">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => setConfirmDelete(m)} className="p-1.5 rounded hover:bg-red-50 transition text-gray-400 hover:text-red-600">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5">
            <div className="flex items-center gap-2 text-amber-600 mb-2">
              <AlertTriangle className="w-4 h-4" />
              <h3 className="text-sm font-semibold">Apagar módulo?</h3>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              Isso vai remover "{confirmDelete.name}" permanentemente. Essa ação não pode ser desfeita.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setConfirmDelete(null)} className="px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition">
                Cancelar
              </button>
              <button
                onClick={async () => { await onDelete(confirmDelete.id); setConfirmDelete(null) }}
                className="px-3 py-1.5 text-xs font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition"
              >
                Apagar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Página de gestão + teste do "agente único + módulos dinâmicos": lista/cria/edita/apaga
// módulos (core + palavra-chave) e simula conversas contra eles, sem afetar o WhatsApp real.
export default function ModulesTestPage() {
  const [modules, setModules] = useState([])
  const [loadingModules, setLoadingModules] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState([]) // { type: 'user'|'agent'|'error', text, moduleNames, meta }
  const [previousModuleNames, setPreviousModuleNames] = useState([])
  const [aiContext, setAiContext] = useState([])
  const [loading, setLoading] = useState(false)
  const [tokenTotals, setTokenTotals] = useState({ inputTokens: 0, cachedTokens: 0, outputTokens: 0 })
  const [limitReached, setLimitReached] = useState(false)
  const bottomRef = useRef(null)

  function fetchModules() {
    setLoadingModules(true)
    return authFetch(`${API_URL}/prompt-modules`)
      .then((r) => r.json())
      .then((data) => setModules(Array.isArray(data) ? data : []))
      .catch(() => setModules([]))
      .finally(() => setLoadingModules(false))
  }

  useEffect(() => { fetchModules() }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  function reset() {
    setMessages([])
    setPreviousModuleNames([])
    setAiContext([])
    setInput('')
    setTokenTotals({ inputTokens: 0, cachedTokens: 0, outputTokens: 0 })
  }

  function onCreate() { setEditing(null); setModalOpen(true) }
  function onEdit(m) { setEditing(m); setModalOpen(true) }
  function onModalSave(saved) {
    setModules((prev) => {
      const idx = prev.findIndex((m) => m.id === saved.id)
      if (idx >= 0) { const next = [...prev]; next[idx] = saved; return next }
      return [...prev, saved]
    })
    setModalOpen(false)
    reset() // módulos mudaram — evita simular com prompt desatualizado
  }
  async function onDelete(id) {
    await authFetch(`${API_URL}/prompt-modules/${id}`, { method: 'DELETE' })
    setModules((prev) => prev.filter((m) => m.id !== id))
    reset()
  }

  async function sendMessage() {
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    setMessages((prev) => [...prev, { type: 'user', text }])
    setLoading(true)
    try {
      const res = await authFetch(`${API_URL}/prompt-modules/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, previousModuleNames, aiContext }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (res.status === 400 && /limite de teste atingido/i.test(data?.message || '')) {
          setLimitReached(true)
        }
        throw new Error(data?.message || 'erro')
      }

      setMessages((prev) => [...prev, {
        type: 'agent',
        text: data.reply,
        moduleNames: data.moduleNames,
        meta: { stage: data.stage, temperature: data.temperature, action: data.action, mediaName: data.mediaName, tags: data.tags, shouldIgnore: data.shouldIgnore, systemPromptChars: data.systemPromptChars },
      }])
      setPreviousModuleNames(data.moduleNames ?? [])
      setAiContext(data.aiContext ?? [])
      if (data.tokenUsage) {
        setTokenTotals((prev) => ({
          inputTokens: prev.inputTokens + (data.tokenUsage.inputTokens ?? 0),
          cachedTokens: prev.cachedTokens + (data.tokenUsage.cachedTokens ?? 0),
          outputTokens: prev.outputTokens + (data.tokenUsage.outputTokens ?? 0),
        }))
      }
    } catch (e) {
      setMessages((prev) => [...prev, { type: 'error', text: e.message || 'Erro ao processar' }])
    } finally {
      setLoading(false)
    }
  }

  const hasCore = modules.some((m) => m.isCore)

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-1 py-4">
        <div className="flex items-center gap-2">
          <Boxes className="w-5 h-5 text-violet-600" />
          <div>
            <h1 className="text-sm font-semibold text-gray-800">Módulos</h1>
            <p className="text-xs text-gray-400">Agente único + conhecimento por palavra-chave (sem handoff)</p>
          </div>
        </div>
        <button onClick={reset} title="Reiniciar conversa" className="p-1.5 rounded hover:bg-gray-100 transition text-gray-400 hover:text-gray-600">
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row gap-4 min-h-0">
        <ModulesManagerPanel modules={modules} loading={loadingModules} onEdit={onEdit} onCreate={onCreate} onDelete={onDelete} />

        <div className="flex-1 bg-white border border-gray-200 rounded-2xl shadow-sm flex flex-col overflow-hidden min-w-0">
          {/* Módulos cadastrados */}
          <div className="px-4 py-2 border-b border-gray-100 flex items-center gap-2 text-xs flex-wrap">
            {loadingModules ? (
              <span className="text-gray-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Carregando módulos...</span>
            ) : modules.length === 0 ? (
              <span className="text-red-500">Nenhum módulo cadastrado pra este tenant.</span>
            ) : (
              <>
                <span className="text-gray-400">Módulos cadastrados:</span>
                {modules.map((m) => (
                  <span key={m.id} className={`px-1.5 py-0.5 rounded border text-[10px] ${m.isCore ? 'bg-gray-100 text-gray-600 border-gray-200' : 'bg-violet-50 text-violet-600 border-violet-100'}`}>
                    {m.name}{m.isCore ? ' (core)' : ''}
                  </span>
                ))}
                {!hasCore && <span className="text-amber-600">⚠ sem bloco core</span>}
              </>
            )}
          </div>

          {/* Módulos carregados no turno atual */}
          <div className="px-4 py-2 border-b text-xs flex items-center gap-2 bg-violet-50/50 text-violet-700">
            <Boxes className="w-3.5 h-3.5 flex-shrink-0" />
            {previousModuleNames.length > 0
              ? <span>Carregados agora: <strong>{previousModuleNames.join(', ')}</strong></span>
              : <span className="text-gray-400">Nenhum módulo extra carregado ainda (só o bloco fixo)</span>
            }
          </div>

          {/* Contador de tokens */}
          <div className="px-4 py-2 border-b border-gray-100 bg-gray-50 flex items-center gap-3 text-[11px] text-gray-600">
            <span className="font-semibold">Tokens desta simulação:</span>
            <span>{tokenTotals.inputTokens.toLocaleString('pt-BR')} entrada</span>
            <span className="text-gray-400">·</span>
            <span>{tokenTotals.cachedTokens.toLocaleString('pt-BR')} cache</span>
            <span className="text-gray-400">·</span>
            <span>{tokenTotals.outputTokens.toLocaleString('pt-BR')} saída</span>
          </div>

          {/* Mensagens */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-[300px]">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-gray-300 gap-2">
                <Boxes className="w-8 h-8 opacity-40" />
                <p className="text-xs text-center">Manda uma mensagem pra iniciar a simulação.</p>
              </div>
            )}

            {messages.map((msg, i) => {
              if (msg.type === 'user') return (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[80%] bg-violet-600 text-white text-sm rounded-2xl rounded-tr-sm px-4 py-2.5 shadow-sm">
                    {msg.text}
                  </div>
                </div>
              )
              if (msg.type === 'error') return (
                <div key={i} className="text-xs text-red-500 text-center">{msg.text}</div>
              )
              return (
                <div key={i} className="flex flex-col gap-1">
                  <span className="text-[10px] text-gray-400 ml-1">
                    módulos: [{msg.moduleNames?.join(', ') || '-'}]{msg.meta?.systemPromptChars ? ` · ${msg.meta.systemPromptChars} chars` : ''}
                  </span>
                  <div className="max-w-[85%] bg-white border border-gray-200 text-gray-800 text-sm rounded-2xl rounded-tl-sm px-4 py-2.5 shadow-sm">
                    {msg.text || <span className="italic text-gray-400">(reply vazio — shouldIgnore)</span>}
                  </div>
                  {msg.meta && (
                    <div className="flex flex-wrap gap-1 ml-1">
                      {msg.meta.stage && <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100">stage: {msg.meta.stage}</span>}
                      {msg.meta.temperature && <span className="text-[9px] px-1.5 py-0.5 rounded bg-orange-50 text-orange-600 border border-orange-100">{msg.meta.temperature}</span>}
                      {msg.meta.action && msg.meta.action !== 'none' && <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 border border-purple-100">action: {msg.meta.action}</span>}
                      {msg.meta.mediaName && <span className="text-[9px] px-1.5 py-0.5 rounded bg-pink-50 text-pink-600 border border-pink-100">mídia: {Array.isArray(msg.meta.mediaName) ? msg.meta.mediaName.join(', ') : msg.meta.mediaName}</span>}
                      {msg.meta.tags?.length > 0 && <span className="text-[9px] px-1.5 py-0.5 rounded bg-teal-50 text-teal-600 border border-teal-100">tags: {msg.meta.tags.join(', ')}</span>}
                      {msg.meta.shouldIgnore && <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-100">shouldIgnore</span>}
                    </div>
                  )}
                </div>
              )
            })}

            {loading && (
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-gray-400 ml-1">processando...</span>
                <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3 w-16 shadow-sm">
                  <div className="flex gap-1 items-center">
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="px-4 py-3 border-t border-gray-100 bg-white">
            {modules.length === 0
              ? <p className="text-xs text-gray-400 text-center">Nenhum módulo cadastrado pra este tenant ainda.</p>
              : limitReached
              ? <p className="text-xs text-red-500 text-center font-medium">🔒 Limite de teste atingido — envio de mensagens bloqueado.</p>
              : (
                <div className="flex gap-2">
                  <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                    disabled={loading}
                    className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50"
                    placeholder="Digite uma mensagem..."
                  />
                  <button
                    onClick={sendMessage}
                    disabled={loading || !input.trim()}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-violet-700 rounded-xl hover:bg-violet-800 transition disabled:opacity-50"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              )
            }
          </div>
        </div>
      </div>

      {modalOpen && (
        <ModuleModal
          module={editing}
          onSave={onModalSave}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  )
}
