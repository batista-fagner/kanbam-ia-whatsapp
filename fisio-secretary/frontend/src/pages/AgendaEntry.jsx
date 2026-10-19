import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { getAgendaSettings } from '../services/api'
import CalendarPage from './CalendarPage'
import AgendaProPage from './AgendaProPage'

// /calendar: cliente com agenda de profissionais (ligada pelo admin, piloto) vê a agenda nova;
// todos os outros continuam com o calendário de sempre.
export default function AgendaEntry() {
  const [mode, setMode] = useState(null)
  useEffect(() => {
    getAgendaSettings().then((s) => setMode(s?.mode || 'simple')).catch(() => setMode('simple'))
  }, [])
  if (!mode) return <div className="flex items-center justify-center py-20 text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
  return mode === 'professionals' ? <AgendaProPage /> : <CalendarPage />
}
