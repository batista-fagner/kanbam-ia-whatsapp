import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { FileBarChart, Loader2, Download, CheckCircle2, XCircle, Lightbulb, Users, Bot, Target, ListChecks, AlertTriangle, Sparkles } from 'lucide-react'
import { getSalesReportStatus, listSalesReports, getSalesReport, requestSalesReport, downloadSalesReportPdf } from '../services/api'
import { getSocket } from '../utils/realtime'

const fmtDate = (d) => new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' })
const fmtDateTime = (d) => new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const fmtPhone = (p) => {
  const d = String(p ?? '').replace(/\D/g, '').replace(/^55/, '')
  return d.length >= 10 ? `(${d.slice(0, 2)}) ${d.slice(2, -4)}-${d.slice(-4)}` : p
}

const METRICS = [
  ['conversas', 'Conversas'],
  ['novosLeads', 'Leads novos'],
  ['mensagensRecebidas', 'Mensagens recebidas'],
  ['respostasIa', 'Respostas da IA'],
  ['respostasEquipe', 'Respostas da equipe'],
  ['agendados', 'Agendados'],
  ['vendas', 'Vendas'],
  ['perdidos', 'Perdidos'],
  ['aguardandoResposta', 'Aguardando resposta'],
]

function Section({ icon: Icon, title, color, items, render }) {
  if (!items?.length) return null
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className={`flex items-center gap-2 mb-3 ${color}`}>
        <Icon className="w-4 h-4" />
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <div className="space-y-3">
        {items.map((it, i) => (
          <div key={i} className="border-l-2 border-gray-100 pl-3">{render(it)}</div>
        ))}
      </div>
    </div>
  )
}

const Item = ({ title, body, example }) => (
  <>
    <p className="text-sm font-medium text-gray-800">{title}</p>
    {body && <p className="text-sm text-gray-600 mt-0.5">{body}</p>}
    {example && <p className="text-xs text-gray-400 italic mt-1">{example}</p>}
  </>
)

