import { useState, useEffect, useCallback } from 'react'
import { Activity, AlertTriangle, DollarSign, Users, RefreshCw, TrendingUp, Zap, MessageSquare } from 'lucide-react'
import { authFetch } from '../services/api'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, BarChart, Bar,
} from 'recharts'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

const fmt = (n) => Number(n ?? 0).toLocaleString('pt-BR')
const fmtUsd = (n) => `$${Number(n ?? 0).toFixed(4)}`
const fmtUsdShort = (n) => `$${Number(n ?? 0).toFixed(2)}`

// Data de hoje no fuso de Brasília ('YYYY-MM-DD').
const brToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())

function CacheIndicator({ pct }) {
  if (pct === null || pct === undefined) return <span className="text-gray-400 text-xs">—</span>
  const color = pct >= 90 ? 'text-green-600 bg-green-50' : pct >= 50 ? 'text-yellow-700 bg-yellow-50' : 'text-red-600 bg-red-50'
  const icon = pct >= 90 ? '🟢' : pct >= 50 ? '🟡' : '🔴'
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${color}`}>{icon} {pct}%</span>
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

export default function MonitoringPage() {
  const [overview, setOverview] = useState(null)
  const [tenants, setTenants] = useState([])
  const [topLeads, setTopLeads] = useState([])
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState(null)
  const [date, setDate] = useState(brToday())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const q = `?date=${date}`
      const [ov, tn, tl, hi] = await Promise.all([
        authFetch(`${API_URL}/admin/monitoring/overview${q}`).then(r => r.json()),
        authFetch(`${API_URL}/admin/monitoring/tenants${q}`).then(r => r.json()),
        authFetch(`${API_URL}/admin/monitoring/top-leads${q}`).then(r => r.json()),
        authFetch(`${API_URL}/admin/monitoring/token-history`).then(r => r.json()),
      ])
      setOverview(ov)
      setTenants(tn)
      setTopLeads(tl)
      setHistory(hi.map(h => ({
        ...h,
        date: h.date.slice(5), // MM-DD
        total_cost: Number(h.total_cost),
      })))
      setLastRefresh(new Date())
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [date])

  useEffect(() => { load() }, [load])

  const isToday = date === brToday()

  const anomalies = overview?.anomalies ?? []
  const periodLabel = isToday ? 'hoje' : new Date(date + 'T12:00:00').toLocaleDateString('pt-BR')

  return (
    <div className="p-6 max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
            <Activity className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-800">Monitoramento</h1>
            <p className="text-xs text-gray-500">
              {lastRefresh ? `Atualizado às ${lastRefresh.toLocaleTimeString('pt-BR')}` : 'Carregando...'}
            </p>
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
        </div>
      </div>

      {/* Overview cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <OverviewCard
          icon={Zap}
          label={`Tokens ${periodLabel}`}
          value={fmt(overview?.total_input)}
          sub={`${fmt(overview?.total_cached)} cacheados`}
          color="bg-violet-500"
        />
        <OverviewCard
          icon={DollarSign}
          label={`Custo ${periodLabel}`}
          value={fmtUsdShort(overview?.total_cost)}
          sub="USD"
          color="bg-emerald-500"
        />
        <OverviewCard
          icon={Users}
          label="Tenants ativos"
          value={overview?.active_tenants ?? '—'}
          sub={`com consumo ${periodLabel}`}
          color="bg-blue-500"
        />
        <OverviewCard
          icon={AlertTriangle}
          label="Alertas de loop"
          value={overview?.anomaly_count ?? 0}
          sub="leads ≥100 msgs no dia"
          color={overview?.anomaly_count > 0 ? 'bg-red-500' : 'bg-gray-400'}
        />
      </div>

      {/* Alertas de loop */}
      {anomalies.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            <h2 className="text-sm font-bold text-red-700">Anomalias detectadas ({periodLabel})</h2>
          </div>
          <div className="space-y-2">
            {anomalies.map(a => (
              <div key={a.id} className="flex items-center justify-between bg-white rounded-lg px-4 py-2 border border-red-100">
                <div>
                  <span className="text-sm font-semibold text-gray-800">{a.name || a.phone}</span>
                  <span className="text-xs text-gray-400 ml-2">{a.phone}</span>
                  <span className="text-xs text-gray-500 ml-2">— {a.tenant_name}</span>
                </div>
                <span className="text-sm font-bold text-red-600">{fmt(a.msg_count)} msgs</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Gráfico histórico 14 dias */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-800 mb-4">Custo por dia — últimos 14 dias (USD)</h2>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={history}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${v.toFixed(2)}`} />
            <Tooltip formatter={(v) => [`$${Number(v).toFixed(4)}`, 'Custo']} />
            <Line type="monotone" dataKey="total_cost" stroke="#7c3aed" strokeWidth={2} dot={{ r: 3 }} name="Custo USD" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Tabela de tenants */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-800">Consumo por cliente</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <th className="text-left px-5 py-3">Cliente</th>
                <th className="text-right px-4 py-3">Tokens hoje</th>
                <th className="text-center px-4 py-3">Cache</th>
                <th className="text-right px-4 py-3">Custo hoje</th>
                <th className="text-right px-4 py-3">Projeção/mês</th>
                <th className="text-left px-4 py-3">Top lead</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tenants.map(t => (
                <tr key={t.tenant_id} className="hover:bg-gray-50">
                  <td className="px-5 py-3 font-medium text-gray-800">{t.tenant_name}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{fmt(t.input_today)}</td>
                  <td className="px-4 py-3 text-center">
                    <CacheIndicator pct={t.cache_pct} />
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600">{fmtUsd(t.cost_today)}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`font-semibold ${Number(t.projected_monthly) > 5 ? 'text-red-600' : Number(t.projected_monthly) > 1 ? 'text-yellow-600' : 'text-green-600'}`}>
                      {fmtUsdShort(t.projected_monthly)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {t.top_lead ? (
                      <span>{t.top_lead.lead_name || '—'} <span className="text-gray-400">({fmt(t.top_lead.msg_count)} msgs)</span></span>
                    ) : '—'}
                  </td>
                </tr>
              ))}
              {tenants.length === 0 && (
                <tr><td colSpan={6} className="px-5 py-8 text-center text-gray-400">Sem dados hoje</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Top leads por mensagens */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-gray-500" />
            <h2 className="text-sm font-semibold text-gray-800">Top leads por mensagens ({periodLabel})</h2>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <th className="text-left px-5 py-3">Lead</th>
                <th className="text-left px-4 py-3">Cliente</th>
                <th className="text-left px-4 py-3">Raia</th>
                <th className="text-right px-4 py-3">Inbound</th>
                <th className="text-right px-4 py-3">Outbound</th>
                <th className="text-right px-4 py-3">Total</th>
                <th className="text-center px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {topLeads.map(l => (
                <tr key={l.id} className={l.is_anomaly ? 'bg-red-50' : 'hover:bg-gray-50'}>
                  <td className="px-5 py-3">
                    <div className="font-medium text-gray-800">{l.name || '—'}</div>
                    <div className="text-xs text-gray-400">{l.phone}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{l.tenant_name}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">{l.stage}</span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600">{fmt(l.inbound_count)}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{fmt(l.outbound_count)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-800">{fmt(l.msg_count)}</td>
                  <td className="px-4 py-3 text-center">
                    {l.is_anomaly
                      ? <span className="text-xs px-2 py-0.5 bg-red-100 text-red-600 rounded-full font-medium">⚠️ Loop</span>
                      : <span className="text-xs px-2 py-0.5 bg-green-50 text-green-600 rounded-full">Normal</span>
                    }
                  </td>
                </tr>
              ))}
              {topLeads.length === 0 && (
                <tr><td colSpan={7} className="px-5 py-8 text-center text-gray-400">Sem atividade neste dia</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
