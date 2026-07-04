import { useState, useEffect, useRef } from 'react'
import {
  DndContext, DragOverlay, useDraggable, useDroppable, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  Bot, Sparkles, Plus, X, Pencil, Trash2, Play, Loader2, GripVertical,
  Workflow, Star, ArrowRight, MessageSquare, ArrowRightLeft, Send, RotateCcw,
} from 'lucide-react'
import { authFetch } from '../services/api'
import { useAuth } from '../context/AuthContext'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

const emptyAgent = {
  name: '',
  description: '',
  respondsTo: '',
  handoffWhen: '',
  systemPrompt: '',
  isDefault: false,
  canSchedule: true,
  canSendMedia: true,
}

// ───────────────────────── Modal de edição do agente ─────────────────────────
function AgentModal({ agent, onSave, onClose }) {
  const [form, setForm] = useState({ ...emptyAgent, ...(agent ?? {}) })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Dê um nome ao agente'); return }
    if (!form.description.trim()) { setError('Descreva o que esse agente faz (o supervisor usa isso pra rotear)'); return }
    setSaving(true)
    setError('')
    try {
      const method = agent ? 'PATCH' : 'POST'
      const url = agent ? `${API_URL}/agents/${agent.id}` : `${API_URL}/agents`
      const res = await authFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      onSave(data)
    } catch {
      setError('Erro ao salvar agente')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Bot className="w-4 h-4 text-teal-600" />
            <h2 className="text-sm font-semibold text-gray-800">{agent ? 'Editar agente' : 'Novo agente'}</h2>
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
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500"
                  placeholder="Ex: Vendas, Suporte, Agendamento"
                />
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-xs font-medium text-gray-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form.isDefault}
                    onChange={(e) => setForm((f) => ({ ...f, isDefault: e.target.checked }))}
                    className="w-4 h-4 accent-teal-600"
                  />
                  <Star className="w-3.5 h-3.5 text-amber-500" />
                  Agente de entrada (recebe a 1ª mensagem)
                </label>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                O que esse agente faz <span className="text-gray-400">(o supervisor usa pra decidir o roteamento)</span> *
              </label>
              <input
                value={form.description}
                onChange={set('description')}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500"
                placeholder="Ex: Cuida de preços, catálogo e fechamento de venda"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Responde sobre</label>
                <textarea
                  value={form.respondsTo}
                  onChange={set('respondsTo')}
                  rows={3}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
                  placeholder={'preço\ncatálogo\nagendamento'}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Passa o bastão quando</label>
                <textarea
                  value={form.handoffWhen}
                  onChange={set('handoffWhen')}
                  rows={3}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
                  placeholder={'dúvida técnica\nreclamação / suporte'}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Capacidades <span className="text-gray-400">(desligar economiza tokens — não injeta as regras no prompt)</span>
              </label>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-xs font-medium text-gray-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form.canSchedule !== false}
                    onChange={(e) => setForm((f) => ({ ...f, canSchedule: e.target.checked }))}
                    className="w-4 h-4 accent-teal-600"
                  />
                  Agenda consultas (tabela de datas + regras de agendamento)
                </label>
                <label className="flex items-center gap-2 text-xs font-medium text-gray-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form.canSendMedia !== false}
                    onChange={(e) => setForm((f) => ({ ...f, canSendMedia: e.target.checked }))}
                    className="w-4 h-4 accent-teal-600"
                  />
                  Envia mídias/vídeos (catálogo + regras de envio)
                </label>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Prompt / comportamento</label>
              <textarea
                value={form.systemPrompt}
                onChange={set('systemPrompt')}
                rows={8}
                className="w-full text-sm font-mono border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
                placeholder="Como esse agente conversa, tom, regras específicas..."
                spellCheck={false}
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-teal-700 rounded-lg hover:bg-teal-800 transition disabled:opacity-50">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {saving ? 'Salvando...' : 'Salvar agente'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ───────────────────────── Card visual reutilizável (palette + overlay) ─────────────────────────
function AgentCard({ agent, floating = false }) {
  return (
    <div className={`flex items-center gap-2 px-3 py-2.5 bg-white border rounded-lg transition ${
      floating
        ? 'border-teal-400 shadow-2xl scale-105 cursor-grabbing ring-2 ring-teal-200 rotate-1'
        : 'border-gray-200'
    }`}>
      <GripVertical className="w-4 h-4 text-gray-300 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-800 truncate">{agent.name}</p>
        <p className="text-xs text-gray-400 truncate">{agent.description || 'sem descrição'}</p>
      </div>
      {agent.isDefault && <Star className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />}
    </div>
  )
}