export default function SalesReportPage() {
  const [status, setStatus] = useState(null)
  const [reports, setReports] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [requesting, setRequesting] = useState(false)
  const [error, setError] = useState('')
  const [downloading, setDownloading] = useState(false)

  const load = useCallback(async () => {
    try {
      const [st, list] = await Promise.all([getSalesReportStatus(), listSalesReports()])
      setStatus(st)
      setReports(list)
      setSelectedId((cur) => cur ?? list.find((r) => r.status === 'done')?.id ?? null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!selectedId) { setReport(null); return }
    getSalesReport(selectedId).then(setReport).catch(() => setReport(null))
  }, [selectedId])

  // Geração roda em segundo plano no servidor; o socket avisa quando terminar.
  useEffect(() => {
    const socket = getSocket()
    const onUpdate = ({ id, status: s }) => {
      load()
      if (s === 'done') {
        setSelectedId(id)
        getSalesReport(id).then(setReport).catch(() => {})
      }
    }
    socket.on('sales-report:updated', onUpdate)
    return () => socket.off('sales-report:updated', onUpdate)
  }, [load])

  const generate = async () => {
    setRequesting(true)
    setError('')
    try {
      await requestSalesReport()
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setRequesting(false)
    }
  }

  const download = async () => {
    setDownloading(true)
    try { await downloadSalesReportPdf(report.id) } catch (e) { setError(e.message) } finally { setDownloading(false) }
  }

  if (loading) {
    return <div className="p-6 flex items-center gap-2 text-sm text-gray-400"><Loader2 className="w-4 h-4 animate-spin" /> Carregando...</div>
  }

  if (status && !status.enabled) {
    return <div className="p-6 text-sm text-gray-500">O relatório de vendas ainda não está disponível para esta conta.</div>
  }

  const c = report?.content
  const m = report?.metrics

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center">
          <FileBarChart className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-800">Relatório de vendas</h1>
          <p className="text-xs text-gray-500">A IA analisa as conversas dos últimos 7 dias: acertos, erros e o que melhorar para vender mais.</p>
        </div>
      </div>

      {/* Gerar */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-gray-600">
            {status?.processing
              ? <span className="flex items-center gap-2 text-teal-700"><Loader2 className="w-4 h-4 animate-spin" /> Gerando o relatório... leva de 1 a 2 minutos. Pode sair desta tela.</span>
              : status?.canGenerate
                ? <>Você pode gerar <strong>1 relatório por semana</strong>.</>
                : status?.nextAvailableAt
                  ? <>Relatório da semana já gerado. Próximo disponível em <strong>{fmtDateTime(status.nextAvailableAt)}</strong>.</>
                  : null}
          </div>
          <button
            onClick={generate}
            disabled={!status?.canGenerate || requesting}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-teal-700 rounded-lg hover:bg-teal-800 transition disabled:opacity-50"
          >
            {requesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Gerar relatório da semana
          </button>
        </div>
        {!status?.notificationPhone && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mt-3 flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>Para receber o PDF no WhatsApp, cadastre o número em <Link to="/settings" className="underline">Configurações → Geral → Notificação de agendamento</Link>. O relatório aparece aqui de qualquer jeito.</span>
          </p>
        )}
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      </div>

      {/* Histórico */}
      {reports.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
          {reports.map((r) => (
            <button
              key={r.id}
              onClick={() => r.status === 'done' && setSelectedId(r.id)}
              className={`shrink-0 px-3 py-2 rounded-lg border text-left text-xs transition ${
                r.id === selectedId ? 'border-teal-500 bg-teal-50' : 'border-gray-200 bg-white hover:bg-gray-50'
              } ${r.status !== 'done' ? 'cursor-default opacity-70' : ''}`}
            >
              <div className="font-medium text-gray-800">{fmtDate(r.createdAt)}</div>
              <div className="text-gray-500">
                {r.status === 'processing' ? 'Gerando...' : r.status === 'failed' ? 'Falhou' : 'Pronto'}
              </div>
            </button>
          ))}
        </div>
      )}

      {!reports.length && !status?.processing && (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
          Nenhum relatório ainda. Clique em <strong>Gerar relatório da semana</strong>.
        </div>
      )}

      {reports.find((r) => r.id === selectedId)?.status === 'failed' && (
        <p className="text-sm text-red-600">{reports.find((r) => r.id === selectedId)?.error}</p>
      )}

      {c && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
              <div>
                <p className="text-xs text-gray-400">{fmtDate(report.periodStart)} a {fmtDate(report.periodEnd)}</p>
                <h2 className="text-sm font-semibold text-gray-800">Resumo da semana</h2>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={download} disabled={downloading} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-teal-700 border border-teal-200 rounded-lg hover:bg-teal-50 disabled:opacity-50">
                  {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} Baixar PDF
                </button>
              </div>
            </div>
            <p className="text-sm text-gray-700 leading-relaxed">{c.resumo}</p>
            {m && (
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mt-4">
                {METRICS.map(([k, label]) => (
                  <div key={k} className="bg-gray-50 rounded-lg px-2 py-2 text-center">
                    <div className="text-lg font-bold text-gray-800">{m[k] ?? 0}</div>
                    <div className="text-[11px] text-gray-500 leading-tight">{label}</div>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-gray-400 mt-3">
              {report.pdfSentTo ? `PDF enviado para o WhatsApp ${fmtPhone(report.pdfSentTo)}.` : report.pdfError ?? ''}
            </p>
          </div>

          <Section icon={CheckCircle2} title="O que deu certo" color="text-green-700" items={c.acertos}
            render={(x) => <Item title={x.titulo} body={x.detalhe} example={x.exemplo} />} />
          <Section icon={XCircle} title="O que deu errado" color="text-red-700" items={c.erros}
            render={(x) => <Item title={x.titulo} body={x.detalhe} example={x.exemplo} />} />
          <Section icon={Bot} title="Onde a IA precisa melhorar" color="text-indigo-700" items={c.melhoriasIa}
            render={(x) => <Item title={x.problema} body={x.sugestao} example={x.exemplo} />} />
          <Section icon={Users} title="Onde a equipe pode melhorar" color="text-amber-700" items={c.melhoriasEquipe}
            render={(x) => <Item title={x.problema} body={x.sugestao} example={x.exemplo} />} />
          <Section icon={Target} title="Oportunidades para retomar" color="text-teal-700" items={c.oportunidades}
            render={(x) => <Item title={x.cliente} body={x.situacao} example={x.acao ? `Ação: ${x.acao}` : ''} />} />
          <Section icon={ListChecks} title="Plano para a próxima semana" color="text-gray-800" items={c.planoSemana}
            render={(x) => <p className="text-sm text-gray-700 flex gap-2"><Lightbulb className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />{x}</p>} />
        </div>
      )}
    </div>
  )
}
