import { Plus, X, Copy } from 'lucide-react'
import { WEEKDAYS_LONG } from './time'

// Ordem de exibição: segunda → domingo
const ORDER = [1, 2, 3, 4, 5, 6, 0]
const DEFAULT_INTERVAL = { start: '09:00', end: '18:00' }

// Editor controlado de horários da semana ({ "1": [{start,end}], ... }). Dia sem intervalo = fechado.
export default function WeeklyHoursEditor({ value, onChange }) {
  const hours = value || {}

  const setDay = (day, intervals) => {
    const next = { ...hours }
    if (intervals.length) next[day] = intervals
    else delete next[day]
    onChange(next)
  }

  const copyToAll = (day) => {
    const src = hours[day] || []
    const next = {}
    for (const d of ORDER) if (src.length && (hours[d]?.length || d === day)) next[d] = src.map((iv) => ({ ...iv }))
    onChange(next)
  }

  return (
    <div className="space-y-1.5">
      {ORDER.map((day) => {
        const intervals = hours[day] || []
        const open = intervals.length > 0
        return (
          <div key={day} className="flex flex-wrap items-center gap-2 py-1">
            <label className="flex items-center gap-2 w-28 shrink-0 cursor-pointer">
              <input
                type="checkbox"
                checked={open}
                onChange={(e) => setDay(day, e.target.checked ? [{ ...DEFAULT_INTERVAL }] : [])}
                className="w-4 h-4 accent-pink-600"
              />
              <span className={`text-sm ${open ? 'text-gray-800 font-medium' : 'text-gray-400'}`}>{WEEKDAYS_LONG[day]}</span>
            </label>
            {!open && <span className="text-xs text-gray-400">Fechado</span>}
            {intervals.map((iv, i) => (
              <div key={i} className="flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1">
                <input type="time" value={iv.start} onChange={(e) => setDay(day, intervals.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} className="text-sm bg-transparent focus:outline-none" />
                <span className="text-gray-400 text-xs">até</span>
                <input type="time" value={iv.end} onChange={(e) => setDay(day, intervals.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} className="text-sm bg-transparent focus:outline-none" />
                {intervals.length > 1 && (
                  <button type="button" onClick={() => setDay(day, intervals.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500 ml-1" title="Remover intervalo">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
            {open && (
              <>
                <button
                  type="button"
                  onClick={() => setDay(day, [...intervals, { start: intervals[intervals.length - 1]?.end || '13:00', end: '18:00' }])}
                  className="text-xs text-pink-600 hover:text-pink-700 flex items-center gap-0.5"
                  title="Adicionar intervalo (ex.: depois do almoço)"
                >
                  <Plus className="w-3.5 h-3.5" /> intervalo
                </button>
                <button type="button" onClick={() => copyToAll(day)} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-0.5" title="Usar este horário em todos os dias abertos">
                  <Copy className="w-3 h-3" /> copiar p/ todos
                </button>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
