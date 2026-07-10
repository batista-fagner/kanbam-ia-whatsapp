import { useState, useEffect, useRef } from 'react'
import { Send, RotateCcw, Boxes, Loader2 } from 'lucide-react'
import { authFetch } from '../services/api'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

// Página de teste do protótipo "agente único + módulos dinâmicos" — sem
// canvas de edição (por enquanto os módulos são só editados via banco). Espelha
// o padrão visual/de contador de token do simulador do AgentBuilderPage
// (/agents), trocando o conceito de "agente atual" por "módulos carregados".
export default function ModulesTestPage() {
  const [modules, setModules] = useState([])
  const [loadingModules, setLoadingModules] = useState(true)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState([]) // { type: 'user'|'agent'|'error', text, moduleNames, meta }
  const [previousModuleNames, setPreviousModuleNames] = useState([])
  const [aiContext, setAiContext] = useState([])
  const [loading, setLoading] = useState(false)
  const [tokenTotals, setTokenTotals] = useState({ inputTokens: 0, cachedTokens: 0, outputTokens: 0 })
  const bottomRef = useRef(null)

  useEffect(() => {
    authFetch(`${API_URL}/prompt-modules`)
      .then((r) => r.json())
      .then((data) => setModules(Array.isArray(data) ? data : []))
      .catch(() => setModules([]))
      .finally(() => setLoadingModules(false))
  }, [])

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
      if (!res.ok) throw new Error(data?.message || 'erro')

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
    <div className="max-w-2xl mx-auto h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-1 py-4">
        <div className="flex items-center gap-2">
          <Boxes className="w-5 h-5 text-violet-600" />
          <div>
            <h1 className="text-sm font-semibold text-gray-800">Simulação — Módulos Dinâmicos</h1>
            <p className="text-xs text-gray-400">Protótipo: agente único + módulos por palavra-chave (sem handoff)</p>
          </div>
        </div>
        <button onClick={reset} title="Reiniciar conversa" className="p-1.5 rounded hover:bg-gray-100 transition text-gray-400 hover:text-gray-600">
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 bg-white border border-gray-200 rounded-2xl shadow-sm flex flex-col overflow-hidden">
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
  )
}
