import { useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core'
import { Stethoscope, LogOut, Wifi, Users, Flame, CalendarCheck } from 'lucide-react'

import { COLUMNS, initialLeads } from '../data/mockData'
import KanbanColumn from '../components/KanbanColumn'
import LeadCard from '../components/LeadCard'
import LeadModal from '../components/LeadModal'

export default function KanbanPage({ onLogout }) {
  const [leads, setLeads] = useState(initialLeads)
  const [activeId, setActiveId] = useState(null)
  const [selectedLead, setSelectedLead] = useState(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const activeLead = leads.find(l => l.id === activeId)

  function handleDragStart({ active }) {
    setActiveId(active.id)
  }

  function handleDragEnd({ active, over }) {
    setActiveId(null)
    if (!over) return
    const columnIds = COLUMNS.map(c => c.id)
    if (!columnIds.includes(over.id)) return
    if (active.id === over.id) return

    setLeads(prev =>
      prev.map(lead =>
        lead.id === active.id ? { ...lead, stage: over.id } : lead
      )
    )
  }

  // Stats for header
  const total   = leads.length
  const quentes = leads.filter(l => l.temperature === 'quente').length
  const agend   = leads.filter(l => l.stage === 'agendado').length

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {/* Header */}
      <header className="bg-white border-b border-gray-100 shadow-sm sticky top-0 z-30">
        <div className="px-6 py-3 flex items-center justify-between">

          {/* Brand */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <Stethoscope className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-800 leading-tight">Sofia</p>
              <p className="text-[11px] text-gray-400">Clínica Silva Fisioterapia</p>
            </div>
          </div>

          {/* Stats */}
          <div className="hidden md:flex items-center gap-6">
            <Stat icon={<Wifi className="w-3.5 h-3.5 text-green-500" />} label="WhatsApp" value="Conectado" valueClass="text-green-600" />
            <Stat icon={<Users className="w-3.5 h-3.5 text-blue-500" />} label="Total de leads" value={total} />
            <Stat icon={<Flame className="w-3.5 h-3.5 text-orange-500" />} label="Quentes" value={quentes} valueClass="text-orange-600" />
            <Stat icon={<CalendarCheck className="w-3.5 h-3.5 text-teal-500" />} label="Agendados" value={agend} valueClass="text-teal-600" />
          </div>

          {/* Logout */}
          <button
            onClick={onLogout}
            className="flex items-center gap-1.5 text-gray-400 hover:text-gray-700 text-sm transition"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Sair</span>
          </button>
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
