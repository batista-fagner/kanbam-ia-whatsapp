import { useState, useEffect } from 'react'

export default function InstagramLeads() {
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedLead, setSelectedLead] = useState(null)
  const [copiedMessage, setCopiedMessage] = useState(false)

  const copyMessage = (text) => {
    navigator.clipboard.writeText(text)
    setCopiedMessage(true)
    setTimeout(() => setCopiedMessage(false), 2000)
  }

  useEffect(() => {
    fetch('http://localhost:3001/api/leads?limit=100')
      .then(r => r.json())
      .then(data => {
        const all = Array.isArray(data.data) ? data.data : []
        const instagramLeads = all.filter(l => l.enrichmentData && l.enrichmentData.followers)
        setLeads(instagramLeads)
        setLoading(false)
      })
      .catch(err => {
        console.error(err)
        setLoading(false)
      })
  }, [])

  if (loading) {
    return <div className="p-6"><p>Carregando...</p></div>
  }

  return (
    <div className="p-8 space-y-8 bg-gradient-to-br from-pink-50 via-white to-rose-50 min-h-screen">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 bg-gradient-to-br from-pink-500 to-rose-600 rounded-xl flex items-center justify-center text-2xl">
          📸
        </div>
        <div>
          <h1 className="text-4xl font-bold text-slate-900">Instagram Leads</h1>
          <p className="text-slate-600 text-sm mt-1">Leads com dados enriquecidos do Instagram</p>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Lista */}
        <div className="lg:col-span-2 bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden flex flex-col">
          <div className="px-6 py-4 bg-gradient-to-r from-pink-50 to-rose-100 border-b border-slate-200">
            <p className="text-sm font-bold text-slate-800 uppercase tracking-wide">
              📱 Leads Enriquecidos ({leads.length})
            </p>
          </div>

          <div className="divide-y divide-slate-100 overflow-y-auto flex-1">
            {leads.length === 0 ? (
              <div className="p-12 text-center text-slate-400 flex items-center justify-center h-full">
                <div>
                  <div className="text-5xl mb-3">📸</div>
                  <p className="text-sm">Nenhum lead com Instagram ainda</p>
                </div>
              </div>
            ) : (
              leads.map(lead => (
                <div
                  key={lead.id}
                  onClick={() => setSelectedLead(lead)}
                  className={`px-6 py-4 cursor-pointer transition-all border-l-4 duration-200 ${
                    selectedLead?.id === lead.id
                      ? 'bg-gradient-to-r from-pink-50 to-rose-50 border-pink-500 shadow-sm'
                      : 'hover:bg-slate-50 border-transparent'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1">
                      <p className="font-semibold text-slate-800">{lead.name}</p>
                      <p className="text-xs text-slate-500 mt-1">@{lead.instagram}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-pink-600">{(lead.enrichmentData.followers / 1000).toFixed(1)}K</p>
                      <p className="text-xs text-slate-400">seguidores</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Detalhes */}
        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden flex flex-col">
          {selectedLead ? (
            <>
              {/* Header do Lead */}
              <div className="px-6 py-5 bg-gradient-to-r from-pink-500 to-rose-600 text-white">
                <div className="w-12 h-12 bg-white bg-opacity-20 rounded-full flex items-center justify-center mb-3 text-xl">
                  📸
                </div>
                <p className="font-bold text-lg">{selectedLead.name}</p>
                <p className="text-pink-100 text-sm mt-1">@{selectedLead.instagram}</p>
              </div>

              {/* AI Analysis Card */}
              {selectedLead.aiInsight && (
                <div className="p-6 bg-gradient-to-br from-indigo-600 via-purple-600 to-violet-600 text-white">
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-sm font-bold uppercase tracking-widest">🤖 AI Analysis</p>
                    <span className="text-xs font-bold bg-white/20 backdrop-blur px-2.5 py-1 rounded-full">
                      {selectedLead.aiInsight.confidence_score}% confiança
                    </span>
                  </div>

                  <div className="space-y-4">
                    <div className="bg-white/10 backdrop-blur-sm rounded-lg p-3">
                      <p className="text-xs font-semibold text-indigo-100 uppercase mb-1">Nicho</p>
                      <p className="text-sm font-bold">{selectedLead.aiInsight.niche}</p>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-white/10 backdrop-blur-sm rounded-lg p-3">
                        <p className="text-xs font-semibold text-indigo-100 uppercase mb-1">Engajamento</p>
                        <p className="text-sm font-bold capitalize">{selectedLead.aiInsight.engagement_level}</p>
                      </div>
                      <div className="bg-white/10 backdrop-blur-sm rounded-lg p-3">
                        <p className="text-xs font-semibold text-indigo-100 uppercase mb-1">Tipo</p>
                        <p className="text-sm font-bold">{selectedLead.aiInsight.content_pattern}</p>
                      </div>
                    </div>

                    <div className="bg-white/10 backdrop-blur-sm rounded-lg p-3">
                      <p className="text-xs font-semibold text-indigo-100 uppercase mb-1">👥 Público-alvo</p>
                      <p className="text-sm">{selectedLead.aiInsight.audience_profile}</p>
                    </div>

                    <div className="bg-yellow-400/20 backdrop-blur-sm rounded-lg p-3 border border-yellow-300/30">
                      <p className="text-xs font-semibold text-yellow-100 uppercase mb-1">💡 Ângulo de Venda</p>
                      <p className="text-sm font-semibold">{selectedLead.aiInsight.selling_angle}</p>
                    </div>

                    <div className="bg-green-400/20 backdrop-blur-sm rounded-lg p-3 border border-green-300/30">
                      <p className="text-xs font-semibold text-green-100 uppercase mb-1">📧 Mensagem Pronta</p>
                      <p className="text-sm italic">"{selectedLead.aiInsight.outreach_message}"</p>
                      <button
                        onClick={() => copyMessage(selectedLead.aiInsight.outreach_message)}
                        className="mt-2 w-full bg-green-500 hover:bg-green-600 text-white text-xs font-bold py-2 rounded-lg transition"
                      >
                        {copiedMessage ? '✓ Copiado!' : 'Copiar mensagem'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Stats */}
              <div className="p-6 space-y-4">
                <div className="bg-gradient-to-br from-pink-50 to-rose-50 rounded-xl p-4 border-2 border-pink-200">
                  <p className="text-xs font-semibold text-pink-600 uppercase mb-2">👥 Seguidores</p>
                  <p className="text-3xl font-bold text-pink-700">
                    {(selectedLead.enrichmentData.followers / 1000).toFixed(1)}K
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                    <p className="text-xs font-semibold text-slate-600 mb-1">Score</p>
                    <p className="text-xl font-bold text-slate-800">{selectedLead.score}pts</p>
                  </div>
                  <div className="bg-amber-50 rounded-lg p-3 border border-amber-200">
                    <p className="text-xs font-semibold text-amber-600 mb-1">Status</p>
                    <p className="text-xs font-bold text-amber-700 capitalize">{selectedLead.status}</p>
                  </div>
                </div>

                {selectedLead.enrichmentData.content_type && (
                  <div className="bg-purple-50 rounded-lg p-3 border border-purple-200">
                    <p className="text-xs font-semibold text-purple-600 mb-1">📝 Bio</p>
                    <p className="text-xs text-purple-700 line-clamp-2">{selectedLead.enrichmentData.content_type}</p>
                  </div>
                )}

                {selectedLead.enrichmentData.engagement_rate > 0 && (
                  <div className="bg-orange-50 rounded-lg p-3 border border-orange-200">
                    <p className="text-xs font-semibold text-orange-600 mb-1">📊 Engagement</p>
                    <p className="text-sm font-bold text-orange-700">{(selectedLead.enrichmentData.engagement_rate * 100).toFixed(2)}%</p>
                  </div>
                )}

                <div className="border-t-2 border-slate-200 pt-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">Email:</span>
                    <span className="font-semibold text-slate-800 text-right truncate ml-2">{selectedLead.email || '-'}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">Telefone:</span>
                    <span className="font-semibold text-slate-800">{selectedLead.phone}</span>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center p-8 text-center">
              <div>
                <div className="text-5xl mb-3">📸</div>
                <p className="text-slate-600 font-semibold">Selecione um lead</p>
                <p className="text-sm text-slate-500 mt-1">Escolha na lista para ver detalhes</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
