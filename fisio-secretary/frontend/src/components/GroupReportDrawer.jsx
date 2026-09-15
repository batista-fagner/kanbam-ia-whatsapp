import { useState, useEffect } from 'react'
import { X, Loader2, TrendingUp } from 'lucide-react'
import { getGroupReport } from '../services/api'

const SENTIMENT_LABEL = {
  positivo: { text: 'Positivo', className: 'bg-green-100 text-green-700' },
  neutro: { text: 'Neutro', className: 'bg-gray-100 text-gray-600' },
  risco: { text: 'Risco', className: 'bg-red-100 text-red-700' },
}

const ROLE_LABEL = {
  client: { text: 'Cliente', className: 'bg-blue-100 text-blue-700' },
  team: { text: 'Equipe', className: 'bg-violet-100 text-violet-700' },
  unknown: { text: '?', className: 'bg-gray-100 text-gray-400' },
}

// Mesmo padrão de slide-over do ClientDrawer.jsx (fixed inset-0 + translate-x animado).
export default function GroupReportDrawer({ reportId, onClose }) {
  const [open, setOpen] = useState(false)
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const id = requestAnimationFrame(() => setOpen(true))
    return () => cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    if (!reportId) return
    setLoading(true)
    getGroupReport(reportId)
      .then(setReport)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [reportId])

  function handleClose() {
    setOpen(false)
    setTimeout(onClose, 200)
  }

  const sentiment = report ? (SENTIMENT_LABEL[report.sentiment] ?? SENTIMENT_LABEL.neutro) : null

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={handleClose} />
      <div
        className={`absolute inset-y-0 right-0 w-full max-w-lg bg-white shadow-2xl overflow-y-auto transition-transform duration-200 ease-out ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="p-6">
          <div className="flex items-start justify-between mb-1">
            <div className="min-w-0">
              <p className="text-base font-semibold text-gray-800 truncate">{report?.clientName ?? 'Carregando...'}</p>
              <p className="text-sm text-gray-400">{report?.reportDate}</p>
            </div>
            <button onClick={handleClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 shrink-0">
              <X className="w-5 h-5" />
            </button>
          </div>

          {loading && (
            <div className="flex items-center justify-center py-12 text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          )}

          {error && <p className="text-sm text-red-600 mt-4">{error}</p>}

          {report && !loading && (
            <>
              <div className="flex items-center gap-1.5 flex-wrap mt-3 mb-6">
                <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${sentiment.className}`}>{sentiment.text}</span>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-gray-50 text-gray-500">{report.messageCount} mensagens</span>
                {report.opportunitySignal && (
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium flex items-center gap-1">
                    <TrendingUp className="w-3 h-3" /> Oportunidade
                  </span>
                )}
                {report.awaitingClientResponse && (
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-red-50 text-red-600 font-medium">
                    Sem resposta do cliente
                  </span>
                )}
              </div>

              <div className="border border-gray-100 rounded-xl p-4 mb-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Resumo do dia</p>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{report.summary || 'Sem resumo.'}</p>
              </div>

              {report.doubtCategories?.length > 0 && (
                <div className="border border-gray-100 rounded-xl p-4 mb-4">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Categorias de dúvida</p>
                  <div className="flex flex-wrap gap-1.5">
                    {report.doubtCategories.map((c, i) => (
                      <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">{c}</span>
                    ))}
                  </div>
                </div>
              )}

              {report.opportunitySignal && report.opportunityNote && (
                <div className="border border-amber-100 bg-amber-50 rounded-xl p-4 mb-4">
                  <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1">Sinal de oportunidade</p>
                  <p className="text-sm text-amber-800">{report.opportunityNote}</p>
                </div>
              )}

              <div className="border border-gray-100 rounded-xl overflow-hidden">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 pt-4 pb-2">Conversa do dia</p>
                <div className="divide-y divide-gray-50">
                  {(report.transcript ?? []).map((m, i) => {
                    const role = ROLE_LABEL[m.senderRole] ?? ROLE_LABEL.unknown
                    return (
                      <div key={i} className={`px-4 py-2.5 ${m.riskFlagged ? 'bg-red-50/60' : ''}`}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${role.className}`}>{role.text}</span>
                          {m.senderName && <span className="text-xs text-gray-400">{m.senderName}</span>}
                          {m.messageType === 'audio' && <span className="text-xs text-gray-300">🎙️</span>}
                          <span className="text-[10px] text-gray-300 ml-auto">
                            {new Date(m.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <p className="text-sm text-gray-700">{m.content}</p>
                      </div>
                    )
                  })}
                  {(report.transcript ?? []).length === 0 && (
                    <p className="text-sm text-gray-400 px-4 py-6 text-center">Sem mensagens.</p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
