import { useState, useEffect, useRef } from 'react'
import { Wifi, WifiOff, Loader2, Smartphone, RotateCcw, AlertCircle, X, RefreshCw, Trash2, Radio, Plus, Image as ImageIcon, Play, ChevronDown, Wand2, CheckCircle2, Search, ChevronUp, Copy, BookOpen, Sparkles, MessageSquare, Bot, Zap } from 'lucide-react'
import { authFetch, getMediaList } from '../services/api'
import { useAuth } from '../context/AuthContext'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

const PROMPT_TEMPLATES = [
  {
    id: 'megahair-basico',
    name: 'Mega Hair — Exemplo base',
    description: 'Template completo para salões de mega hair com fluxo de qualificação e envio de vídeos.',
    content: `Cole aqui o prompt de exemplo do cliente...`,
  },
]


function StatusBadge({ status }) {
  if (status === 'connected') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium bg-green-100 text-green-700">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
        Conectado
      </span>
    )
  }
  if (status === 'connecting') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium bg-yellow-100 text-yellow-700">
        <Loader2 className="w-3 h-3 animate-spin" />
        Conectando...
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-500">
      <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
      Desconectado
    </span>
  )
}

function PromptTemplatesCard({ onCopy }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(null)

  function handleCopy(template) {
    navigator.clipboard.writeText(template.content).catch(() => {})
    onCopy(template.content)
    setCopied(template.id)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 mt-4">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-6 py-4 text-left"
      >
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-teal-600" />
          <span className="text-sm font-semibold text-gray-800">Templates de Prompt</span>
          <span className="text-xs bg-teal-50 text-teal-700 px-2 py-0.5 rounded-full">{PROMPT_TEMPLATES.length} exemplo{PROMPT_TEMPLATES.length !== 1 ? 's' : ''}</span>
        </div>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-6 pb-6 space-y-4 border-t border-gray-100 pt-4">
          <p className="text-sm text-gray-500">Exemplos de prompt prontos. Clique em <strong>Usar este template</strong> para copiar direto no campo de edição acima — ajuste conforme necessário antes de salvar.</p>
          {PROMPT_TEMPLATES.map(t => (
            <div key={t.id} className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 bg-gray-50">
                <div>
                  <p className="text-sm font-medium text-gray-800">{t.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{t.description}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopy(t)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition ${
                    copied === t.id
                      ? 'bg-green-100 text-green-700'
                      : 'bg-teal-700 text-white hover:bg-teal-800'
                  }`}
                >
                  {copied === t.id ? (
                    <><CheckCircle2 className="w-3.5 h-3.5" /> Copiado!</>
                  ) : (
                    <><Copy className="w-3.5 h-3.5" /> Usar este template</>
                  )}
                </button>
              </div>
              <pre className="text-xs text-gray-600 font-mono p-4 bg-white overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed">
                {t.content}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function MultiAgentToggleCard({ config, onSaved }) {
  const [enabled, setEnabled] = useState(!!config?.multiAgentEnabled)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function toggle() {
    const next = !enabled
    setEnabled(next)
    setSaving(true)
    try {
      await authFetch(`${API_URL}/instance/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ multiAgentEnabled: next }),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      await onSaved()
    } catch {
      setEnabled(!next) // reverte
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 mt-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${enabled ? 'bg-teal-100' : 'bg-gray-100'}`}>
            <Sparkles className={`w-4 h-4 ${enabled ? 'text-teal-600' : 'text-gray-400'}`} />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-800">Sistema Multi-Agente</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {enabled
                ? 'Ativado — mensagens do WhatsApp são roteadas pelo Supervisor entre os agentes configurados em /agents.'
                : 'Desativado — usando o prompt único (Lindona / Sofia) normalmente.'}
            </p>
            {enabled && (
              <a href="/agents" className="inline-flex items-center gap-1 text-xs text-teal-600 hover:underline mt-1">
                <Sparkles className="w-3 h-3" /> Configurar agentes
              </a>
            )}
          </div>
        </div>
        <button
          onClick={toggle}
          disabled={saving}
          className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none ${
            enabled ? 'bg-teal-600' : 'bg-gray-200'
          } ${saving ? 'opacity-50' : ''}`}
          title={enabled ? 'Desativar multi-agente' : 'Ativar multi-agente'}
        >
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${enabled ? 'translate-x-5' : 'translate-x-0'}`} />
        </button>
      </div>
      {saved && <p className="text-xs text-teal-600 mt-2">Salvo!</p>}
    </div>
  )
}

function DeactivationKeywordCard({ config, onSaved }) {
  const [keyword, setKeyword] = useState(config?.deactivationKeyword ?? 'opa')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function save() {
    const trimmed = keyword.trim()
    if (!trimmed) return
    setSaving(true)
    try {
      await authFetch(`${API_URL}/instance/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deactivationKeyword: trimmed }),
      })
      setKeyword(trimmed)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      await onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 mt-4">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-teal-100">
          <RotateCcw className="w-4 h-4 text-teal-600" />
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-800">Palavra para desativar a IA</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Quando você digitar essa palavra pelo próprio WhatsApp (celular ou WhatsApp Web) em uma conversa, a IA é desativada automaticamente para aquele lead.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          maxLength={40}
          placeholder="opa"
          className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
        <button
          onClick={save}
          disabled={saving || !keyword.trim()}
          className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50 transition"
        >
          {saving ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
      {saved && <p className="text-xs text-teal-600 mt-2">Salvo!</p>}
    </div>
  )
}

