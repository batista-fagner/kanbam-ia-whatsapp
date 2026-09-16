import { useState, useEffect, useCallback } from 'react'
import { MessageSquare, RefreshCw, AlertTriangle, TrendingUp, Save, Loader2, Sparkles, FileText } from 'lucide-react'
import { getGroupReportsOverview, getGroupReports, getGroupMonitorSettings, updateGroupMonitorSettings, runGroupReportsNow, sendGroupReportsPdf } from '../services/api'
import GroupReportDrawer from '../components/GroupReportDrawer'

const brToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())

const SENTIMENT_LABEL = {
  positivo: { text: 'Positivo', className: 'bg-green-100 text-green-700' },
  neutro: { text: 'Neutro', className: 'bg-gray-100 text-gray-600' },
  risco: { text: 'Risco', className: 'bg-red-100 text-red-700' },
}

function OverviewCard({ icon: Icon, label, value, sub, color }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</span>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${color}`}>
          <Icon className="w-4 h-4 text-white" />
        </div>
      </div>
      <p className="text-2xl font-bold text-gray-800">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

// Config do número de alerta de risco + grupo que recebe o PDF diário — inline no topo
// da página, não precisa de tela própria.
function MonitorSettingsConfig() {
  const [phone, setPhone] = useState('')
  const [pdfGroupJid, setPdfGroupJid] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    getGroupMonitorSettings()
      .then(s => {
        setPhone(s.riskAlertPhone ?? '')
        setPdfGroupJid(s.pdfReportGroupJid ?? '')
      })
      .finally(() => setLoading(false))
  }, [])

  async function handleSave() {
    setSaving(true); setSaved(false)
    try {
      await updateGroupMonitorSettings({ riskAlertPhone: phone, pdfReportGroupJid: pdfGroupJid })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <div className="flex items-center gap-3">
        <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-gray-500">Número que recebe alerta imediato de risco</p>
          <input
            type="text"
            value={loading ? '' : phone}
            onChange={e => setPhone(e.target.value)}
            placeholder={loading ? 'Carregando...' : 'Ex: 5511999999999'}
            disabled={loading}
            className="mt-1 w-full max-w-xs px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-400"
          />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <FileText className="w-4 h-4 text-indigo-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-gray-500">Grupo que recebe o PDF consolidado do dia (mesmo horário do relatório, 18h)</p>
          <input
            type="text"
            value={loading ? '' : pdfGroupJid}
            onChange={e => setPdfGroupJid(e.target.value)}
            placeholder={loading ? 'Carregando...' : 'JID do grupo (ex: 120363xxxx@g.us)'}
            disabled={loading}
            className="mt-1 w-full max-w-xs px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-400"
          />
        </div>
      </div>
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={loading || saving}
          className="flex items-center gap-1.5 px-3 py-2 text-sm text-violet-600 border border-violet-200 rounded-lg hover:bg-violet-50 transition disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saved ? 'Salvo!' : 'Salvar'}
        </button>
      </div>
    </div>
  )
}

export default function GroupReportsPage() {
  const [overview, setOverview] = useState(null)
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [date, setDate] = useState(brToday())
  const [openReportId, setOpenReportId] = useState(null)
  const [generating, setGenerating] = useState(false)
  const [generateMsg, setGenerateMsg] = useState('')
  const [sendingPdf, setSendingPdf] = useState(false)
  const [sendPdfMsg, setSendPdfMsg] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [ov, rp] = await Promise.all([
        getGroupReportsOverview(date),
        getGroupReports(date),
      ])
      setOverview(ov)
      setReports(rp)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [date])

  useEffect(() => { load() }, [load])

  async function handleGenerateNow() {
    setGenerating(true); setGenerateMsg('')
    try {
      const res = await runGroupReportsNow(date)
      setGenerateMsg(`${res.generated} gerado(s), ${res.skipped} sem conversa`)
      await load()
    } catch (e) {
      setGenerateMsg('Erro ao gerar: ' + e.message)
    } finally {
      setGenerating(false)
      setTimeout(() => setGenerateMsg(''), 5000)
    }
  }

  async function handleSendPdf() {
    if (!confirm(`Enviar o PDF do relatório de ${periodLabel} pro grupo do WhatsApp configurado?`)) return
    setSendingPdf(true); setSendPdfMsg('')
    try {
      const res = await sendGroupReportsPdf(date)
      setSendPdfMsg(res.sent ? 'PDF enviado pro grupo!' : `Não enviado: ${res.reason ?? 'erro desconhecido'}`)
    } catch (e) {
      setSendPdfMsg('Erro ao enviar: ' + e.message)
    } finally {
      setSendingPdf(false)
      setTimeout(() => setSendPdfMsg(''), 5000)
    }
  }

  const isToday = date === brToday()
  const periodLabel = isToday ? 'hoje' : new Date(date + 'T12:00:00').toLocaleDateString('pt-BR')

  return (
    <div className="p-6 max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center">
            <MessageSquare className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-800">Relatórios de Grupos</h1>
            <p className="text-xs text-gray-500">Resumo diário das conversas nos grupos "Projeto &lt;cliente&gt;"</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={date}
            max={brToday()}
            onChange={e => setDate(e.target.value || brToday())}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg text-gray-700 focus:outline-none focus:ring-2 focus:ring-violet-400"
          />
          {!isToday && (
            <button
              onClick={() => setDate(brToday())}
              className="px-3 py-2 text-sm text-violet-600 border border-violet-200 rounded-lg hover:bg-violet-50 transition"
            >
              Hoje
            </button>
          )}
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
          <button
            onClick={handleGenerateNow}
            disabled={generating}
            title="Gera o relatório do dia agora, sem esperar as 18h"
            className="flex items-center gap-2 px-3 py-2 text-sm text-violet-600 border border-violet-200 rounded-lg hover:bg-violet-50 transition disabled:opacity-50"
          >
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Gerar agora
          </button>
          <button
            onClick={handleSendPdf}
            disabled={sendingPdf}
            title="Envia o PDF consolidado do dia pro grupo configurado no WhatsApp"
            className="flex items-center gap-2 px-3 py-2 text-sm text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition disabled:opacity-50"
          >
            {sendingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            Enviar PDF pro grupo
          </button>
        </div>
      </div>

      {generateMsg && (
        <p className="text-xs text-gray-500 -mt-3">{generateMsg}</p>
      )}
      {sendPdfMsg && (
        <p className="text-xs text-gray-500 -mt-3">{sendPdfMsg}</p>
      )}

      <MonitorSettingsConfig />

      {/* Overview cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <OverviewCard
          icon={MessageSquare}
          label={`Relatórios ${periodLabel}`}
          value={overview?.totalReports ?? '—'}
          sub="grupos com conversa no dia"
          color="bg-indigo-500"
        />
        <OverviewCard
          icon={AlertTriangle}
          label="Sinais de risco"
          value={overview?.riskCount ?? 0}
          sub="grupos com sentimento de risco"
          color={overview?.riskCount > 0 ? 'bg-red-500' : 'bg-gray-400'}
        />
        <OverviewCard
          icon={TrendingUp}
          label="Sinais de oportunidade"
          value={overview?.opportunityCount ?? 0}
          sub="bom momento p/ pedir indicação"
          color={overview?.opportunityCount > 0 ? 'bg-amber-500' : 'bg-gray-400'}
        />
        <OverviewCard
          icon={AlertTriangle}
          label="Sem resposta do cliente"
          value={overview?.awaitingResponseCount ?? 0}
          sub="equipe falou e cliente não respondeu no dia"
          color={overview?.awaitingResponseCount > 0 ? 'bg-red-500' : 'bg-gray-400'}
        />
      </div>

      {/* Tabela de relatórios */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-800">Relatórios por cliente ({periodLabel})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <th className="text-left px-5 py-3">Cliente</th>
                <th className="text-center px-4 py-3">Sentimento</th>
                <th className="text-left px-4 py-3">Categorias de dúvida</th>
                <th className="text-left px-4 py-3">Resumo</th>
                <th className="text-right px-5 py-3">Mensagens</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {reports.map(r => {
                const sentiment = SENTIMENT_LABEL[r.sentiment] ?? SENTIMENT_LABEL.neutro
                return (
                  <tr
                    key={r.id}
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => setOpenReportId(r.id)}
                  >
                    <td className="px-5 py-3 font-medium text-gray-800">
                      {r.clientName}
                      {r.opportunitySignal && <TrendingUp className="w-3.5 h-3.5 text-amber-500 inline ml-1.5" />}
                      {r.awaitingClientResponse && (
                        <span
                          title="Equipe falou e cliente não respondeu no dia"
                          className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 align-middle"
                        >
                          sem resposta
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${sentiment.className}`}>{sentiment.text}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(r.doubtCategories ?? []).slice(0, 3).map((c, i) => (
                          <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700">{c}</span>
                        ))}
                        {r.doubtCategories?.length === 0 && <span className="text-gray-300 text-xs">—</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs max-w-xs truncate" title={r.summary}>{r.summary}</td>
                    <td className="px-5 py-3 text-right text-gray-600">{r.messageCount}</td>
                  </tr>
                )
              })}
              {reports.length === 0 && (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-gray-400">Nenhum grupo com conversa neste dia</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {openReportId && (
        <GroupReportDrawer reportId={openReportId} onClose={() => setOpenReportId(null)} />
      )}
    </div>
  )
}
