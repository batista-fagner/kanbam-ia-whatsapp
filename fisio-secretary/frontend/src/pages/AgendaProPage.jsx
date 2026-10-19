import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, Settings, RefreshCw, Calendar as CalIcon, Bot, Loader2, Eye, EyeOff } from 'lucide-react'
import {
  getAgendaSettings, listAgendaServices, listAgendaProfessionals, listAgendaAppointments, listAgendaBlocks, updateAgendaAppointment,
} from '../services/api'
import AgendaSettings from '../components/agenda/AgendaSettings'
import AppointmentPanel from '../components/agenda/AppointmentPanel'
import { addDays, dayStartISO, hhmm, hoursForDay, labelDate, spParts, todayStr, toISO, toMin, weekStart, weekdayOf, WEEKDAYS_SHORT } from '../components/agenda/time'

const PPM = 1.4 // pixels por minuto (84px por hora)
const ACTIVE = ['agendado', 'confirmado']

function useIsMobile() {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)')
    const h = (e) => setM(e.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [])
  return m
}

// Agenda estilo Trinks (tenant_schedules.mode='professionals'): Dia = uma coluna por profissional;
// Semana = os 7 dias de um profissional. Clique num horário vazio agenda; arraste remarca.
export default function AgendaProPage() {
  const isMobile = useIsMobile()
  const [date, setDate] = useState(todayStr())
  const [view, setView] = useState('day')
  const [settings, setSettings] = useState(null)
  const [services, setServices] = useState([])
  const [professionals, setProfessionals] = useState([])
  const [appointments, setAppointments] = useState([])
  const [blocks, setBlocks] = useState([])
  const [focusProf, setFocusProf] = useState('')
  const [loading, setLoading] = useState(true)
  const [showCancelled, setShowCancelled] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState('services')
  const [draft, setDraft] = useState(null)
  const [selected, setSelected] = useState(null)
  const [notice, setNotice] = useState('')

  const activeProfs = useMemo(() => professionals.filter((p) => p.active), [professionals])
  const rangeStart = view === 'week' ? weekStart(date) : date
  const days = useMemo(() => (view === 'week' ? [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(rangeStart, i)) : [date]), [view, rangeStart, date])

  const loadConfig = useCallback(async () => {
    const [cfg, s, p] = await Promise.all([getAgendaSettings(), listAgendaServices(), listAgendaProfessionals()])
    setSettings(cfg)
    setServices(s)
    setProfessionals(p)
    return p
  }, [])

  const loadRange = useCallback(async () => {
    const from = dayStartISO(days[0])
    const to = dayStartISO(addDays(days[days.length - 1], 1))
    const [a, b] = await Promise.all([listAgendaAppointments(from, to), listAgendaBlocks(from, to)])
    setAppointments(a)
    setBlocks(b)
  }, [days])

  useEffect(() => {
    loadConfig().then((p) => {
      const first = p.find((x) => x.active)
      if (first) setFocusProf((cur) => cur || first.id)
    }).finally(() => setLoading(false))
  }, [loadConfig])

  useEffect(() => { loadRange() }, [loadRange])

  const refresh = () => { loadConfig(); loadRange() }

  // Colunas: Dia → profissionais (no celular, só o escolhido); Semana → dias do profissional escolhido.
  const columns = useMemo(() => {
    if (view === 'week') {
      const prof = activeProfs.find((p) => p.id === focusProf) || activeProfs[0]
      return prof ? days.map((d) => ({ key: d, date: d, prof, title: `${WEEKDAYS_SHORT[weekdayOf(d)]} ${d.slice(8)}/${d.slice(5, 7)}`, isToday: d === todayStr() })) : []
    }
    const list = isMobile ? activeProfs.filter((p) => p.id === (focusProf || activeProfs[0]?.id)) : activeProfs
    return list.map((p) => ({ key: p.id, date, prof: p, title: p.name, isToday: date === todayStr() }))
  }, [view, activeProfs, focusProf, days, date, isMobile])

  // Faixa de horas da grade: do primeiro expediente ao último (mínimo 8h–19h), incluindo agendamentos fora dele.
  const [gridStart, gridEnd] = useMemo(() => {
    let lo = 8 * 60
    let hi = 19 * 60
    for (const c of columns) {
      for (const iv of hoursForDay(c.prof, settings?.weeklyHours, weekdayOf(c.date))) {
        lo = Math.min(lo, toMin(iv.start))
        hi = Math.max(hi, toMin(iv.end))
      }
    }
    for (const a of appointments) {
      const s = spParts(a.startDateTime)
      const e = spParts(a.endDateTime || a.startDateTime)
      lo = Math.min(lo, s.minutes)
      hi = Math.max(hi, e.date === s.date ? e.minutes : 24 * 60)
    }
    return [Math.floor(lo / 60) * 60, Math.min(24 * 60, Math.ceil(hi / 60) * 60)]
  }, [columns, appointments, settings])

  const slot = settings?.slotMinutes && [15, 30, 60].includes(settings.slotMinutes) ? settings.slotMinutes : 30
  const height = (gridEnd - gridStart) * PPM
  const minuteAt = (y) => Math.max(gridStart, Math.min(gridEnd - slot, gridStart + Math.floor(y / PPM / slot) * slot))

  const visibleAppts = appointments.filter((a) => showCancelled || a.status !== 'cancelado')
  const apptsFor = (c) => visibleAppts.filter((a) => a.professionalId === c.prof.id && spParts(a.startDateTime).date === c.date)
  const blocksFor = (c) => blocks.filter((b) => !b.professionalId || b.professionalId === c.prof.id)
  const unassigned = view === 'day' ? visibleAppts.filter((a) => !a.professionalId && spParts(a.startDateTime).date === date) : []

  // Arrastar pra remarcar
  const dragRef = useRef(null)
  async function onDrop(e, c) {
    e.preventDefault()
    const info = dragRef.current
    dragRef.current = null
    if (!info) return
    const rect = e.currentTarget.getBoundingClientRect()
    const minutes = minuteAt(e.clientY - rect.top - info.grabOffsetPx)
    const payload = { startDateTime: toISO(c.date, hhmm(minutes)), professionalId: c.prof.id }
    try {
      await updateAgendaAppointment(info.id, payload)
      setNotice(`Remarcado para ${labelDate(c.date)} às ${hhmm(minutes)} com ${c.prof.name}`)
    } catch (err) {
      if (err.status === 409 && window.confirm(`${err.message}. Marcar mesmo assim (encaixe)?`)) {
        await updateAgendaAppointment(info.id, { ...payload, force: true })
      } else if (err.status !== 409) {
        setNotice(err.message)
      }
    }
    loadRange()
  }

  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(''), 4000); return () => clearTimeout(t) }, [notice])

  const needsSetup = !loading && (services.filter((s) => s.active).length === 0 || activeProfs.length === 0)
  const nowParts = spParts(Date.now())

  return (
    <div className="p-3 sm:p-6">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center"><CalIcon className="w-5 h-5 text-white" /></div>
          <div>
            <h1 className="text-xl font-bold text-gray-800">Agenda</h1>
            <p className="text-xs text-gray-500 flex items-center gap-1">
              {settings?.enabled ? <><Bot className="w-3 h-3" /> A IA está agendando pelo WhatsApp</> : 'Agendamento só pela recepção'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowCancelled((v) => !v)} className="p-2 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-500" title={showCancelled ? 'Esconder cancelados' : 'Mostrar cancelados'}>
            {showCancelled ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
          <button onClick={refresh} className="p-2 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-500" title="Atualizar"><RefreshCw className="w-4 h-4" /></button>
          <button onClick={() => { setSettingsTab('services'); setSettingsOpen(true) }} className="p-2 sm:px-3 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 text-sm flex items-center gap-1.5"><Settings className="w-4 h-4" /> <span className="hidden sm:inline">Configurar</span></button>
          <button onClick={() => setDraft({ date, minutes: Math.max(gridStart, Math.ceil(nowParts.minutes / slot) * slot), professionalId: view === 'week' ? focusProf : '' })} disabled={needsSetup} className="bg-pink-600 hover:bg-pink-700 text-white px-3 sm:px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 shadow-sm disabled:opacity-50">
            <Plus className="w-4 h-4" /> <span className="hidden sm:inline">Novo agendamento</span>
          </button>
        </div>
      </div>

      {/* Navegação */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex items-center bg-white border border-gray-200 rounded-lg">
          <button onClick={() => setDate(addDays(date, view === 'week' ? -7 : -1))} className="p-2 hover:bg-gray-50 rounded-l-lg"><ChevronLeft className="w-4 h-4" /></button>
          <button onClick={() => setDate(todayStr())} className="px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 border-x border-gray-200">Hoje</button>
          <button onClick={() => setDate(addDays(date, view === 'week' ? 7 : 1))} className="p-2 hover:bg-gray-50 rounded-r-lg"><ChevronRight className="w-4 h-4" /></button>
        </div>
        <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white" />
        <span className="text-sm font-semibold text-gray-800">
          {view === 'week' ? `Semana de ${labelDate(days[0])}` : labelDate(date)}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {(view === 'week' || isMobile) && activeProfs.length > 0 && (
            <select value={focusProf} onChange={(e) => setFocusProf(e.target.value)} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
              {activeProfs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <div className="flex bg-white border border-gray-200 rounded-lg p-0.5">
            {[['day', 'Dia'], ['week', 'Semana']].map(([k, l]) => (
              <button key={k} onClick={() => setView(k)} className={`px-3 py-1 text-sm rounded-md ${view === k ? 'bg-pink-50 text-pink-700 font-medium' : 'text-gray-500'}`}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      {notice && <div className="mb-3 p-2.5 bg-gray-800 text-white text-sm rounded-lg">{notice}</div>}

      {loading ? (
        <div className="flex items-center gap-2 text-gray-400 text-sm py-16 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Carregando agenda…</div>
      ) : needsSetup ? (
        <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center max-w-lg mx-auto">
          <CalIcon className="w-10 h-10 text-pink-400 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-gray-800">Vamos montar a sua agenda</h2>
          <p className="text-sm text-gray-500 mt-2">São 3 passos: cadastre os <b>serviços</b> (com a duração de cada um), os <b>profissionais</b> e o que cada um faz, e o <b>horário de funcionamento</b>.</p>
          <div className="flex flex-wrap justify-center gap-2 mt-5">
            <button onClick={() => { setSettingsTab('services'); setSettingsOpen(true) }} className="text-sm bg-pink-600 text-white px-4 py-2 rounded-lg">1. Serviços</button>
            <button onClick={() => { setSettingsTab('professionals'); setSettingsOpen(true) }} className="text-sm border border-gray-200 px-4 py-2 rounded-lg">2. Profissionais</button>
            <button onClick={() => { setSettingsTab('rules'); setSettingsOpen(true) }} className="text-sm border border-gray-200 px-4 py-2 rounded-lg">3. Horários</button>
          </div>
        </div>
      ) : (
        <>
          {unassigned.length > 0 && (
            <div className="mb-3 p-3 bg-amber-50 border border-amber-100 rounded-xl text-sm text-amber-800">
              <b>Sem profissional:</b>{' '}
              {unassigned.map((a) => (
                <button key={a.id} onClick={() => setSelected(a)} className="underline mr-2">{hhmm(spParts(a.startDateTime).minutes)} {a.clientName}</button>
              ))}
            </div>
          )}
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <div className="flex min-w-fit">
                {/* Coluna das horas */}
                <div className="w-14 shrink-0 border-r border-gray-100">
                  <div className="h-12 border-b border-gray-100" />
                  <div className="relative" style={{ height }}>
                    {Array.from({ length: (gridEnd - gridStart) / 60 }, (_, i) => (
                      <div key={i} className="absolute right-2 text-[11px] text-gray-400 -translate-y-1/2" style={{ top: i * 60 * PPM }}>{i === 0 ? '' : hhmm(gridStart + i * 60)}</div>
                    ))}
                  </div>
                </div>

                {columns.map((c) => {
                  const intervals = hoursForDay(c.prof, settings?.weeklyHours, weekdayOf(c.date))
                  const colAppts = apptsFor(c)
                  const lanes = layoutLanes(colAppts)
                  return (
                    <div key={c.key} className="flex-1 min-w-[150px] border-r border-gray-100 last:border-r-0">
                      <div className={`h-12 px-2 border-b border-gray-100 flex items-center gap-2 ${c.isToday && view === 'week' ? 'bg-pink-50' : ''}`}>
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.prof.color }} />
                        <span className="text-sm font-medium text-gray-800 truncate">{c.title}</span>
                        <span className="text-[11px] text-gray-400 ml-auto">{colAppts.filter((a) => ACTIVE.includes(a.status)).length || ''}</span>
                      </div>
                      <div
                        className="relative cursor-pointer"
                        style={{ height }}
                        onClick={(e) => {
                          if (e.target !== e.currentTarget && !e.target.dataset.bg) return
                          const rect = e.currentTarget.getBoundingClientRect()
                          setDraft({ date: c.date, minutes: minuteAt(e.clientY - rect.top), professionalId: c.prof.id })
                        }}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => onDrop(e, c)}
                      >
                        {/* fora do expediente */}
                        <OffHours intervals={intervals} gridStart={gridStart} gridEnd={gridEnd} />
                        {/* linhas da grade */}
                        {Array.from({ length: (gridEnd - gridStart) / slot }, (_, i) => (
                          <div key={i} data-bg="1" className={`absolute left-0 right-0 border-t ${((gridStart + i * slot) % 60 === 0) ? 'border-gray-100' : 'border-gray-50'}`} style={{ top: i * slot * PPM }} />
                        ))}
                        {/* bloqueios */}
                        {blocksFor(c).map((b) => {
                          const top = clampTop(b.startDateTime, c.date, gridStart)
                          const bottom = clampBottom(b.endDateTime, c.date, gridEnd)
                          if (bottom <= top) return null
                          return (
                            <div key={b.id} data-bg="1" className="absolute left-0 right-0 bg-[repeating-linear-gradient(45deg,#f3f4f6,#f3f4f6_6px,#e5e7eb_6px,#e5e7eb_12px)] text-[11px] text-gray-500 px-2 pt-1" style={{ top: (top - gridStart) * PPM, height: (bottom - top) * PPM }}>
                              {b.reason || 'Bloqueado'}
                            </div>
                          )
                        })}
                        {/* agora */}
                        {c.date === nowParts.date && nowParts.minutes >= gridStart && nowParts.minutes <= gridEnd && (
                          <div className="absolute left-0 right-0 border-t-2 border-pink-500 z-20 pointer-events-none" style={{ top: (nowParts.minutes - gridStart) * PPM }} />
                        )}
                        {/* agendamentos */}
                        {colAppts.map((a) => {
                          const s = spParts(a.startDateTime)
                          const e = a.endDateTime ? spParts(a.endDateTime) : { minutes: s.minutes + 60, date: s.date }
                          const end = e.date === s.date ? e.minutes : 24 * 60
                          const { lane, lanesCount } = lanes[a.id]
                          const active = ACTIVE.includes(a.status)
                          return (
                            <div
                              key={a.id}
                              draggable={active}
                              onDragStart={(ev) => {
                                const rect = ev.currentTarget.getBoundingClientRect()
                                dragRef.current = { id: a.id, grabOffsetPx: ev.clientY - rect.top }
                              }}
                              onClick={(ev) => { ev.stopPropagation(); setSelected(a) }}
                              className={`absolute z-10 rounded-lg px-2 py-1 text-xs overflow-hidden shadow-sm border-l-4 ${active ? 'cursor-grab active:cursor-grabbing' : 'opacity-50 line-through'} ${a.status === 'nao_compareceu' ? 'opacity-60' : ''}`}
                              style={{
                                top: (s.minutes - gridStart) * PPM + 1,
                                height: Math.max(22, (end - s.minutes) * PPM - 2),
                                left: `calc(${(lane / lanesCount) * 100}% + 2px)`,
                                width: `calc(${100 / lanesCount}% - 4px)`,
                                background: `${c.prof.color}1a`,
                                borderLeftColor: c.prof.color,
                              }}
                              title={`${hhmm(s.minutes)}–${hhmm(end)} ${a.clientName} · ${a.service}`}
                            >
                              <div className="font-semibold text-gray-800 truncate flex items-center gap-1">
                                {a.source === 'ia' && <Bot className="w-3 h-3 shrink-0 text-pink-600" />}
                                {hhmm(s.minutes)} {a.clientName}
                              </div>
                              <div className="text-gray-600 truncate">{a.service}</div>
                              {a.status === 'realizado' && <div className="text-[10px] text-green-700">✓ realizado</div>}
                              {a.status === 'nao_compareceu' && <div className="text-[10px] text-orange-700">faltou</div>}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-2">Clique num horário vazio para agendar · arraste um agendamento para remarcar · <Bot className="w-3 h-3 inline" /> = marcado pela IA</p>
        </>
      )}

      <AgendaSettings open={settingsOpen} initialTab={settingsTab} onClose={() => setSettingsOpen(false)} onChanged={refresh} />
      <AppointmentPanel
        draft={draft}
        appointment={selected}
        services={services}
        professionals={professionals}
        onClose={() => { setDraft(null); setSelected(null) }}
        onSaved={() => { setDraft(null); setSelected(null); loadRange() }}
      />
    </div>
  )
}

function OffHours({ intervals, gridStart, gridEnd }) {
  const sorted = [...intervals].map((iv) => [toMin(iv.start), toMin(iv.end)]).sort((a, b) => a[0] - b[0])
  const off = []
  let cursor = gridStart
  for (const [s, e] of sorted) {
    if (s > cursor) off.push([cursor, Math.min(s, gridEnd)])
    cursor = Math.max(cursor, e)
  }
  if (cursor < gridEnd) off.push([cursor, gridEnd])
  return off.map(([s, e]) => (
    <div key={s} data-bg="1" className="absolute left-0 right-0 bg-gray-50" style={{ top: (s - gridStart) * PPM, height: (e - s) * PPM }} />
  ))
}

function clampTop(iso, date, gridStart) {
  const p = spParts(iso)
  if (p.date < date) return gridStart
  if (p.date > date) return Infinity
  return Math.max(gridStart, p.minutes)
}

function clampBottom(iso, date, gridEnd) {
  const p = spParts(iso)
  if (p.date > date) return gridEnd
  if (p.date < date) return -Infinity
  return Math.min(gridEnd, p.minutes)
}

// Agendamentos sobrepostos na mesma coluna (encaixe) ficam lado a lado.
function layoutLanes(appts) {
  const items = appts
    .map((a) => {
      const s = spParts(a.startDateTime).minutes
      const e = a.endDateTime ? spParts(a.endDateTime).minutes : s + 60
      return { id: a.id, s, e: e > s ? e : s + 30 }
    })
    .sort((x, y) => x.s - y.s)
  const out = {}
  let group = []
  let groupEnd = -1
  const flush = () => {
    const laneEnds = []
    for (const it of group) {
      let lane = laneEnds.findIndex((end) => end <= it.s)
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(it.e) } else laneEnds[lane] = it.e
      out[it.id] = { lane }
    }
    for (const it of group) out[it.id].lanesCount = laneEnds.length
    group = []
  }
  for (const it of items) {
    if (it.s >= groupEnd && group.length) flush()
    group.push(it)
    groupEnd = Math.max(groupEnd, it.e)
  }
  if (group.length) flush()
  return out
}