// ───────────────────────── Chip arrastável (palette) ─────────────────────────
function PaletteAgent({ agent, onEdit }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `palette-${agent.id}`, data: { agent } })
  return (
    <div ref={setNodeRef} className="relative group">
      <div
        {...attributes}
        {...listeners}
        className={`transition ${isDragging ? 'opacity-30' : 'hover:shadow-sm cursor-grab active:cursor-grabbing'}`}
      >
        <AgentCard agent={agent} />
      </div>
      <button
        onClick={() => onEdit(agent)}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-gray-300 hover:text-teal-600 hover:bg-teal-50 transition opacity-0 group-hover:opacity-100"
      >
        <Pencil className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

// ───────────────────────── Nó do agente no canvas ─────────────────────────
function CanvasAgent({ agent, highlight, onEdit, onDetach }) {
  const isEntry = agent.isDefault
  return (
    <div
      onClick={() => onEdit(agent)}
      className={`group relative w-52 bg-white rounded-xl border-2 px-4 py-3 cursor-pointer transition shadow-sm hover:shadow-md ${
        highlight
          ? 'border-teal-500 ring-4 ring-teal-100'
          : isEntry
            ? 'border-amber-400 hover:border-amber-500'
            : 'border-gray-200 hover:border-teal-300'
      }`}
    >
      {/* Badge "Entrada" no agente de entrada */}
      {isEntry && (
        <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-amber-400 text-white text-[9px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap shadow-sm">
          <Star className="w-2.5 h-2.5" /> ENTRADA
        </div>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); onDetach(agent) }}
        className="absolute -top-2 -right-2 w-5 h-5 bg-white border border-gray-200 rounded-full flex items-center justify-center text-gray-400 opacity-0 group-hover:opacity-100 hover:text-red-600 hover:border-red-200 transition"
        title="Desconectar do supervisor"
      >
        <X className="w-3 h-3" />
      </button>
      <div className="flex items-start gap-1.5 mb-1">
        <Bot className={`w-4 h-4 flex-shrink-0 mt-0.5 ${isEntry ? 'text-amber-500' : 'text-teal-600'}`} />
        <p className="text-sm font-semibold text-gray-800 leading-tight line-clamp-2">{agent.name}</p>
      </div>
      <p className="text-xs text-gray-500 line-clamp-2 leading-snug">{agent.description || 'sem descrição'}</p>
    </div>
  )
}

// ───────────────────────── Zona do canvas (droppable) ─────────────────────────
function Canvas({ connected, highlightId, onEdit, onDetach }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'canvas' })
  return (
    <div
      ref={setNodeRef}
      className={`relative flex-1 rounded-xl border-2 border-dashed transition overflow-auto ${
        isOver ? 'border-teal-400 bg-teal-50/40' : 'border-gray-200 bg-gray-50/60'
      }`}
    >
      <div className="min-h-full flex flex-col items-center py-10 px-6">
        {/* Supervisor */}
        <div className="relative w-56 rounded-2xl px-5 py-4 text-white shadow-lg bg-gradient-to-br from-teal-600 to-teal-700">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
              <Workflow className="w-4.5 h-4.5" />
            </div>
            <div>
              <p className="text-sm font-bold leading-tight">Supervisor</p>
              <p className="text-[11px] text-teal-100">Roteador inteligente</p>
            </div>
          </div>
          <p className="text-[11px] text-teal-100/90 mt-2 leading-snug">
            Decide qual agente responde com base no que cada um faz.
          </p>
        </div>

        {connected.length === 0 ? (
          <>
            <div className="h-10 w-px bg-gray-300 my-1" />
            <div className="text-center text-gray-400 mt-4">
              <ArrowRight className="w-5 h-5 mx-auto mb-2 rotate-90 opacity-40" />
              <p className="text-sm">Arraste um agente pra cá</p>
              <p className="text-xs mt-0.5">pra conectá-lo ao supervisor</p>
            </div>
          </>
        ) : (
          <>
            {/* linha vertical do supervisor */}
            <div className="h-8 w-px bg-gray-300" />
            {/* barramento horizontal + droplines — 1 linha só (sem wrap). Cards têm largura fixa
                (w-52=208px) então o barramento pode ser calculado exatamente do centro do 1º ao
                centro do último, sem "sobrar" linha órfã. Sem overflow próprio aqui — se não
                couber, quem rola é o Canvas inteiro (overflow-auto lá em cima), então a barra de
                scroll aparece no rodapé do painel, não flutuando embaixo da fileira de cards. */}
            <div className="relative inline-block">
              {connected.length > 1 && (
                <div className="absolute top-0 h-px bg-gray-300" style={{ left: 104, right: 104 }} />
              )}
              <div className="flex items-start gap-6 pt-0 w-max">
                {connected.map((a) => (
                  <div key={a.id} className="flex flex-col items-center flex-shrink-0 w-52">
                    <div className={`h-8 w-px ${a.isDefault ? 'bg-amber-400' : 'bg-gray-300'}`} />
                    <CanvasAgent
                      agent={a}
                      highlight={highlightId === a.id}
                      onEdit={onEdit}
                      onDetach={onDetach}
                    />
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ───────────────────────── Painel de chat simulado ─────────────────────────
function TestPanel({ open, onClose, connected }) {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState([]) // { type: 'user'|'agent'|'transfer', text, agentName, meta }
  const [currentAgentId, setCurrentAgentId] = useState(null)
  const [currentAgentName, setCurrentAgentName] = useState(null)
  const [aiContext, setAiContext] = useState([])
  const [loading, setLoading] = useState(false)
  const [tokenTotals, setTokenTotals] = useState({ inputTokens: 0, cachedTokens: 0, outputTokens: 0 })
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  function reset() {
    setMessages([])
    setCurrentAgentId(null)
    setCurrentAgentName(null)
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
      const res = await authFetch(`${API_URL}/agents/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, currentAgentId, aiContext }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message || 'erro')

      // Se houve handoff, mostra mensagem de transferência antes da resposta
      if (data.handoffOccurred && data.transferredFrom) {
        setMessages((prev) => [...prev, {
          type: 'transfer',
          text: `Transferido de ${data.transferredFrom} para ${data.agentName}`,
          agentName: data.agentName,
        }])
      }

      setMessages((prev) => [...prev, {
        type: 'agent',
        text: data.reply,
        agentName: data.agentName,
        meta: { stage: data.stage, temperature: data.temperature, action: data.action, mediaName: data.mediaName, tags: data.tags },
      }])
      setCurrentAgentId(data.agentId)
      setCurrentAgentName(data.agentName)
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
            <h2 className="text-sm font-semibold text-gray-800">Simulação de conversa</h2>
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

        {/* Agente atual */}
        <div className={`px-4 py-2 border-b text-xs flex items-center gap-2 transition-colors ${
          currentAgentName ? 'bg-teal-50 border-teal-100 text-teal-700' : 'bg-gray-50 border-gray-100 text-gray-400'
        }`}>
          <Bot className="w-3.5 h-3.5 flex-shrink-0" />
          {currentAgentName
            ? <span>Atendendo: <strong>{currentAgentName}</strong></span>
            : <span>Supervisor vai escolher o agente na 1ª mensagem</span>
          }
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
              <p className="text-xs text-center">Manda uma mensagem pra iniciar a simulação.<br/>O supervisor vai escolher o agente.</p>
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
            if (msg.type === 'transfer') return (
              <div key={i} className="flex items-center gap-2 justify-center py-1">
                <ArrowRightLeft className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                <span className="text-[11px] text-amber-600 font-medium bg-amber-50 border border-amber-100 px-3 py-1 rounded-full">
                  {msg.text}
                </span>
              </div>
            )
            if (msg.type === 'error') return (
              <div key={i} className="text-xs text-red-500 text-center">{msg.text}</div>
            )
            // agent
            return (
              <div key={i} className="flex flex-col gap-1">
                <span className="text-[10px] text-gray-400 ml-1">{msg.agentName}</span>
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
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-gray-400 ml-1">{currentAgentName ?? 'Agente'}</span>
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
          {connected.length === 0
            ? <p className="text-xs text-gray-400 text-center">Conecte ao menos um agente ao supervisor</p>
            : (
              <div className="flex gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                  disabled={loading}
                  className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-50"
                  placeholder="Digite uma mensagem..."
                />
                <button
                  onClick={sendMessage}
                  disabled={loading || !input.trim()}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-teal-700 rounded-xl hover:bg-teal-800 transition disabled:opacity-50"
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

// ───────────────────────── Página ─────────────────────────
export default function AgentBuilderPage() {
  const { user } = useAuth()
  const [agents, setAgents] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [testOpen, setTestOpen] = useState(false)
  const [draggingAgent, setDraggingAgent] = useState(null)
  const justConnected = useRef(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  useEffect(() => {
    authFetch(`${API_URL}/agents`)
      .then((r) => r.json())
      .then((data) => setAgents(Array.isArray(data) ? data : []))
      .catch(() => setAgents([]))
      .finally(() => setLoading(false))
  }, [])

  const connected = agents.filter((a) => a.isActive).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
  const detached = agents.filter((a) => !a.isActive)

  function upsert(saved) {
    setAgents((prev) => {
      const idx = prev.findIndex((a) => a.id === saved.id)
      if (idx >= 0) { const next = [...prev]; next[idx] = saved; return next }
      return [...prev, saved]
    })
  }

  async function patchAgent(id, body) {
    const res = await authFetch(`${API_URL}/agents/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    upsert(data)
    return data
  }

  function handleDragStart(event) {
    const agent = event.active.data?.current?.agent
    if (agent) setDraggingAgent(agent)
  }

  function handleDragEnd(event) {
    setDraggingAgent(null)
    const { active, over } = event
    if (!over) return
    if (over.id === 'canvas' && String(active.id).startsWith('palette-')) {
      const agent = active.data?.current?.agent
      if (agent && !agent.isActive) {
        justConnected.current = agent.id
        setTimeout(() => { justConnected.current = null }, 1200)
        patchAgent(agent.id, { isActive: true })
      }
    }
  }

  async function handleDelete(id) {
    await authFetch(`${API_URL}/agents/${id}`, { method: 'DELETE' })
    setAgents((prev) => prev.filter((a) => a.id !== id))
    setConfirmDelete(null)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-white">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-teal-600" />
          <h1 className="text-lg font-bold text-gray-800">Construtor de Agentes</h1>
          <span className="text-xs bg-teal-50 text-teal-700 px-2 py-0.5 rounded-full">{connected.length} conectados</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTestOpen(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-teal-700 border border-teal-200 rounded-lg hover:bg-teal-50 transition"
          >
            <Play className="w-4 h-4" /> Testar
          </button>
          <button
            onClick={() => { setEditing(null); setModalOpen(true) }}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-teal-700 rounded-lg hover:bg-teal-800 transition"
          >
            <Plus className="w-4 h-4" /> Novo agente
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex justify-center items-center">
          <Loader2 className="w-6 h-6 text-teal-600 animate-spin" />
        </div>
      ) : (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="flex-1 flex gap-4 p-4 min-h-0">
            {/* Palette */}
            <aside className="w-64 flex flex-col bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <p className="text-sm font-semibold text-gray-800">Agentes disponíveis</p>
                <p className="text-xs text-gray-400 mt-0.5">Arraste para o canvas pra conectar</p>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {detached.length === 0 ? (
                  <div className="text-center text-gray-300 py-8">
                    <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="text-xs">Todos os agentes estão conectados</p>
                  </div>
                ) : (
                  detached.map((a) => (
                    <div key={a.id} className="relative group">
                      <PaletteAgent agent={a} onEdit={(ag) => { setEditing(ag); setModalOpen(true) }} />
                      <button
                        onClick={() => setConfirmDelete(a)}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-white border border-gray-200 rounded-full items-center justify-center text-gray-300 hidden group-hover:flex hover:text-red-600 transition"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))
                )}
              </div>
              <button
                onClick={() => { setEditing(null); setModalOpen(true) }}
                className="m-3 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-teal-700 border border-dashed border-teal-300 rounded-lg hover:bg-teal-50 transition"
              >
                <Plus className="w-4 h-4" /> Novo agente
              </button>
            </aside>

            {/* Canvas */}
            <Canvas
              connected={connected}
              highlightId={justConnected.current}
              onEdit={(a) => { setEditing(a); setModalOpen(true) }}
              onDetach={(a) => patchAgent(a.id, { isActive: false })}
            />
          </div>

          {/* Card flutuante que segue o cursor durante o arraste */}
          <DragOverlay dropAnimation={{ duration: 150, easing: 'ease-out' }}>
            {draggingAgent ? <AgentCard agent={draggingAgent} floating /> : null}
          </DragOverlay>
        </DndContext>
      )}

      {modalOpen && (
        <AgentModal
          agent={editing}
          onSave={(saved) => { upsert(saved); setModalOpen(false); setEditing(null) }}
          onClose={() => { setModalOpen(false); setEditing(null) }}
        />
      )}

      <TestPanel open={testOpen} onClose={() => setTestOpen(false)} connected={connected} />

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-80 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-800">Excluir agente?</p>
                <p className="text-xs text-gray-500 mt-0.5">"{confirmDelete.name}" será removido permanentemente.</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDelete(null)} className="flex-1 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition">Cancelar</button>
              <button onClick={() => handleDelete(confirmDelete.id)} className="flex-1 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition">Excluir</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
