// Datas/horas da agenda sempre em Brasília (-03:00 fixo, sem horário de verão) —
// independe do fuso do computador de quem abre a tela.
const OFFSET_MS = 3 * 3600 * 1000

export const WEEKDAYS_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
export const WEEKDAYS_LONG = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
export const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

export function spParts(value) {
  const d = new Date(new Date(value).getTime() - OFFSET_MS)
  return {
    date: d.toISOString().slice(0, 10),
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
    weekday: d.getUTCDay(),
  }
}

export const todayStr = () => spParts(Date.now()).date
export const toISO = (dateStr, hhmm) => new Date(`${dateStr}T${hhmm}:00-03:00`).toISOString()
export const dayStartISO = (dateStr) => toISO(dateStr, '00:00')

export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export const weekdayOf = (dateStr) => new Date(`${dateStr}T12:00:00Z`).getUTCDay()

// Segunda-feira da semana da data
export function weekStart(dateStr) {
  const wd = weekdayOf(dateStr)
  return addDays(dateStr, wd === 0 ? -6 : 1 - wd)
}

export const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
export const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }

export function labelDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return `${WEEKDAYS_SHORT[weekdayOf(dateStr)]}, ${d} de ${MONTHS_SHORT[m - 1]}${y !== new Date().getFullYear() ? ` ${y}` : ''}`
}

export function durationLabel(min) {
  const h = Math.floor(min / 60)
  const m = min % 60
  return h ? (m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`) : `${m} min`
}

export const fmtBRL = (v) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))

// Intervalos de trabalho de um dia: os do profissional ou, se ele não tiver horário próprio, os do salão.
export function hoursForDay(prof, salonHours, weekday) {
  const own = prof?.weeklyHours && Object.keys(prof.weeklyHours).length ? prof.weeklyHours : salonHours || {}
  return own[String(weekday)] || []
}
