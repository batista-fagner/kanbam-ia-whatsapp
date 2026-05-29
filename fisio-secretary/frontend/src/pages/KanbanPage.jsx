import { useState, useRef } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core'
import { Wifi, Users, Flame, CalendarCheck, ShoppingBag, Search, X } from 'lucide-react'

import { COLUMNS } from '../data/mockData'
import { useLeads } from '../hooks/useLeads'
import { updateStage, deleteLead } from '../services/api'
import KanbanColumn from '../components/KanbanColumn'
import LeadCard from '../components/LeadCard'
import LeadModal from '../components/LeadModal'
import ConfirmDeleteModal from '../components/ConfirmDeleteModal'

export default function KanbanPage() {
  const { leads, setLeads, loading } = useLeads()
  const [activeId, setActiveId] = useState(null)
  const [selectedLead, setSelectedLead] = useState(null)
  const [leadToDelete, setLeadToDelete] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const searchRef = useRef(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const activeLead = leads.find(l => l.id === activeId)

  function handleDragStart({ active }) {
    setActiveId(active.id)
  }

  async function handleDeleteConfirmed(reason) {
    if (!leadToDelete) return
    const id = leadToDelete.id
    setLeads(prev => prev.filter(l => l.id !== id))
    setLeadToDelete(null)
    await deleteLead(id, reason)
  }

  function handleLeadUpdate(updatedLead) {
    setLeads(prev => prev.map(l => l.id === updatedLead.id ? updatedLead : l))
    if (selectedLead?.id === updatedLead.id) {
      setSelectedLead(updatedLead)
    }
  }

  async function handleDragEnd({ active, over }) {
    setActiveId(null)
    if (!over) return
    const columnIds = COLUMNS.map(c => c.id)
    if (!columnIds.includes(over.id)) return
    const lead = leads.find(l => l.id === active.id)
    if (!lead || lead.stage === over.id) return

    // Otimista: atualiza localmente antes da resposta
    setLeads(prev => prev.map(l => l.id === active.id ? { ...l, stage: over.id } : l))
    await updateStage(active.id, over.id)
  }

  const total   = leads.length
  const quentes = leads.filter(l => l.stage === 'lead_quente').length
  const agend   = leads.filter(l => l.stage === 'agendado').length
  const vendas  = leads.filter(l => l.stage === 'vendas').length

  const searchTrim = searchQuery.trim()
  const searchNorm = searchTrim.replace(/\D/g, '')
  const matchedLead = searchTrim
    ? leads.find(l => {
        const phone = (l.phone ?? '').replace(/\D/g, '')
        const name  = (l.name ?? '').toLowerCase()
        const byPhone = searchNorm.length > 0 && phone.includes(searchNorm)
        const byName  = searchTrim.length > 0 && name.includes(searchTrim.toLowerCase())
        return byPhone || byName
      })
    : null
  const matchedColumn = matchedLead ? COLUMNS.find(c => c.id === matchedLead.stage) : null

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">Carregando leads...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {/* Stats Header */}
      <header className="bg-white border-b border-gray-100 shadow-sm sticky top-0 z-30">
        <div className="px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <Stat icon={<Wifi className="w-3.5 h-3.5 text-green-500" />} label="WhatsApp" value="Conectado" valueClass="text-green-600" />
            <Stat icon={<Users className="w-3.5 h-3.5 text-blue-500" />} label="Total" value={total} />
            <Stat icon={<Flame className="w-3.5 h-3.5 text-orange-500" />} label="Quentes" value={quentes} valueClass="text-orange-600" />
            <Stat icon={<CalendarCheck className="w-3.5 h-3.5 text-teal-500" />} label="Agendadas" value={agend} valueClass="text-teal-600" />
            <Stat icon={<ShoppingBag className="w-3.5 h-3.5 text-green-600" />} label="Vendas" value={vendas} valueClass="text-green-700" />
          </div>

          {/* Search */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                ref={searchRef}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Buscar número ou nome..."
                className="pl-8 pr-8 py-1.5 text-xs border border-gray-200 rounded-lg w-52 focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            {searchQuery && (
              <span className={`text-xs px-2 py-1 rounded-full font-medium ${matchedLead ? 'bg-teal-100 text-teal-700' : 'bg-red-100 text-red-600'}`}>
                {matchedLead ? `${matchedColumn?.label ?? matchedLead.stage}` : 'Não encontrado'}
              </span>
            )}
            {matchedLead && (
              <button
                onClick={() => setSelectedLead(matchedLead)}
                className="text-xs px-3 py-1.5 bg-teal-700 text-white rounded-lg hover:bg-teal-800 transition"
              >
                Ver lead
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Kanban area */}
      <main className="flex-1 overflow-x-auto p-6">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-4 min-w-max pb-4">
            {COLUMNS.map(col => (
              <KanbanColumn
                key={col.id}
                column={col}
                leads={leads.filter(l => l.stage === col.id)}
                onCardClick={setSelectedLead}
                onCardDelete={setLeadToDelete}
                onLeadUpdate={handleLeadUpdate}
                highlightLeadId={matchedLead?.id ?? null}
              />
            ))}
          </div>

          {/* Drag overlay — card ghost while dragging */}
          <DragOverlay dropAnimation={null}>
            {activeLead ? (
              <div className="rotate-2 opacity-90 w-60">
                <LeadCard lead={activeLead} onClick={() => {}} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </main>

      {/* Lead detail modal */}
      {selectedLead && (
        <LeadModal
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
        />
      )}

      {leadToDelete && (
        <ConfirmDeleteModal
          lead={leadToDelete}
          onConfirm={handleDeleteConfirmed}
          onCancel={() => setLeadToDelete(null)}
        />
      )}
    </div>
  )
}

function Stat({ icon, label, value, valueClass = 'text-gray-800' }) {
  return (
    <div className="flex items-center gap-1.5">
      {icon}
      <span className="text-xs text-gray-400">{label}:</span>
      <span className={`text-xs font-bold ${valueClass}`}>{value}</span>
    </div>
  )
}
