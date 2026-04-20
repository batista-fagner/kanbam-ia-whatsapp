import { useState, useEffect } from 'react'
import { Users, MessageCircle, Copy, CheckCircle2, Megaphone } from 'lucide-react'

const STATUS_CONFIG = {
  novo:       { label: 'Novo',       className: 'bg-slate-100 text-slate-600' },
  contatado:  { label: 'Contatado',  className: 'bg-blue-100 text-blue-700' },
  convertido: { label: 'Convertido', className: 'bg-green-100 text-green-700' },
  perdido:    { label: 'Perdido',    className: 'bg-red-100 text-red-600' },
}

export default function Leads() {
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedLead, setSelectedLead] = useState(null)
  const [copiedMessage, setCopiedMessage] = useState(false)
  const [converting, setConverting] = useState(false)
  const [convertValue, setConvertValue] = useState(3000)

  const DEMO_LEAD = {
    id: 'demo-lead-1',
    name: 'João Silva',
    phone: '11999998888',
    instagram: 'joaosilva.marketing',
    email: 'joao@empresa.com',
    status: 'contatado',
    score: 125,
    utmCampaign: 'janeiro-2025',
    utmSource: 'facebook',
    utmMedium: 'publico-frio',
    utmContent: 'video-depoimento-cliente',
    fbclid: 'IwAR2xK9abc123',
    aiInsight: {
      outreach_message: 'Oi João! Vi que você trabalha com marketing digital e percebi que seu engajamento caiu nos últimos posts. Tenho uma solução de IA que pode triplicar seus resultados. Posso te mostrar em 15 minutos?',
      niche: 'Marketing Digital',
      engagement_level: 'alto',
      audience_profile: 'Empreendedores e profissionais de marketing',
      selling_angle: 'Queda de engajamento orgânico e dependência de tráfego pago',
    },
  }

  useEffect(() => {
    fetch('http://localhost:3001/api/leads')
      .then(r => r.json())
      .then(data => {
        setLeads([DEMO_LEAD, ...(Array.isArray(data) ? data : [])])
        setLoading(false)
      })
      .catch(err => {
        console.error(err)
        setLoading(false)
      })
  }, [])

  const copyMessage = (text) => {
    navigator.clipboard.writeText(text)
    setCopiedMessage(true)
    setTimeout(() => setCopiedMessage(false), 2000)
  }

  const markAsConverted = async () => {
    if (!selectedLead) return
    setConverting(true)
    try {
      const res = await fetch(`http://localhost:3001/api/leads/${selectedLead.id}/convert`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: convertValue }),
      })
      if (!res.ok) throw new Error()
      const updated = await res.json()
      setLeads(prev => prev.map(l => l.id === updated.id ? updated : l))
      setSelectedLead(updated)
    } catch {
      alert('Erro ao marcar como convertido')
    } finally {
      setConverting(false)
    }
  }

  if (loading) {
    return <div className="p-6"><p>Carregando...</p></div>
  }

  return (
    <div className="p-8 space-y-8 bg-gradient-to-br from-blue-50 to-slate-50 min-h-screen">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center">
          <Users className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-4xl font-bold text-slate-900">Todos os Leads</h1>
          <p className="text-slate-600 text-sm mt-0.5">Leads com mensagens enviadas</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Lista de Leads */}
        <div className="lg:col-span-1 bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden flex flex-col">
          <div className="px-6 py-4 bg-gradient-to-r from-blue-50 to-indigo-100 border-b border-slate-200">
            <p className="text-sm font-bold text-slate-800 uppercase tracking-wide">
              📋 Leads ({leads.length})
            </p>
          </div>

          <div className="divide-y divide-slate-100 overflow-y-auto flex-1">
            {leads.length === 0 ? (
              <div className="p-8 text-center text-slate-400 flex items-center justify-center h-full">
                <div>
                  <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Nenhum lead ainda</p>
                </div>
              </div>
            ) : (
              leads.map(lead => {
                const statusCfg = STATUS_CONFIG[lead.status] || STATUS_CONFIG.novo
                return (
                  <div
                    key={lead.id}
                    onClick={() => setSelectedLead(lead)}
                    className={`px-6 py-4 cursor-pointer transition-all border-l-4 duration-200 ${
                      selectedLead?.id === lead.id
                        ? 'bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-500 shadow-sm'
                        : 'hover:bg-slate-50 border-transparent'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-800 text-sm truncate">{lead.name}</p>
                        <p className="text-xs text-slate-500 mt-1 truncate">{lead.phone}</p>
                        {lead.utmCampaign && (
                          <p className="text-xs text-violet-600 font-medium mt-1 truncate">🎯 {lead.utmCampaign}</p>
                        )}
                        {!lead.utmCampaign && !lead.utmSource && (
                          <p className="text-xs text-slate-400 mt-1">Origem desconhecida</p>
                        )}
                        {lead.aiInsight?.outreach_message && (
                          <p className="text-xs text-blue-600 font-medium mt-1">📧 Mensagem enviada</p>
                        )}
                      </div>
                      <span className={`text-xs px-2 py-1 rounded whitespace-nowrap font-medium ${statusCfg.className}`}>
                        {statusCfg.label}
                      </span>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Detalhes da Mensagem */}
        <div className="lg:col-span-2 bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden flex flex-col">
          {selectedLead ? (
            <>
              <div className="px-6 py-5 bg-gradient-to-r from-blue-500 to-indigo-600 text-white">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-bold text-lg">{selectedLead.name}</p>
                    <p className="text-blue-100 text-sm mt-1">{selectedLead.phone}</p>
                    {selectedLead.instagram && (
                      <p className="text-blue-100 text-sm">@{selectedLead.instagram}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold mb-1">Status</p>
                    <span className={`text-xs px-3 py-1 rounded-full font-bold ${STATUS_CONFIG[selectedLead.status]?.className || 'bg-slate-100 text-slate-600'}`}>
                      {STATUS_CONFIG[selectedLead.status]?.label || selectedLead.status}
                    </span>
                  </div>
                </div>
              </div>

              <div className="p-6 space-y-4 flex-1 overflow-y-auto">
                {/* Origem do Anúncio */}
                {(selectedLead.utmCampaign || selectedLead.utmSource || selectedLead.fbclid) && (
                  <div className="bg-violet-50 rounded-xl p-4 border border-violet-200">
                    <div className="flex items-center gap-2 mb-3">
                      <Megaphone className="w-4 h-4 text-violet-600" />
                      <p className="text-sm font-bold text-violet-700 uppercase">Origem do Anúncio</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {selectedLead.utmCampaign && (
                        <div className="bg-white rounded-lg p-2 border border-violet-100">
                          <p className="text-xs text-slate-500 mb-0.5">Campanha</p>
                          <p className="text-sm font-bold text-slate-800">{selectedLead.utmCampaign}</p>
                        </div>
                      )}
                      {selectedLead.utmContent && (
                        <div className="bg-white rounded-lg p-2 border border-violet-100">
                          <p className="text-xs text-slate-500 mb-0.5">Criativo</p>
                          <p className="text-sm font-bold text-violet-700">{selectedLead.utmContent}</p>
                        </div>
                      )}
                      {selectedLead.utmMedium && (
                        <div className="bg-white rounded-lg p-2 border border-violet-100">
                          <p className="text-xs text-slate-500 mb-0.5">Conjunto</p>
                          <p className="text-sm font-bold text-slate-800">{selectedLead.utmMedium}</p>
                        </div>
                      )}
                      {selectedLead.fbclid && (
                        <div className="bg-white rounded-lg p-2 border border-violet-100">
                          <p className="text-xs text-slate-500 mb-0.5">Rastreamento</p>
                          <p className="text-sm font-bold text-green-600">✓ Meta Ads</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Botão Converter */}
                {selectedLead.status !== 'convertido' && (
                  <div className="bg-gradient-to-br from-emerald-50 to-green-50 rounded-xl p-4 border-2 border-emerald-200">
                    <div className="flex items-center gap-2 mb-3">
                      <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                      <p className="text-sm font-bold text-emerald-700 uppercase">Marcar como Convertido</p>
                    </div>
                    <div className="flex gap-3 items-center">
                      <div className="flex-1">
                        <label className="text-xs text-slate-500 mb-1 block">Valor da venda (R$)</label>
                        <input
                          type="number"
                          value={convertValue}
                          onChange={e => setConvertValue(Number(e.target.value))}
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-400"
                        />
                      </div>
                      <button
                        onClick={markAsConverted}
                        disabled={converting}
                        className="mt-5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-bold py-2 px-4 rounded-lg transition whitespace-nowrap"
                      >
                        {converting ? 'Salvando...' : '✓ Converter'}
                      </button>
                    </div>
                    {selectedLead.fbclid && (
                      <p className="text-xs text-slate-400 mt-2">🎯 Lead rastreado via anúncio — evento Purchase será enviado ao Facebook</p>
                    )}
                  </div>
                )}

                {selectedLead.aiInsight?.outreach_message && (
                  <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-4 border-2 border-green-200">
                    <div className="flex items-center gap-2 mb-3">
                      <MessageCircle className="w-5 h-5 text-green-600" />
                      <p className="text-sm font-bold text-green-700 uppercase">Mensagem Enviada</p>
                    </div>
                    <p className="text-base text-green-800 leading-relaxed font-medium">
                      "{selectedLead.aiInsight.outreach_message}"
                    </p>
                    <button
                      onClick={() => copyMessage(selectedLead.aiInsight.outreach_message)}
                      className="mt-3 w-full bg-green-500 hover:bg-green-600 text-white text-sm font-bold py-2 px-3 rounded-lg transition flex items-center justify-center gap-2"
                    >
                      <Copy className="w-4 h-4" />
                      {copiedMessage ? '✓ Copiado!' : 'Copiar mensagem'}
                    </button>
                  </div>
                )}

                {selectedLead.aiInsight && (
                  <div className="space-y-3 pt-4 border-t-2 border-slate-200">
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-xs font-semibold text-slate-600 uppercase mb-1">Nicho</p>
                      <p className="text-sm font-bold text-slate-800">{selectedLead.aiInsight.niche}</p>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-slate-50 rounded-lg p-3">
                        <p className="text-xs font-semibold text-slate-600 uppercase mb-1">Engajamento</p>
                        <p className="text-sm font-bold text-slate-800 capitalize">{selectedLead.aiInsight.engagement_level}</p>
                      </div>
                      <div className="bg-slate-50 rounded-lg p-3">
                        <p className="text-xs font-semibold text-slate-600 uppercase mb-1">Score</p>
                        <p className="text-sm font-bold text-slate-800">{selectedLead.score || 0} pts</p>
                      </div>
                    </div>

                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-xs font-semibold text-slate-600 uppercase mb-1">Público-alvo</p>
                      <p className="text-sm text-slate-700">{selectedLead.aiInsight.audience_profile}</p>
                    </div>

                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-xs font-semibold text-slate-600 uppercase mb-1">Ângulo de Venda</p>
                      <p className="text-sm text-slate-700">{selectedLead.aiInsight.selling_angle}</p>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center p-8 text-center">
              <div>
                <MessageCircle className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-600 font-semibold">Selecione um lead</p>
                <p className="text-sm text-slate-500 mt-1">Escolha na lista para ver a mensagem enviada</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