function ActivationKeywordCard({ config, onSaved }) {
  const [keyword, setKeyword] = useState(config?.activationKeyword ?? 'volta')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function save() {
    const trimmed = keyword.trim()
    if (!trimmed) return
    setSaving(true)
    try {
      await authFetch(`${API_URL}/instance/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activationKeyword: trimmed }),
      })
      setKeyword(trimmed)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      await onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 mt-4">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-teal-100">
          <RotateCcw className="w-4 h-4 text-teal-600" />
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-800">Palavra para reativar a IA</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Quando você digitar essa palavra pelo próprio WhatsApp (celular ou WhatsApp Web) em uma conversa, a IA volta a responder automaticamente para aquele lead.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          maxLength={40}
          placeholder="volta"
          className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
        <button
          onClick={save}
          disabled={saving || !keyword.trim()}
          className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50 transition"
        >
          {saving ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
      {saved && <p className="text-xs text-teal-600 mt-2">Salvo!</p>}
    </div>
  )
}

function MonolithTestPanel({ open, onClose }) {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState([]) // { type: 'user'|'agent'|'error', text, meta }
  const [aiContext, setAiContext] = useState([])
  const [loading, setLoading] = useState(false)
  const [tokenTotals, setTokenTotals] = useState({ inputTokens: 0, cachedTokens: 0, outputTokens: 0 })
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  function reset() {
    setMessages([])
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
      const res = await authFetch(`${API_URL}/monolith-test/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, aiContext }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message || 'erro')

      setMessages((prev) => [...prev, {
        type: 'agent',
        text: data.reply,
        meta: { stage: data.stage, temperature: data.temperature, action: data.action, mediaName: data.mediaName, tags: data.tags },
      }])
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

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white h-full shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-teal-600" />
            <h2 className="text-sm font-semibold text-gray-800">Simulação — Monólito (Lindona)</h2>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={reset} title="Reiniciar conversa" className="p-1.5 rounded hover:bg-gray-100 transition text-gray-400 hover:text-gray-600">
              <RotateCcw className="w-4 h-4" />
            </button>
            <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-100 transition">
              <X className="w-4 h-4 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Info do fluxo */}
        <div className="px-4 py-2 border-b bg-gray-50 border-gray-100 text-xs text-gray-500 flex items-center gap-2">
          <Bot className="w-3.5 h-3.5 flex-shrink-0" />
          <span>Prompt único (processMessageMegaHair) — sem agentes, sem handoff.</span>
        </div>

        {/* Contador de tokens da simulação */}
        <div className="px-4 py-2 border-b border-gray-100 bg-violet-50/50 flex items-center gap-3 text-[11px] text-violet-700">
          <span className="font-semibold">Tokens desta simulação:</span>
          <span>{tokenTotals.inputTokens.toLocaleString('pt-BR')} entrada</span>
          <span className="text-violet-400">·</span>
          <span>{tokenTotals.cachedTokens.toLocaleString('pt-BR')} cache</span>
          <span className="text-violet-400">·</span>
          <span>{tokenTotals.outputTokens.toLocaleString('pt-BR')} saída</span>
        </div>

        {/* Mensagens */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-gray-300 gap-2">
              <MessageSquare className="w-8 h-8 opacity-40" />
              <p className="text-xs text-center">Manda uma mensagem pra iniciar a simulação do monólito.</p>
            </div>
          )}

          {messages.map((msg, i) => {
            if (msg.type === 'user') return (
              <div key={i} className="flex justify-end">
                <div className="max-w-[80%] bg-teal-600 text-white text-sm rounded-2xl rounded-tr-sm px-4 py-2.5 shadow-sm">
                  {msg.text}
                </div>
              </div>
            )
            if (msg.type === 'error') return (
              <div key={i} className="text-xs text-red-500 text-center">{msg.text}</div>
            )
            return (
              <div key={i} className="flex flex-col gap-1">
                <div className="max-w-[85%] bg-white border border-gray-200 text-gray-800 text-sm rounded-2xl rounded-tl-sm px-4 py-2.5 shadow-sm">
                  {msg.text}
                </div>
                {msg.meta && (
                  <div className="flex flex-wrap gap-1 ml-1">
                    {msg.meta.stage && <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100">stage: {msg.meta.stage}</span>}
                    {msg.meta.temperature && <span className="text-[9px] px-1.5 py-0.5 rounded bg-orange-50 text-orange-600 border border-orange-100">{msg.meta.temperature}</span>}
                    {msg.meta.action && msg.meta.action !== 'none' && <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 border border-purple-100">action: {msg.meta.action}</span>}
                    {msg.meta.mediaName && <span className="text-[9px] px-1.5 py-0.5 rounded bg-pink-50 text-pink-600 border border-pink-100">mídia: {Array.isArray(msg.meta.mediaName) ? msg.meta.mediaName.join(', ') : msg.meta.mediaName}</span>}
                    {msg.meta.tags?.length > 0 && <span className="text-[9px] px-1.5 py-0.5 rounded bg-teal-50 text-teal-600 border border-teal-100">tags: {msg.meta.tags.join(', ')}</span>}
                  </div>
                )}
              </div>
            )
          })}
          {loading && (
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Pensando...
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="border-t border-gray-100 p-3 flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') sendMessage() }}
            placeholder="Digite uma mensagem..."
            className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            className="px-3 py-2 text-sm bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-40 transition"
          >
            Enviar
          </button>
        </div>
      </div>
    </div>
  )
}

function MonolithTestCard() {
  const [open, setOpen] = useState(false)
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 mt-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-violet-100">
            <Zap className="w-4 h-4 text-violet-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-800">Testar Monólito (com contador de token)</p>
            <p className="text-xs text-gray-500 mt-0.5">Simula uma conversa com o prompt único (Lindona), sem WhatsApp, mostrando o consumo de token em tempo real.</p>
          </div>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="px-3 py-2 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition flex-shrink-0"
        >
          Abrir teste
        </button>
      </div>
      <MonolithTestPanel open={open} onClose={() => setOpen(false)} />
    </div>
  )
}

export default function SettingsPage() {
  const { user } = useAuth()
  // Multi-agente em rollout controlado: localhost + contas beta (resto segue no monólito).
  const MULTI_AGENT_BETA_EMAILS = ['bfagner@hotmail.com.br', 'claudia_teste@hotmail.com', 'alex_teste@hotmail.com', 'alexcosta171@yahoo.com', 'claudia_temp@hotmail.com']
  const canSeeMultiAgent = import.meta.env.VITE_API_URL?.includes('localhost')
    || (typeof window !== 'undefined' && window.location.hostname === 'localhost')
    || MULTI_AGENT_BETA_EMAILS.includes(user?.email)
  // Cliente real em teste do multi-agente: esconde ambos os painéis de teste
  // (monólito e multi-agente) — construtor ativo, mas análise via simulador reservada
  // só pra contas internas.
  const HIDE_TEST_PANEL_EMAILS = ['alexcosta171@yahoo.com', 'claudia_temp@hotmail.com']
  const canSeeTestPanel = !HIDE_TEST_PANEL_EMAILS.includes(user?.email)
  const [bootstrapping, setBootstrapping] = useState(true)
  const [instanceConfig, setInstanceConfig] = useState(null) // null = não tem; objeto = tem
  const [instanceStatus, setInstanceStatus] = useState(null)
  const [connectMode, setConnectMode] = useState('qrcode')
  const [phoneInput, setPhoneInput] = useState('')
  const [qrCode, setQrCode] = useState(null)
  const [pairCode, setPairCode] = useState(null)
  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [showConfirmDisconnect, setShowConfirmDisconnect] = useState(false)
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [settingUpWebhook, setSettingUpWebhook] = useState(false)
  const [webhookConfigured, setWebhookConfigured] = useState(false)
  const [error, setError] = useState(null)
  const [instanceName, setInstanceName] = useState('')
  const [creatingInstance, setCreatingInstance] = useState(false)
  const [customPromptMegaHair, setCustomPromptMegaHair] = useState('')
  const [savingPrompt, setSavingPrompt] = useState(false)
  const [mediaList, setMediaList] = useState([])
  const [promptSaved, setPromptSaved] = useState(false)
  const [blocks, setBlocks] = useState({ identidade: '', regras: '', fluxo: '', objeccoes: '', exemplos: '', produtos: '', horario: '', tom: '', diferenciais: '', informacoes_gerais: '', guardrails: '' })
  const [builderOpen, setBuilderOpen] = useState(false)
  const [appliedNotice, setAppliedNotice] = useState(false)
  const [batchTrigger, setBatchTrigger] = useState('')
  const [batchSelected, setBatchSelected] = useState([])
  const [searchTerm, setSearchTerm] = useState('')
  const [searchIndex, setSearchIndex] = useState(0)
  const pollingRef = useRef(null)
  const promptRef = useRef(null)

  const fetchStatus = async () => {
    try {
      const res = await authFetch(`${API_URL}/instance/status`)
      const data = await res.json()
      const status = data?.instance?.status ?? 'disconnected'
      setInstanceStatus(data)
      return { status, data }
    } catch {
      setInstanceStatus(null)
      return { status: 'disconnected', data: null }
    }
  }

  const fetchConfig = async () => {
    try {
      const res = await authFetch(`${API_URL}/instance/config`)
      const data = await res.json()
      setInstanceConfig(data)
      setWebhookConfigured(data?.webhookConfigured ?? false)
      setCustomPromptMegaHair(data?.customPromptMegaHair ?? '')
      // Carrega config de follow-up automático (converte idleMinutes → value/unit)
      return data
    } catch {
      setInstanceConfig(null)
      return null
    }
  }


  const startPolling = () => {
    if (pollingRef.current) return
    pollingRef.current = setInterval(async () => {
      const { status, data } = await fetchStatus()
      if (status === 'connected') {
        stopPolling()
        setConnecting(false)
        setQrCode(null)
        setPairCode(null)
        await setupWebhook()
      } else if (status === 'disconnected') {
        stopPolling()
        setConnecting(false)
        setQrCode(null)
        setPairCode(null)
      } else if (status === 'connecting') {
        if (data?.instance?.qrcode) setQrCode(data.instance.qrcode)
      }
    }, 3000)
  }

  const stopPolling = () => {
    clearInterval(pollingRef.current)
    pollingRef.current = null
  }

  const setupWebhook = async () => {
    setSettingUpWebhook(true)
    try {
      const res = await authFetch(`${API_URL}/instance/setup-webhook`, { method: 'POST' })
      const data = await res.json()
      setWebhookConfigured(data?.webhookConfigured ?? false)
      setInstanceConfig(data)
    } catch {
      setWebhookConfigured(false)
    } finally {
      setSettingUpWebhook(false)
    }
  }


  useEffect(() => {
    const init = async () => {
      const config = await fetchConfig()
      if (!config) {
        setBootstrapping(false)
        return
      }
      const { status, data } = await fetchStatus()
      if (status === 'connecting') {
        setConnecting(true)
        if (data?.instance?.qrcode) setQrCode(data.instance.qrcode)
        if (data?.instance?.paircode) setPairCode(data.instance.paircode)
        startPolling()
      } else {
        setConnecting(false)
      }
      setBootstrapping(false)
    }
    init()
    getMediaList().then(setMediaList).catch(() => setMediaList([]))
    return () => stopPolling()
  }, [])

  // Busca e seleciona ocorrência no textarea do prompt.
  const searchOccurrences = (term, text) => {
    if (!term) return []
    const lower = text.toLowerCase()
    const key = term.toLowerCase()
    const positions = []
    let pos = 0
    while ((pos = lower.indexOf(key, pos)) !== -1) {
      positions.push(pos)
      pos += key.length
    }
    return positions
  }

  const navigateSearch = (dir) => {
    const positions = searchOccurrences(searchTerm, customPromptMegaHair)
    if (positions.length === 0) return
    const next = (searchIndex + dir + positions.length) % positions.length
    setSearchIndex(next)
    const el = promptRef.current
    if (!el) return
    const start = positions[next]
    const end = start + searchTerm.length
    el.focus()
    el.setSelectionRange(start, end)
    // Scroll para a seleção
    const lineHeight = 16
    const lines = customPromptMegaHair.slice(0, start).split('\n').length
    el.scrollTop = (lines - 3) * lineHeight
  }

  // Insere snippet completo de envio de mídia na posição do cursor do textarea do prompt.
  const insertMediaName = (name) => {
    const el = promptRef.current
    const snippet = `envie usando action=send_media com mediaName="${name}"`
    if (!el) {
      setCustomPromptMegaHair(prev => `${prev}${snippet}`)
      return
    }
    const start = el.selectionStart ?? customPromptMegaHair.length
    const end = el.selectionEnd ?? customPromptMegaHair.length
    const next = customPromptMegaHair.slice(0, start) + snippet + customPromptMegaHair.slice(end)
    setCustomPromptMegaHair(next)
    // Reposiciona o cursor logo após o trecho inserido.
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + snippet.length
      el.setSelectionRange(pos, pos)
    })
  }

  const toggleBatchVideo = (name) => {
    setBatchSelected(prev =>
      prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
    )
  }

  const buildBatchSnippet = () => {
    if (batchSelected.length === 0) return ''
    const trigger = batchTrigger.trim() || 'quero ver todos'
    const namesStr = batchSelected.map(n => `"${n}"`).join(', ')
    if (batchSelected.length === 1) {
      return `Quando a cliente disser "${trigger}":\n  action=send_media\n  mediaName: ${namesStr}\n  reply: "Aqui está! 😍"`
    }
    return `Quando a cliente disser "${trigger}":\n  action=send_media\n  mediaName: [${namesStr}]\n  reply: "Aqui estão todos! 😍"`
  }

  const insertBatchSnippet = () => {
    const snippet = buildBatchSnippet()
    if (!snippet) return
    const el = promptRef.current
    if (!el) {
      setCustomPromptMegaHair(prev => `${prev}\n\n${snippet}`)
      return
    }
    const start = el.selectionStart ?? customPromptMegaHair.length
    const end = el.selectionEnd ?? customPromptMegaHair.length
    const next = customPromptMegaHair.slice(0, start) + '\n' + snippet + customPromptMegaHair.slice(end)
    setCustomPromptMegaHair(next)
    setBuilderOpen(false)
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + snippet.length + 1
      el.setSelectionRange(pos, pos)
    })
  }

  const handleCreateInstance = async () => {
    setError(null)
    setCreatingInstance(true)
    try {
      // Cria a instância uazapi para o TENANT logado (não admin-only).
      const res = await authFetch(`${API_URL}/instance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: instanceName.trim() }),
      })
      const data = await res.json()
      if (data?.error) {
        setError(data.error)
        return
      }
      setInstanceConfig(data)
      setWebhookConfigured(data?.webhookConfigured ?? false)
      setInstanceName('')
      await fetchStatus()
    } catch {
      setError('Não foi possível criar a conexão. Verifique sua internet e tente novamente.')
    } finally {
      setCreatingInstance(false)
    }
  }

  const handleConnect = async () => {
    setError(null)
    setConnecting(true)
    setQrCode(null)
    setPairCode(null)

    try {
      const body = connectMode === 'paircode' ? { phone: phoneInput.replace(/\D/g, '') } : {}
      const res = await authFetch(`${API_URL}/instance/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()

      if (data?.instance?.qrcode) setQrCode(data.instance.qrcode)
      if (data?.instance?.paircode) setPairCode(data.instance.paircode)

      await fetchStatus()
      startPolling()
    } catch {
      setError('Não foi possível iniciar a conexão. Verifique sua internet e tente novamente.')
      setConnecting(false)
    }
  }

  const handleDisconnect = async () => {
    setShowConfirmDisconnect(false)
    setDisconnecting(true)
    setError(null)
    stopPolling()
    setConnecting(false)
    setQrCode(null)
    setPairCode(null)
    setWebhookConfigured(false)
    try {
      await authFetch(`${API_URL}/instance/disconnect`, { method: 'POST' })
      await fetchStatus()
    } catch {
      setError('Não foi possível desconectar. Verifique sua internet e tente novamente.')
    } finally {
      setDisconnecting(false)
    }
  }

  const handleReset = async () => {
    setResetting(true)
    setError(null)
    try {
      await authFetch(`${API_URL}/instance/reset`, { method: 'POST' })
      const { status, data } = await fetchStatus()
      if (status === 'connecting') {
        if (data?.instance?.qrcode) setQrCode(data.instance.qrcode)
        startPolling()
      }
    } catch {
      setError('Não foi possível reiniciar. Verifique sua internet e tente novamente.')
    } finally {
      setResetting(false)
    }
  }

  const handleDelete = async () => {
    setShowConfirmDelete(false)
    setDeleting(true)
    setError(null)
    stopPolling()
    try {
      await authFetch(`${API_URL}/instance`, { method: 'DELETE' })
      setInstanceStatus(null)
      // Recarrega config pois o backend MANTÉM o registro (prompts preservados),
      // apenas zera os campos da instância WhatsApp.
      await fetchConfig()
      setQrCode(null)
      setPairCode(null)
      setConnecting(false)
      setWebhookConfigured(false)
    } catch {
      setError('Não foi possível remover a conexão. Verifique sua internet e tente novamente.')
    } finally {
      setDeleting(false)
    }
  }

  const currentStatus = instanceStatus?.instance?.status ?? 'disconnected'
  const profileName = instanceStatus?.instance?.profileName ?? instanceConfig?.profileName
  const profilePicUrl = instanceStatus?.instance?.profilePicUrl ?? instanceConfig?.profilePicUrl
  const phone = instanceStatus?.status?.jid?.replace('@s.whatsapp.net', '').replace(/:\d+$/, '') ?? instanceConfig?.phone

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-xl font-bold text-gray-800 mb-6">Configurações</h1>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
              <Smartphone className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-800">WhatsApp</h2>
              <p className="text-sm text-gray-500">
                {instanceConfig?.profileName ? `Conexão: ${instanceConfig.profileName}` : 'Conexão via uazapi'}
              </p>
            </div>
          </div>
          {instanceConfig?.instanceToken && <StatusBadge status={currentStatus} />}
        </div>

        {/* Carregando estado inicial */}
        {bootstrapping && (
          <div className="flex items-center justify-center gap-2 py-8">
            <Loader2 className="w-5 h-5 animate-spin text-teal-600" />
            <span className="text-sm text-gray-500">Carregando...</span>
          </div>
        )}

        {/* Sem instância criada — formulário de criação */}
        {!bootstrapping && !instanceConfig?.instanceToken && (
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-800 font-medium mb-1">Nenhuma conexão configurada</p>
              <p className="text-sm text-blue-600">Crie uma nova conexão WhatsApp para começar. Você poderá conectar seu número logo em seguida.</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1.5">Nome da conexão</label>
              <input
                type="text"
                placeholder="Ex: Clínica Dr. Silva"
                value={instanceName}
                onChange={e => setInstanceName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
              <p className="text-sm text-gray-400 mt-1">Apenas para identificação interna.</p>
            </div>

            <button
              onClick={handleCreateInstance}
              disabled={creatingInstance || !instanceName.trim()}
              className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-white bg-teal-700 rounded-lg hover:bg-teal-800 transition disabled:opacity-50"
            >
              {creatingInstance ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Criar conexão
            </button>
          </div>
        )}

        {/* Tem instância e está conectado */}
        {!bootstrapping && instanceConfig?.instanceToken && currentStatus === 'connected' && (
          <div className="space-y-4">
            <div className="bg-green-50 rounded-lg p-4 flex items-center gap-4">
              {profilePicUrl ? (
                <img
                  src={profilePicUrl}
                  alt="Foto de perfil"
                  className="w-12 h-12 rounded-full object-cover border-2 border-green-200 flex-shrink-0"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-green-200 flex items-center justify-center flex-shrink-0">
                  <Wifi className="w-5 h-5 text-green-600" />
                </div>
              )}
              <div>
                {profileName && <p className="text-sm font-medium text-gray-800">{profileName}</p>}
                {phone && <p className="text-sm text-gray-500">{phone}</p>}
                <div className="flex items-center gap-1.5 mt-1">
                  {settingUpWebhook ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin text-yellow-500" />
                      <span className="text-sm text-yellow-600">Configurando...</span>
                    </>
                  ) : webhookConfigured ? (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                      <span className="text-sm text-green-600">Conectado e configurado</span>
                    </>
                  ) : (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
                      <span className="text-sm text-yellow-600">Conectado — webhook pendente</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={handleReset}
                disabled={resetting}
                className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition disabled:opacity-50"
                title="Reinicia a conexão sem perder a sessão"
              >
                {resetting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Reiniciar
              </button>
              <button
                onClick={setupWebhook}
                disabled={settingUpWebhook}
                className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition disabled:opacity-50"
                title="Reconfigura o webhook na uazapi com a URL atual do servidor"
              >
                {settingUpWebhook ? <Loader2 className="w-4 h-4 animate-spin" /> : <Radio className="w-4 h-4" />}
                Reconfigurar Webhook
              </button>
              <button
                onClick={() => setShowConfirmDisconnect(true)}
                disabled={disconnecting}
                className="flex items-center gap-2 px-4 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition disabled:opacity-50"
              >
                {disconnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <WifiOff className="w-4 h-4" />}
                Desconectar
              </button>
            </div>

            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-3">Zona de perigo</p>
              <button
                onClick={() => setShowConfirmDelete(true)}
                disabled={deleting}
                className="flex items-center gap-2 px-4 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition disabled:opacity-50"
              >
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Remover conexão
              </button>
              <p className="text-sm text-gray-400 mt-2">Remove permanentemente esta conexão. Será necessário criar uma nova do zero.</p>
            </div>
          </div>
        )}

        {/* Tem instância mas está desconectado — formulário para conectar */}
        {!bootstrapping && instanceConfig?.instanceToken && currentStatus === 'disconnected' && !connecting && (
          <div className="space-y-4">
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
              <p className="text-sm text-gray-600">Conexão <span className="font-medium">{instanceConfig.profileName}</span> pronta. Escolha como quer conectar:</p>
            </div>

            <div className="flex gap-1 p-1 bg-gray-100 rounded-lg">
              <button
                onClick={() => setConnectMode('qrcode')}
                className={`flex-1 py-1.5 text-sm font-medium rounded-md transition ${
                  connectMode === 'qrcode'
                    ? 'bg-white text-gray-800 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                QR Code
              </button>
              <button
                onClick={() => setConnectMode('paircode')}
                className={`flex-1 py-1.5 text-sm font-medium rounded-md transition ${
                  connectMode === 'paircode'
                    ? 'bg-white text-gray-800 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Código de Pareamento
              </button>
            </div>

            {connectMode === 'paircode' && (
              <input
                type="text"
                placeholder="Número (ex: 5571999999999)"
                value={phoneInput}
                onChange={e => setPhoneInput(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            )}

            <button
              onClick={handleConnect}
              disabled={connectMode === 'paircode' && !phoneInput.trim()}
              className="w-full py-2.5 text-sm font-medium text-white bg-teal-700 rounded-lg hover:bg-teal-800 transition disabled:opacity-50"
            >
              Conectar WhatsApp
            </button>

            <div className="pt-3 border-t border-gray-100">
              <button
                onClick={() => setShowConfirmDelete(true)}
                className="text-sm text-gray-400 hover:text-red-600 transition flex items-center gap-1"
              >
                <Trash2 className="w-3 h-3" />
                Remover esta conexão
              </button>
            </div>
          </div>
        )}

        {/* Conectando — exibe QR ou paircode */}
        {!bootstrapping && instanceConfig?.instanceToken && (connecting || currentStatus === 'connecting') && (
          <div className="space-y-4">
            {qrCode && (
              <div className="flex flex-col items-center gap-3">
                <p className="text-sm text-gray-600">Escaneie o QR code com seu WhatsApp</p>
                <img src={qrCode} alt="QR Code" className="w-56 h-56 rounded-lg border border-gray-200" />
                <p className="text-sm text-gray-400">Expira em 2 minutos</p>
              </div>
            )}

            {pairCode && (
              <div className="flex flex-col items-center gap-3">
                <p className="text-sm text-gray-600">Digite este código no seu WhatsApp</p>
                <div className="px-8 py-4 bg-gray-50 rounded-xl border border-gray-200">
                  <span className="text-3xl font-mono font-bold tracking-widest text-gray-800">
                    {pairCode}
                  </span>
                </div>
                <p className="text-sm text-gray-400">WhatsApp → Aparelhos Conectados → Conectar com número de telefone</p>
                <p className="text-sm text-gray-400">Expira em 5 minutos</p>
              </div>
            )}

            {!qrCode && !pairCode && (
              <div className="flex items-center justify-center gap-2 py-6">
                <Loader2 className="w-5 h-5 animate-spin text-teal-600" />
                <span className="text-sm text-gray-500">Iniciando conexão...</span>
              </div>
            )}

            <div className="flex items-center justify-center gap-2 text-sm text-gray-400">
              <Loader2 className="w-3 h-3 animate-spin" />
              Aguardando confirmação...
            </div>

            <button
              onClick={async () => {
                stopPolling()
                setConnecting(false)
                setQrCode(null)
                setPairCode(null)
                try {
                  await authFetch(`${API_URL}/instance/disconnect`, { method: 'POST' })
                  await fetchStatus()
                } catch { /* ignora erro silencioso ao cancelar */ }
              }}
              className="flex items-center gap-2 mx-auto text-sm text-gray-400 hover:text-gray-600 transition"
            >
              <RotateCcw className="w-3 h-3" />
              Cancelar
            </button>
          </div>
        )}

        {error && (
          <div className="mt-4 flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-red-700 flex-1">{error}</p>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 transition">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Botão para abrir o Drawer */}
      {!bootstrapping && instanceConfig && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setBuilderOpen(true)}
            className="flex items-center gap-2.5 px-5 py-3 bg-gradient-to-r from-teal-600 to-teal-700 hover:from-teal-700 hover:to-teal-800 text-white rounded-xl shadow-sm transition text-sm font-semibold"
          >
            <Wand2 className="w-4 h-4" />
            Construtor de Prompt
          </button>

          {/* Notificação de aplicado */}
          {appliedNotice && (
            <div className="mt-3 flex items-center gap-2 px-4 py-3 bg-green-50 border border-green-200 rounded-xl text-green-700 text-sm font-medium">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              Prompt aplicado com sucesso! Revise abaixo e clique em "Salvar prompt".
            </div>
          )}
        </div>
      )}

      {/* Drawer — Construtor de Prompt */}
      {builderOpen && (
        <>
          {/* Overlay */}
          <div
            className="fixed inset-0 bg-black/30 z-40"
            onClick={() => setBuilderOpen(false)}
          />

          {/* Painel lateral */}
          <div className="fixed top-0 right-0 h-full w-1/2 bg-white z-50 shadow-2xl flex flex-col">

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-teal-600 to-teal-700">
              <div className="flex items-center gap-2.5">
                <Wand2 className="w-4 h-4 text-white" />
                <span className="text-sm font-semibold text-white">Construtor de Prompt</span>
              </div>
              <button onClick={() => setBuilderOpen(false)} className="text-white/70 hover:text-white transition">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Conteúdo com scroll */}
            <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">

              {/* Bloco: Identidade */}
              <div>
                <label className="block text-sm font-semibold text-gray-600 mb-1.5">🎭 Identidade</label>
                <p className="text-sm text-gray-400 mb-2">Descreva quem é a IA, sua personalidade e contexto do negócio.</p>
                <textarea
                  value={blocks.identidade}
                  onChange={e => setBlocks(b => ({ ...b, identidade: e.target.value }))}
                  rows={6}
                  placeholder="Ex: Você é a Lindona, vendedora afetiva da Cabelô em Salvador/BA. Seu tom é descontraído e carinhoso..."
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-teal-500 text-gray-700 leading-relaxed"
                  spellCheck={false}
                />
              </div>

              {/* Bloco: Regras */}
              <div>
                <label className="block text-sm font-semibold text-gray-600 mb-1.5">📋 Regras</label>
                <p className="text-sm text-gray-400 mb-2">O que a IA deve ou não deve fazer.</p>
                <textarea
                  value={blocks.regras}
                  onChange={e => setBlocks(b => ({ ...b, regras: e.target.value }))}
                  rows={6}
                  placeholder="Ex: Nunca fale de concorrentes. Não faça promessas de resultado. Atenda apenas no horário comercial..."
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-teal-500 text-gray-700 leading-relaxed"
                  spellCheck={false}
                />
              </div>

              {/* Bloco: Fluxo de Atendimento */}
              <div>
                <label className="block text-sm font-semibold text-gray-600 mb-1.5">🗺️ Fluxo de Atendimento</label>
                <p className="text-sm text-gray-400 mb-2">O passo a passo da conversa: boas-vindas → qualificação → proposta → fechamento.</p>
                <textarea
                  value={blocks.fluxo}
                  onChange={e => setBlocks(b => ({ ...b, fluxo: e.target.value }))}
                  rows={6}
                  placeholder="Ex: 1. Cumprimente pelo nome. 2. Pergunte se já usa mega hair. 3. Se sim, envie os vídeos. 4. Combine a aplicação..."
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-teal-500 text-gray-700 leading-relaxed"
                  spellCheck={false}
                />
              </div>

              {/* Bloco: Objeções */}
              <div>
                <label className="block text-sm font-semibold text-gray-600 mb-1.5">💬 Objeções Comuns</label>
                <p className="text-sm text-gray-400 mb-2">Como responder "tá caro", "vou pensar", "já tenho" etc.</p>
                <textarea
                  value={blocks.objeccoes}
                  onChange={e => setBlocks(b => ({ ...b, objeccoes: e.target.value }))}
                  rows={6}
                  placeholder={'Ex:\n- "Tá caro": explique o custo-benefício e durabilidade.\n- "Vou pensar": pergunte o que está impedindo a decisão.\n- "Já tenho": pergunte quando foi a última aplicação.'}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-teal-500 text-gray-700 leading-relaxed"
                  spellCheck={false}
                />
              </div>

              {/* Bloco: Exemplos de Conversa */}
              <div>
                <label className="block text-sm font-semibold text-gray-600 mb-1.5">🎯 Exemplos de Conversa</label>
                <p className="text-sm text-gray-400 mb-2">2-3 diálogos modelo (few-shot). O maior impacto na qualidade das respostas.</p>
                <textarea
                  value={blocks.exemplos}
                  onChange={e => setBlocks(b => ({ ...b, exemplos: e.target.value }))}
                  rows={8}
                  placeholder={'Ex:\nCliente: "Oi, vi o anúncio de vocês"\nIA: "Oi linda! Que bom que chegou até nós 🥰 Você já usa mega hair?"\nCliente: "Nunca usei"\nIA: "Ah então vou te mostrar como fica maravilhoso! Olha esses resultados..."'}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-teal-500 text-gray-700 leading-relaxed"
                  spellCheck={false}
                />
              </div>

              {/* Bloco: Produtos / Serviços */}
              <div>
                <label className="block text-sm font-semibold text-gray-600 mb-1.5">🛍️ Produtos / Serviços</label>
                <p className="text-sm text-gray-400 mb-2">Catálogo com nome, preço e descrição. Evita que a IA invente valores.</p>
                <textarea
                  value={blocks.produtos}
                  onChange={e => setBlocks(b => ({ ...b, produtos: e.target.value }))}
                  rows={5}
                  placeholder={'Ex:\n- Mega Hair Liso 60cm: R$ 250 (dura 3-4 meses)\n- Mega Hair Ondulado 50cm: R$ 220\n- Aplicação: R$ 80\n- Manutenção: R$ 60'}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-teal-500 text-gray-700 leading-relaxed"
                  spellCheck={false}
                />
              </div>

              {/* Bloco: Horário */}
              <div>
                <label className="block text-sm font-semibold text-gray-600 mb-1.5">🕐 Horário de Atendimento</label>
                <p className="text-sm text-gray-400 mb-2">Quando responde e o que diz fora do horário.</p>
                <textarea
                  value={blocks.horario}
                  onChange={e => setBlocks(b => ({ ...b, horario: e.target.value }))}
                  rows={3}
                  placeholder="Ex: Atendemos de segunda a sábado, das 9h às 18h. Fora desse horário, informe que retornaremos assim que possível."
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-teal-500 text-gray-700 leading-relaxed"
                  spellCheck={false}
                />
              </div>

              {/* Bloco: Tom e Linguagem */}
              <div>
                <label className="block text-sm font-semibold text-gray-600 mb-1.5">✍️ Tom e Linguagem</label>
                <p className="text-sm text-gray-400 mb-2">Formal ou informal, uso de emojis, tamanho das mensagens.</p>
                <textarea
                  value={blocks.tom}
                  onChange={e => setBlocks(b => ({ ...b, tom: e.target.value }))}
                  rows={3}
                  placeholder="Ex: Tom descontraído e afetivo. Use emojis com moderação. Mensagens curtas (máximo 3 linhas). Nunca use linguagem formal."
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-teal-500 text-gray-700 leading-relaxed"
                  spellCheck={false}
                />
              </div>

              {/* Bloco: Diferenciais */}
              <div>
                <label className="block text-sm font-semibold text-gray-600 mb-1.5">⭐ Diferenciais</label>
                <p className="text-sm text-gray-400 mb-2">O que torna você único? Vantagens competitivas, diferenças do concorrente.</p>
                <textarea
                  value={blocks.diferenciais}
                  onChange={e => setBlocks(b => ({ ...b, diferenciais: e.target.value }))}
                  rows={4}
                  placeholder="Ex: Mega hair 100% natural, dura 4 meses (concorrente dura 2), aplicação em 30 min, sem sujeira, agende online."
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-teal-500 text-gray-700 leading-relaxed"
                  spellCheck={false}
                />
              </div>

              {/* Bloco: Informações Gerais */}
              <div>
                <label className="block text-sm font-semibold text-gray-600 mb-1.5">ℹ️ Informações Gerais</label>
                <p className="text-sm text-gray-400 mb-2">Informações especiais da sua loja que a IA deve conhecer e mencionar quando relevante. Dados únicos que diferenciam o seu negócio.</p>
                <textarea
                  value={blocks.informacoes_gerais}
                  onChange={e => setBlocks(b => ({ ...b, informacoes_gerais: e.target.value }))}
                  rows={4}
                  placeholder="Cole aqui informações únicas da sua loja..."
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-teal-500 text-gray-700 leading-relaxed"
                  spellCheck={false}
                />
              </div>

              {/* Bloco: Guardrails */}
              <div>
                <label className="block text-sm font-semibold text-gray-600 mb-1.5">🛡️ Guardrails</label>
                <p className="text-sm text-gray-400 mb-1">São as <strong className="text-gray-600">barreiras de segurança absolutas</strong> da IA — limites que ela nunca pode cruzar, independente do que o cliente peça. Diferente das Regras (boas práticas), os Guardrails protegem contra manipulação, informações falsas e situações de risco.</p>
                <p className="text-xs text-teal-700 bg-teal-50 rounded-lg px-3 py-2 mb-2">Exemplos: nunca revelar que é uma IA, nunca inventar preços, nunca aceitar pedidos fora do escopo do negócio, nunca continuar se o cliente estiver em situação de emergência.</p>
                <textarea
                  value={blocks.guardrails}
                  onChange={e => setBlocks(b => ({ ...b, guardrails: e.target.value }))}
                  rows={5}
                  placeholder={'Ex:\n- Nunca afirme que é humana. Se perguntada, diga que é uma assistente virtual.\n- Nunca invente preços, prazos ou informações que não estejam no prompt.\n- Nunca aceite pedidos de outros assuntos (política, saúde geral, etc).\n- Se o cliente mencionar emergência, pare tudo e oriente a ligar para serviços de emergência.'}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-teal-500 text-gray-700 leading-relaxed"
                  spellCheck={false}
                />
              </div>

              {/* Bloco: Envio em Lote */}
              <div className="border border-teal-100 rounded-xl p-4 bg-teal-50/40">
                <label className="block text-sm font-semibold text-gray-700 mb-2">🎬 Envio em Lote</label>
                <p className="text-sm text-gray-500 mb-4">Selecione os vídeos, defina o gatilho (o que a cliente vai falar) e insira pronto no prompt. A IA reconhece e envia todos automaticamente.</p>

                {/* Trigger */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-600 mb-2">📝 Quando a cliente disser:</label>
                  <input
                    type="text"
                    value={batchTrigger}
                    onChange={e => setBatchTrigger(e.target.value)}
                    placeholder='Ex: "quero todos os lisos", "me manda os ondulados"'
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white"
                  />
                </div>

                {/* Lista de mídias com checkbox */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-600 mb-2">📹 Selecione os vídeos:</label>
                  <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg bg-white divide-y divide-gray-50">
                    {mediaList.length === 0 ? (
                      <p className="text-sm text-gray-400 text-center py-6">Nenhuma mídia cadastrada.</p>
                    ) : mediaList.map(media => (
                      <label key={media.id} className="flex items-center gap-2.5 px-3 py-3 hover:bg-teal-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={batchSelected.includes(media.name)}
                          onChange={() => toggleBatchVideo(media.name)}
                          className="accent-teal-600 w-4 h-4 flex-shrink-0"
                        />
                        <div className="w-8 h-8 rounded overflow-hidden bg-gray-100 flex-shrink-0 flex items-center justify-center">
                          {media.mimeType?.startsWith('image/') ? (
                            <img src={media.url} alt={media.name} className="w-full h-full object-cover" />
                          ) : (
                            <Play className="w-3.5 h-3.5 text-gray-500" />
                          )}
                        </div>
                        <span className="text-sm text-gray-700 truncate">{media.name}</span>
                      </label>
                    ))}
                  </div>
                  {batchSelected.length > 0 && (
                    <p className="text-sm text-teal-700 font-medium mt-2">✓ {batchSelected.length} vídeo{batchSelected.length > 1 ? 's' : ''} selecionado{batchSelected.length > 1 ? 's' : ''}</p>
                  )}
                </div>

                {/* Preview do snippet */}
                {batchSelected.length > 0 && (
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-600 mb-2">💬 O que será inserido:</label>
                    <pre className="text-sm bg-gray-900 text-green-300 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap leading-relaxed font-mono">{buildBatchSnippet()}</pre>
                    <p className="text-sm text-gray-500 mt-2">
                      <strong>reply:</strong> é a mensagem que a IA vai responder. Você pode customizar (ex: "Aqui estão os lisos mais lindos! 💁‍♀️").
                    </p>
                  </div>
                )}

                <button
                  type="button"
                  disabled={batchSelected.length === 0}
                  onClick={insertBatchSnippet}
                  className="w-full flex items-center justify-center gap-2 py-2 text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Inserir no prompt
                </button>
              </div>
            </div>

            {/* Footer fixo */}
            <div className="px-6 py-4 border-t border-gray-100 flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  const partes = []
                  if (blocks.identidade.trim()) partes.push(`## Identidade\n${blocks.identidade.trim()}`)
                  if (blocks.fluxo.trim()) partes.push(`## Fluxo de Atendimento\n${blocks.fluxo.trim()}`)
                  if (blocks.regras.trim()) partes.push(`## Regras\n${blocks.regras.trim()}`)
                  if (blocks.objeccoes.trim()) partes.push(`## Objeções Comuns\n${blocks.objeccoes.trim()}`)
                  if (blocks.exemplos.trim()) partes.push(`## Exemplos de Conversa\n${blocks.exemplos.trim()}`)
                  if (blocks.produtos.trim()) partes.push(`## Produtos e Serviços\n${blocks.produtos.trim()}`)
                  if (blocks.horario.trim()) partes.push(`## Horário de Atendimento\n${blocks.horario.trim()}`)
                  if (blocks.tom.trim()) partes.push(`## Tom e Linguagem\n${blocks.tom.trim()}`)
                  if (blocks.diferenciais.trim()) partes.push(`## Diferenciais\n${blocks.diferenciais.trim()}`)
                  if (blocks.informacoes_gerais.trim()) partes.push(`## Informações Gerais\n${blocks.informacoes_gerais.trim()}`)
                  if (blocks.guardrails.trim()) partes.push(`## Guardrails\n${blocks.guardrails.trim()}`)
                  if (partes.length === 0) return
                  setCustomPromptMegaHair(partes.join('\n\n'))
                  setBuilderOpen(false)
                  setAppliedNotice(true)
                  setTimeout(() => setAppliedNotice(false), 3000)
                }}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-teal-700 rounded-xl hover:bg-teal-800 transition"
              >
                <CheckCircle2 className="w-4 h-4" />
                Aplicar no prompt oficial
              </button>
              <button
                type="button"
                onClick={() => setBuilderOpen(false)}
                className="px-4 py-2.5 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-xl hover:bg-gray-50 transition"
              >
                Cancelar
              </button>
            </div>
          </div>
        </>
      )}

      {/* Card multi-agente — rollout controlado (localhost + conta beta) */}
      {!bootstrapping && instanceConfig && canSeeMultiAgent && (
        <MultiAgentToggleCard config={instanceConfig} onSaved={fetchConfig} />
      )}

      {/* Card de teste do monólito com contador de token — mesma conta beta, escondido pra cliente real */}
      {!bootstrapping && instanceConfig && canSeeMultiAgent && canSeeTestPanel && (
        <MonolithTestCard />
      )}

      {/* Card palavra de desativação da IA */}
      {!bootstrapping && instanceConfig && (
        <DeactivationKeywordCard config={instanceConfig} onSaved={fetchConfig} />
      )}

      {/* Card palavra de ativação da IA */}
      {!bootstrapping && instanceConfig && (
        <ActivationKeywordCard config={instanceConfig} onSaved={fetchConfig} />
      )}

      {/* Card de prompt customizado */}
      {!bootstrapping && instanceConfig && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mt-4">
          <h2 className="text-sm font-semibold text-gray-800 mb-1">Prompt da Lindona (Mega Hair)</h2>
          <p className="text-sm text-gray-500 mb-4">Personalize o comportamento da Lindona (personalidade, fluxo, regras). Datas, mídias disponíveis e formato técnico de resposta são adicionados automaticamente pelo sistema.</p>

          <div className="flex gap-4">
            {/* Coluna esquerda: editor do prompt */}
            <div className="flex-1 min-w-0">
              {/* Barra de busca */}
              <div className="flex items-center gap-2 mb-2">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={e => { setSearchTerm(e.target.value); setSearchIndex(0) }}
                    onKeyDown={e => { if (e.key === 'Enter') navigateSearch(e.shiftKey ? -1 : 1) }}
                    placeholder="Buscar no prompt..."
                    className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white text-gray-800 placeholder-gray-400"
                  />
                </div>
                {searchTerm && (() => {
                  const total = searchOccurrences(searchTerm, customPromptMegaHair).length
                  return (
                    <>
                      <span className="text-sm text-gray-600 font-medium whitespace-nowrap">
                        {total === 0 ? 'Não encontrado' : `${searchIndex + 1}/${total}`}
                      </span>
                      <button onClick={() => navigateSearch(-1)} disabled={total === 0} className="p-1 rounded hover:bg-teal-50 disabled:opacity-30 transition">
                        <ChevronUp className="w-3.5 h-3.5 text-teal-600" />
                      </button>
                      <button onClick={() => navigateSearch(1)} disabled={total === 0} className="p-1 rounded hover:bg-teal-50 disabled:opacity-30 transition">
                        <ChevronDown className="w-3.5 h-3.5 text-teal-600" />
                      </button>
                      <button onClick={() => setSearchTerm('')} className="p-1 rounded hover:bg-gray-100 transition">
                        <X className="w-3.5 h-3.5 text-gray-500" />
                      </button>
                    </>
                  )
                })()}
              </div>
              <div className="relative">
                {/* Overlay de highlight */}
                {searchTerm && (() => {
                  const positions = searchOccurrences(searchTerm, customPromptMegaHair)
                  if (positions.length === 0) return null
                  const parts = []
                  let lastEnd = 0
                  positions.forEach((start, idx) => {
                    const end = start + searchTerm.length
                    parts.push({
                      type: 'text',
                      content: customPromptMegaHair.slice(lastEnd, start),
                      isHighlight: false,
                    })
                    parts.push({
                      type: 'text',
                      content: customPromptMegaHair.slice(start, end),
                      isHighlight: idx === searchIndex,
                    })
                    lastEnd = end
                  })
                  parts.push({
                    type: 'text',
                    content: customPromptMegaHair.slice(lastEnd),
                    isHighlight: false,
                  })
                  return (
                    <pre
                      className="absolute inset-0 w-full h-80 text-sm font-mono p-3 border border-transparent resize-none pointer-events-none whitespace-pre-wrap break-words overflow-hidden rounded-lg leading-relaxed"
                      style={{ color: 'transparent' }}
                    >
                      {parts.map((part, idx) =>
                        part.isHighlight ? (
                          <span key={idx} className="bg-yellow-300">{part.content}</span>
                        ) : (
                          part.content
                        )
                      )}
                    </pre>
                  )
                })()}
                {/* Textarea sobre o overlay (fundo transparente pra deixar o highlight aparecer) */}
                <textarea
                  ref={promptRef}
                  value={customPromptMegaHair}
                  onChange={e => setCustomPromptMegaHair(e.target.value)}
                  onScroll={e => {
                    const preEl = promptRef.current?.parentElement?.querySelector('pre')
                    if (preEl) preEl.scrollTop = e.target.scrollTop
                  }}
                  className="relative w-full h-80 text-sm font-mono border border-gray-200 rounded-lg p-3 resize-none focus:outline-none focus:ring-2 focus:ring-teal-500 text-gray-700 leading-relaxed bg-transparent"
                  placeholder="Digite o prompt da IA aqui..."
                  spellCheck={false}
                />
              </div>
            </div>

            {/* Coluna direita: mídias disponíveis (clique para inserir o nome no prompt) */}
            <div className="w-56 flex-shrink-0">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-gray-600">Suas mídias</p>
                <span className="text-sm text-gray-400">clique p/ inserir</span>
              </div>
              <div className="h-80 overflow-y-auto border border-gray-200 rounded-lg p-2 space-y-1 bg-gray-50">
                {mediaList.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-6 px-2">
                    Nenhuma mídia cadastrada. Faça upload na página Mídias.
                  </p>
                ) : (
                  mediaList.map(media => (
                    <button
                      key={media.id}
                      type="button"
                      onClick={() => insertMediaName(media.name)}
                      title={`Inserir "${media.name}" no prompt`}
                      className="w-full flex items-center gap-2 p-1.5 rounded-lg hover:bg-teal-50 hover:border-teal-200 border border-transparent transition text-left group"
                    >
                      <div className="w-9 h-9 rounded-md overflow-hidden bg-gray-200 flex-shrink-0 flex items-center justify-center">
                        {media.mimeType?.startsWith('image/') ? (
                          <img src={media.url} alt={media.name} className="w-full h-full object-cover" />
                        ) : media.mimeType?.startsWith('video/') ? (
                          <div className="w-full h-full flex items-center justify-center bg-gray-800">
                            <Play className="w-3.5 h-3.5 text-white" />
                          </div>
                        ) : (
                          <ImageIcon className="w-3.5 h-3.5 text-gray-400" />
                        )}
                      </div>
                      <span className="text-sm text-gray-700 truncate flex-1 group-hover:text-teal-700">{media.name}</span>
                      <Plus className="w-3 h-3 text-gray-300 group-hover:text-teal-500 flex-shrink-0" />
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 mt-3">
            <button
              onClick={async () => {
                setSavingPrompt(true)
                setPromptSaved(false)
                try {
                  await authFetch(`${API_URL}/instance/config`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ customPromptMegaHair: customPromptMegaHair.trim() || null }),
                  })
                  setPromptSaved(true)
                  setTimeout(() => setPromptSaved(false), 2500)
                } finally {
                  setSavingPrompt(false)
                }
              }}
              disabled={savingPrompt}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-teal-700 rounded-lg hover:bg-teal-800 transition disabled:opacity-50"
            >
              {savingPrompt ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {savingPrompt ? 'Salvando...' : 'Salvar prompt'}
            </button>
            {promptSaved && <span className="text-sm text-green-600 font-medium">✓ Prompt salvo</span>}
          </div>
        </div>
      )}


      {showConfirmDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-80 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-800">Remover conexão?</h3>
                <p className="text-sm text-gray-500 mt-0.5">Esta ação não pode ser desfeita. Você precisará criar uma nova conexão do zero.</p>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setShowConfirmDelete(false)}
                className="flex-1 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition"
              >
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition"
              >
                Remover
              </button>
            </div>
          </div>
        </div>
      )}

      {showConfirmDisconnect && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-80 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
                <WifiOff className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-800">Desconectar WhatsApp?</h3>
                <p className="text-sm text-gray-500 mt-0.5">Será necessário escanear o QR code novamente para reconectar.</p>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setShowConfirmDisconnect(false)}
                className="flex-1 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition"
              >
                Cancelar
              </button>
              <button
                onClick={handleDisconnect}
                className="flex-1 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition"
              >
                Desconectar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
