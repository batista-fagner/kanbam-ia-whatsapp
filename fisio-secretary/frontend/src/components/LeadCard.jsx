import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { Trash2 } from 'lucide-react'

const urgencyColor = {
  alta:  'bg-red-100 text-red-700',
  media: 'bg-yellow-100 text-yellow-700',
  baixa: 'bg-gray-100 text-gray-500',
}

const tempBadge = {
  quente: '🔥',
  morno:  '☀️',
  frio:   '🧊',
}

const scoreColor = (score) => {
  if (score >= 70) return 'text-orange-600'
  if (score >= 40) return 'text-yellow-600'
  return 'text-slate-400'
}

export default function LeadCard({ lead, onClick, onDelete }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: lead.id })

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : 1,
    cursor: isDragging ? 'grabbing' : 'grab',
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className="bg-white rounded-xl p-3 mb-2 shadow-sm border border-gray-100 hover:shadow-md hover:border-blue-200 transition-all select-none"
      onClick={onClick}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
            {(lead.name || lead.phone).charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-800 leading-tight">{lead.name || 'Sem nome'}</p>
            <p className="text-xs text-gray-400">{lead.phone}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {lead.stage !== 'novo_lead' && (
            <span className="text-base leading-none">{tempBadge[lead.temperature]}</span>
          )}
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onDelete && onDelete(lead) }}
            className="p-1 rounded hover:bg-red-50 text-gray-300 hover:text-red-400 transition-colors"
            title="Excluir lead"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Symptoms */}
      {lead.symptoms && (
        <p className="text-xs text-gray-500 mb-2 line-clamp-2 leading-relaxed">
          {lead.symptoms}
        </p>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between mt-1">
        {lead.urgency ? (
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${urgencyColor[lead.urgency]}`}>
            {lead.urgency.toUpperCase()}
          </span>
        ) : <span />}

        {lead.stage === 'novo_lead' ? (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-400">
            Novo
          </span>
        ) : (
          <span className={`text-xs font-bold ${scoreColor(lead.qualificationScore ?? 0)}`}>
            {lead.qualificationScore ?? 0} pts
          </span>
        )}
      </div>

      {/* Last message timestamp */}
      {lead.lastMessageAt && (
        <div className="mt-2 pt-2 border-t border-gray-50">
          <p className="text-[10px] text-gray-300">
            🕐 {new Date(lead.lastMessageAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
      )}
    </div>
  )
}
