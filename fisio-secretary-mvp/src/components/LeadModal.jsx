import { useEffect, useRef, useState } from 'react'
import { X, Bot, User, Phone, AlertCircle, Calendar, DollarSign, Clock, ChevronRight } from 'lucide-react'

const urgencyLabel = { alta: '⚠️ Alta', media: '🟡 Média', baixa: '🟢 Baixa' }
const urgencyColor = { alta: 'text-red-600 bg-red-50', media: 'text-yellow-700 bg-yellow-50', baixa: 'text-green-700 bg-green-50' }
const tempLabel    = { quente: '🔥 Quente', morno: '☀️ Morno', frio: '🧊 Frio' }
const tempColor    = { quente: 'text-orange-600 bg-orange-50', morno: 'text-yellow-700 bg-yellow-50', frio: 'text-sky-600 bg-sky-50' }
const byLabel      = { ai: 'IA', operator: 'Operador', system: 'Sistema' }

export default function LeadModal({ lead, onClose }) {
  const chatRef = useRef(null)
  const [aiEnabled, setAiEnabled] = useState(true)

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight
    }
  }, [lead])

  if (!lead) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">

        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-bold">
              {lead.name.charAt(0)}
            </div>
            <div>
              <h2 className="font-bold text-gray-800">{lead.name}</h2>
              <p className="text-xs text-gray-400">{lead.phone}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">

          {/* LEFT — Qualification data */}
          <div className="w-72 shrink-0 border-r border-gray-100 flex flex-col overflow-y-auto">
            <div className="p-5 space-y-5">

              {/* Score */}
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Score</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-gray-100 rounded-full h-2">
                    <div
                      className="h-2 rounded-full bg-gradient-to-r from-blue-400 to-orange-500 transition-all"
                      style={{ width: `${lead.score}%` }}
                    />
                  </div>
                  <span className="text-sm font-bold text-gray-700">{lead.score} pts</span>
                </div>
              </div>

              {/* Badges */}
              <div className="flex flex-wrap gap-2">
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${tempColor[lead.temperature]}`}>
                  {tempLabel[lead.temperature]}
                </span>
                {lead.urgency && (
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${urgencyColor[lead.urgency]}`}>
                    {urgencyLabel[lead.urgency]}
                  </span>
                )}
              </div>

              {/* Info rows */}
              <div className="space-y-3">
                {lead.symptoms && (
                  <InfoRow icon={<AlertCircle className="w-3.5 h-3.5" />} label="Sintomas" value={lead.symptoms} />
                )}
                {lead.availability && (
                  <InfoRow icon={<Calendar className="w-3.5 h-3.5" />} label="Disponibilidade" value={lead.availability} />
                )}
                {lead.budget && (
                  <InfoRow icon={<DollarSign className="w-3.5 h-3.5" />} label="Orçamento" value={lead.budget} />
                )}
                {lead.appointmentAt && (
                  <InfoRow icon={<Clock className="w-3.5 h-3.5" />} label="Consulta agendada" value={lead.appointmentAt} highlight />
                )}
              </div>

              {/* AI Toggle */}
              <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
                <div className="flex items-center gap-2">
                  <Bot className="w-4 h-4 text-blue-600" />
                  <span className="text-sm font-medium text-gray-700">IA ativa</span>
                </div>
                <button
                  onClick={() => setAiEnabled(v => !v)}
                  className={`w-11 h-6 rounded-full transition-colors relative ${aiEnabled ? 'bg-blue-600' : 'bg-gray-300'}`}
                >
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${aiEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
              </div>

              {/* Stage history */}
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Histórico de Stages</p>
                <div className="space-y-1.5">
                  {lead.stageHistory.map((h, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-xs text-gray-500">
                      <span className="text-gray-400 font-mono">{h.at}</span>
                      <ChevronRight className="w-3 h-3 text-gray-300 shrink-0" />
                      <span>{h.from}</span>
                      <span className="text-gray-300">→</span>
                      <span className="font-medium text-gray-700">{h.to}</span>
                      <span className="text-gray-300 text-[10px]">({byLabel[h.by] || h.by})</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT — Conversation */}
          <div className="flex-1 flex flex-col min-h-0">
            <div className="px-4 py-3 border-b border-gray-50 flex items-center gap-2">
              <div className="w-2 h-2 bg-green-400 rounded-full" />
              <span className="text-xs text-gray-500 font-medium">WhatsApp — conversa ao vivo</span>
            </div>

            {/* Messages */}
            <div ref={chatRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#f0f2f5]">
              {lead.conversation.map(msg => (
                <div key={msg.id} className={`flex ${msg.sender === 'lead' ? 'justify-start' : 'justify-end'}`}>
                  {msg.sender === 'lead' && (
                    <div className="w-6 h-6 rounded-full bg-blue-200 flex items-center justify-center text-blue-700 text-xs font-bold mr-2 mt-1 shrink-0">
                      <User className="w-3 h-3" />
                    </div>
                  )}
                  <div className={`max-w-[75%] ${msg.sender === 'lead' ? '' : ''}`}>
                    <div className={`px-3.5 py-2.5 rounded-2xl text-sm shadow-sm ${
                      msg.sender === 'lead'
                        ? 'bg-white text-gray-800 rounded-tl-sm'
                        : 'bg-blue-600 text-white rounded-tr-sm'
                    }`}>
                      {msg.content}
                    </div>
                    <div className={`flex items-center gap-1 mt-0.5 ${msg.sender === 'lead' ? 'justify-start' : 'justify-end'}`}>
                      {msg.sender === 'ai' && (
                        <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
                          <Bot className="w-2.5 h-2.5" /> IA
                        </span>
                      )}
                      <span className="text-[10px] text-gray-400">{msg.time}</span>
                    </div>
                  </div>
                  {msg.sender === 'ai' && (
                    <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center ml-2 mt-1 shrink-0">
                      <Bot className="w-3 h-3 text-white" />
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Input */}
            <div className="p-4 border-t border-gray-100 bg-white">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder={aiEnabled ? 'IA está respondendo automaticamente...' : 'Digite uma mensagem manual...'}
                  disabled={aiEnabled}
                  className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:text-gray-400 disabled:cursor-not-allowed transition"
                />
                <button
                  disabled={aiEnabled}
                  className="bg-blue-600 disabled:bg-gray-300 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition"
                >
                  Enviar
                </button>
              </div>
              {aiEnabled && (
                <p className="text-xs text-gray-400 mt-1.5 flex items-center gap-1">
                  <Bot className="w-3 h-3" /> Desative a IA para enviar mensagens manualmente
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function InfoRow({ icon, label, value, highlight }) {
  return (
    <div>
      <p className="text-[11px] text-gray-400 flex items-center gap-1 mb-0.5">
        <span className="text-gray-300">{icon}</span> {label}
      </p>
      <p className={`text-sm ${highlight ? 'font-semibold text-teal-600' : 'text-gray-700'}`}>{value}</p>
    </div>
  )
}
