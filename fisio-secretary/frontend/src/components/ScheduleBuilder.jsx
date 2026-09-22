import { useEffect, useState } from 'react'
import { Plus, Trash2, Loader2, Clock, Ban, CalendarX } from 'lucide-react'
import { getSchedule, saveSchedule, getScheduleSlots, getScheduleBlocks, createScheduleBlock, deleteScheduleBlock } from '../services/api'

const WEEKDAYS = [
  { idx: 1, label: 'Segunda' },
  { idx: 2, label: 'Terça' },
  { idx: 3, label: 'Quarta' },
  { idx: 4, label: 'Quinta' },
  { idx: 5, label: 'Sexta' },
  { idx: 6, label: 'Sábado' },
  { idx: 0, label: 'Domingo' },
]

const SLOT_OPTIONS = [30, 45, 60, 90, 120]

function emptySchedule() {
  return { enabled: false, slotMinutes: 60, capacity: 1, bookingWindowDays: 14, minNoticeHours: 2, weeklyHours: {} }
}

export default function ScheduleBuilder() {
  const [schedule, setSchedule] = useState(emptySchedule())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(null)
  const [slots, setSlots] = useState(null)
  const [blocks, setBlocks] = useState([])
  const [blockForm, setBlockForm] = useState({ date: '', start: '', end: '', allDay: true, reason: '' })

  async function loadAll() {
    setLoading(true)
    try {
      const [sch, bl] = await Promise.all([getSchedule(), getScheduleBlocks()])
      setSchedule({ ...emptySchedule(), ...sch })
      setBlocks(bl)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadAll() }, [])

  async function refreshPreview() {
    const data = await getScheduleSlots(7).catch(() => [])
    setSlots(data)
  }

  useEffect(() => {
    if (!loading) refreshPreview()
  }, [loading, schedule.enabled, schedule.slotMinutes, schedule.capacity, schedule.minNoticeHours, schedule.weeklyHours, blocks])

  function updateDay(dayIdx, intervals) {
    setSchedule(s => ({ ...s, weeklyHours: { ...s.weeklyHours, [dayIdx]: intervals } }))
  }

  function toggleDayOpen(dayIdx, open) {
    if (open) updateDay(dayIdx, [{ start: '09:00', end: '18:00' }])
    else {
      const next = { ...schedule.weeklyHours }
      delete next[dayIdx]
      setSchedule(s => ({ ...s, weeklyHours: next }))
    }
  }

  function addInterval(dayIdx) {
    const current = schedule.weeklyHours[dayIdx] ?? []
    updateDay(dayIdx, [...current, { start: '14:00', end: '18:00' }])
  }

  function removeInterval(dayIdx, i) {
    const current = schedule.weeklyHours[dayIdx] ?? []
    updateDay(dayIdx, current.filter((_, idx) => idx !== i))
  }

  function updateInterval(dayIdx, i, field, value) {
    const current = schedule.weeklyHours[dayIdx] ?? []
    updateDay(dayIdx, current.map((iv, idx) => idx === i ? { ...iv, [field]: value } : iv))
  }

  async function handleSave() {
    setSaving(true)
    try {
      const saved = await saveSchedule(schedule)
      setSchedule({ ...emptySchedule(), ...saved })
      setSavedAt(Date.now())
      refreshPreview()
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateBlock() {
    if (!blockForm.date) return
    const startDateTime = blockForm.allDay
      ? new Date(`${blockForm.date}T00:00:00`).toISOString()
      : new Date(`${blockForm.date}T${blockForm.start || '00:00'}:00`).toISOString()
    const endDateTime = blockForm.allDay
      ? new Date(`${blockForm.date}T23:59:59`).toISOString()
      : new Date(`${blockForm.date}T${blockForm.end || '23:59'}:00`).toISOString()
    const created = await createScheduleBlock({ startDateTime, endDateTime, reason: blockForm.reason.trim() || null })
    setBlocks(b => [...b, created].sort((a, c) => new Date(a.startDateTime) - new Date(c.startDateTime)))
    setBlockForm({ date: '', start: '', end: '', allDay: true, reason: '' })
  }

  async function handleDeleteBlock(id) {
    await deleteScheduleBlock(id)
    setBlocks(b => b.filter(x => x.id !== id))
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-6 h-6 text-teal-600 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-teal-600" />
            <h2 className="text-sm font-bold text-gray-800">Minha agenda</h2>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-xs text-gray-500">IA agenda usando esta agenda</span>
            <input
              type="checkbox"
              checked={schedule.enabled}
              onChange={e => setSchedule(s => ({ ...s, enabled: e.target.checked }))}
              className="w-4 h-4 accent-teal-600"
            />
          </label>
        </div>
        <p className="text-xs text-gray-400 mb-4">
          Quando ligada, a IA só oferece e marca horários realmente livres — nunca um horário fixo.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <FieldSelect label="Duração do atendimento" value={schedule.slotMinutes} onChange={v => setSchedule(s => ({ ...s, slotMinutes: Number(v) }))}>
            {SLOT_OPTIONS.map(m => <option key={m} value={m}>{m} min</option>)}
          </FieldSelect>
          <FieldNumber label="Vagas por horário" value={schedule.capacity} min={1} onChange={v => setSchedule(s => ({ ...s, capacity: v }))} />
          <FieldNumber label="Antecedência (dias)" value={schedule.bookingWindowDays} min={1} max={90} onChange={v => setSchedule(s => ({ ...s, bookingWindowDays: v }))} />
          <FieldNumber label="Antecedência mínima (h)" value={schedule.minNoticeHours} min={0} onChange={v => setSchedule(s => ({ ...s, minNoticeHours: v }))} />
        </div>

        <div className="space-y-2">
          {WEEKDAYS.map(({ idx, label }) => {
            const intervals = schedule.weeklyHours[idx] ?? []
            const open = intervals.length > 0
            return (
              <div key={idx} className="flex items-start gap-3 py-2 border-b border-gray-50 last:border-0">
                <label className="flex items-center gap-2 w-28 flex-shrink-0 pt-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={open}
                    onChange={e => toggleDayOpen(idx, e.target.checked)}
                    className="w-3.5 h-3.5 accent-teal-600"
                  />
                  <span className="text-xs font-medium text-gray-700">{label}</span>
                </label>
                {open ? (
                  <div className="flex-1 flex flex-wrap gap-2">
                    {intervals.map((iv, i) => (
                      <div key={i} className="flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1">
                        <input type="time" value={iv.start} onChange={e => updateInterval(idx, i, 'start', e.target.value)} className="text-xs bg-transparent w-[68px] focus:outline-none" />
                        <span className="text-gray-300 text-xs">–</span>
                        <input type="time" value={iv.end} onChange={e => updateInterval(idx, i, 'end', e.target.value)} className="text-xs bg-transparent w-[68px] focus:outline-none" />
                        <button onClick={() => removeInterval(idx, i)} className="text-gray-300 hover:text-red-500 transition ml-1">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                    <button onClick={() => addInterval(idx)} className="flex items-center gap-1 text-xs text-teal-700 hover:bg-teal-50 px-2 py-1 rounded-lg transition">
                      <Plus className="w-3 h-3" /> intervalo
                    </button>
                  </div>
                ) : (
                  <span className="text-xs text-gray-300 pt-1.5">Fechado</span>
                )}
              </div>
            )
          })}
        </div>

        <div className="flex items-center justify-end gap-3 mt-5">
          {savedAt && <span className="text-xs text-green-600">Salvo!</span>}
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-teal-700 rounded-lg hover:bg-teal-800 transition disabled:opacity-50"
          >
            {saving ? 'Salvando...' : 'Salvar agenda'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Ban className="w-4 h-4 text-red-500" />
          <h2 className="text-sm font-bold text-gray-800">Bloqueios (folga, feriado)</h2>
        </div>

        <div className="flex flex-wrap items-end gap-2 mb-4">
          <FieldRaw label="Data">
            <input type="date" value={blockForm.date} onChange={e => setBlockForm(f => ({ ...f, date: e.target.value }))} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </FieldRaw>
          <label className="flex items-center gap-1.5 text-xs text-gray-600 pb-2 cursor-pointer">
            <input type="checkbox" checked={blockForm.allDay} onChange={e => setBlockForm(f => ({ ...f, allDay: e.target.checked }))} className="w-3.5 h-3.5 accent-teal-600" />
            Dia inteiro
          </label>
          {!blockForm.allDay && (
            <>
              <FieldRaw label="Início">
                <input type="time" value={blockForm.start} onChange={e => setBlockForm(f => ({ ...f, start: e.target.value }))} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </FieldRaw>
              <FieldRaw label="Fim">
                <input type="time" value={blockForm.end} onChange={e => setBlockForm(f => ({ ...f, end: e.target.value }))} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </FieldRaw>
            </>
          )}
          <FieldRaw label="Motivo (opcional)">
            <input type="text" value={blockForm.reason} onChange={e => setBlockForm(f => ({ ...f, reason: e.target.value }))} placeholder="Ex: feriado" className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 w-40 focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </FieldRaw>
          <button onClick={handleCreateBlock} disabled={!blockForm.date} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-gray-700 rounded-lg hover:bg-gray-800 transition disabled:opacity-40">
            <Plus className="w-3.5 h-3.5" /> Bloquear
          </button>
        </div>

        {blocks.length === 0 ? (
          <p className="text-xs text-gray-400">Nenhum bloqueio cadastrado.</p>
        ) : (
          <div className="space-y-1.5">
            {blocks.map(b => (
              <div key={b.id} className="flex items-center justify-between text-xs bg-gray-50 rounded-lg px-3 py-2">
                <span className="text-gray-700">
                  {new Date(b.startDateTime).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  {' → '}
                  {new Date(b.endDateTime).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  {b.reason && <span className="text-gray-400"> · {b.reason}</span>}
                </span>
                <button onClick={() => handleDeleteBlock(b.id)} className="text-gray-300 hover:text-red-500 transition">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-4">
          <CalendarX className="w-4 h-4 text-teal-600" />
          <h2 className="text-sm font-bold text-gray-800">Próximos horários livres</h2>
          <span className="text-xs text-gray-400">— exatamente o que a IA vai enxergar</span>
        </div>
        {!schedule.enabled ? (
          <p className="text-xs text-gray-400">Ligue a agenda acima pra ver o preview.</p>
        ) : slots === null ? (
          <Loader2 className="w-4 h-4 text-teal-600 animate-spin" />
        ) : slots.every(d => d.closed || d.slots.length === 0) ? (
          <p className="text-xs text-gray-400">Nenhum horário livre nos próximos 7 dias.</p>
        ) : (
          <div className="space-y-1.5">
            {slots.filter(d => !d.closed).map(d => (
              <div key={d.date} className="flex items-center gap-2 text-xs">
                <span className="w-20 flex-shrink-0 text-gray-500 capitalize">{d.weekday} {d.date.split('-').reverse().slice(0, 2).join('/')}</span>
                {d.slots.length === 0 ? (
                  <span className="text-gray-300">lotado</span>
                ) : (
                  <span className="text-gray-700 font-mono">{d.slots.join(', ')}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function FieldSelect({ label, value, onChange, children }) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-gray-500 mb-1">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500">
        {children}
      </select>
    </div>
  )
}

function FieldNumber({ label, value, onChange, min, max }) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-gray-500 mb-1">{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={e => onChange(Math.max(min ?? 0, Number(e.target.value) || 0))}
        className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-500"
      />
    </div>
  )
}

function FieldRaw({ label, children }) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  )
}
