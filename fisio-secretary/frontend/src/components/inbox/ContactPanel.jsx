import { useEffect, useRef, useState } from 'react'
import { X, Bot, Tag, FileText, Check, Pencil, Loader2, Clock, ExternalLink, LayoutDashboard } from 'lucide-react'
import { Avatar } from './ConversationList'
import { formatPhoneBR } from '../../utils/chatMessages'
import { displayPhone } from '../../hooks/useDemoMode'
import { updateName, updateObservations, removeLabel } from '../../services/api'

function Section({ title, icon, children }) {
  return (
    <div className="px-5 py-4 border-b border-gray-100">
      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">{icon} {title}</p>
      {children}
    </div>
  )
}

export default function ContactPanel({ lead, aiEnabled, onToggleAi, onStageChange, onLeadChange, onOpenDetails, onClose, columns, demoMode, className = '' }) {
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState(lead.name ?? '')
  const [nameSaving, setNameSaving] = useState(false)
  const [observations, setObservations] = useState(lead.observations ?? '')
  const [obsStatus, setObsStatus] = useState('idle')
  const obsInitial = useRef(lead.observations ?? '')

  useEffect(() => {
    setNameValue(lead.name ?? '')
    setObservations(lead.observations ?? '')
    obsInitial.current = lead.observations ?? ''
    setObsStatus('idle')
  }, [lead.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function saveName() {
    const trimmed = nameValue.trim()
    setEditingName(false)
    if (!trimmed || trimmed === lead.name) { setNameValue(lead.name ?? ''); return }
    setNameSaving(true)
    try {
      await updateName(lead.id, trimmed)
      onLeadChange({ ...lead, name: trimmed })
    } catch {
      setNameValue(lead.name ?? '')
    } finally {
      setNameSaving(false)
    }
  }

  async function saveObservations() {
    if (observations === obsInitial.current) return
    setObsStatus('saving')
    try {
      await updateObservations(lead.id, observations)
      obsInitial.current = observations
      onLeadChange({ ...lead, observations })
      setObsStatus('saved')
      setTimeout(() => setObsStatus('idle'), 2000)
    } catch {
      setObsStatus('idle')
    }
  }

  async function handleRemoveLabel(label) {
    const before = lead.labels ?? []
    onLeadChange({ ...lead, labels: before.filter(l => l !== label) })
    try {
      await removeLabel(lead.id, label)
    } catch {
      onLeadChange({ ...lead, labels: before })
    }
  }

  const labels = lead.labels ?? []

  return (
    <aside className={`flex-1 min-w-0 lg:flex-none lg:w-[340px] bg-white border-l border-gray-200 flex flex-col min-h-0 ${className}`}>
      <div className="h-16 shrink-0 px-4 flex items-center gap-3 border-b border-gray-100">
        <button onClick={onClose} className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-full" title="Fechar"><X className="w-5 h-5" /></button>
        <span className="text-sm font-semibold text-gray-700">Dados do contato</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col items-center text-center gap-2 px-5 py-6 border-b border-gray-100">
          <Avatar name={lead.name} phone={lead.phone} url={lead.avatarUrl} size="w-24 h-24" text="text-2xl" />
          {editingName ? (
            <input
              autoFocus
              value={nameValue}
              onChange={e => setNameValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { setEditingName(false); setNameValue(lead.name ?? '') } }}
              onBlur={saveName}
              className="text-base font-semibold text-gray-800 text-center border-b border-teal-500 outline-none w-full"
            />
          ) : (
            <button onClick={() => setEditingName(true)} className="group flex items-center gap-1.5">
              <span className="text-base font-semibold text-gray-800">{lead.name || 'Sem nome'}</span>
              {nameSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-500" /> : <Pencil className="w-3.5 h-3.5 text-gray-300 group-hover:text-teal-600" />}
            </button>
          )}
          <p className="text-sm text-gray-500">{displayPhone(formatPhoneBR(lead.phone), demoMode)}</p>
        </div>

        <Section title="Raia no Kanban" icon={<LayoutDashboard className="w-3 h-3" />}>
          <select
            value={lead.stage}
            onChange={e => onStageChange(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700"
          >
            {columns.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>)}
          </select>
        </Section>

        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700 flex items-center gap-2"><Bot className="w-4 h-4 text-sky-600" /> IA atendendo</span>
          <button
            onClick={() => onToggleAi(!aiEnabled)}
            className={`w-11 h-6 rounded-full transition-colors relative ${aiEnabled ? 'bg-teal-600' : 'bg-gray-300'}`}
            title={aiEnabled ? 'Desligar a IA' : 'Ligar a IA'}
          >
            <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${aiEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
        </div>

        {lead.appointmentAt && (
          <Section title="Agendamento" icon={<Clock className="w-3 h-3" />}>
            <p className="text-sm font-semibold text-teal-700">{new Date(lead.appointmentAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</p>
          </Section>
        )}

        {labels.length > 0 && (
          <Section title="Etiquetas" icon={<Tag className="w-3 h-3" />}>
            <div className="flex flex-wrap gap-1.5">
              {labels.map(label => (
                <span key={label} className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border bg-gray-50 text-gray-600 border-gray-200">
                  {label}
                  <button onClick={() => handleRemoveLabel(label)} className="hover:text-red-500" title="Remover etiqueta"><X className="w-3 h-3" /></button>
                </span>
              ))}
            </div>
          </Section>
        )}

        <Section
          title={<>Observações {obsStatus === 'saving' && <span className="normal-case font-normal text-gray-400 ml-1">salvando…</span>}{obsStatus === 'saved' && <span className="normal-case font-normal text-green-600 ml-1 inline-flex items-center gap-0.5"><Check className="w-3 h-3" /> salvo</span>}</>}
          icon={<FileText className="w-3 h-3" />}
        >
          <textarea
            value={observations}
            onChange={e => setObservations(e.target.value)}
            onBlur={saveObservations}
            placeholder="Anotações da equipe (ex: retornar segunda, aguardando pagamento...)"
            rows={4}
            className="w-full text-sm bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none placeholder:text-amber-400/80 text-gray-700"
          />
        </Section>

        <div className="px-5 py-4">
          <button
            onClick={onOpenDetails}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition"
          >
            <ExternalLink className="w-4 h-4" /> Ficha completa (follow-up, histórico)
          </button>
        </div>
      </div>
    </aside>
  )
}
