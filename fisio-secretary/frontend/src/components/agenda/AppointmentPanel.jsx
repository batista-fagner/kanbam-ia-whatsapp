import { useEffect, useMemo, useState } from 'react'
import { X, Loader2, Search, Bot, Hand, AlertTriangle, Check, Ban, UserX, CheckCircle2 } from 'lucide-react'
import { createAgendaAppointment, updateAgendaAppointment, searchAgendaClients } from '../../services/api'
import { durationLabel, fmtBRL, hhmm, labelDate, spParts, toISO, toMin } from './time'

const STATUS = {
  confirmado: { label: 'Confirmado', cls: 'bg-green-50 text-green-700' },
  agendado: { label: 'Agendado', cls: 'bg-blue-50 text-blue-700' },
  realizado: { label: 'Realizado', cls: 'bg-gray-100 text-gray-600' },
  nao_compareceu: { label: 'Faltou', cls: 'bg-orange-50 text-orange-700' },
  cancelado: { label: 'Cancelado', cls: 'bg-red-50 text-red-600' },
}

// Painel lateral: `draft` = novo agendamento ({ date, minutes, professionalId }); `appointment` = existente.
export default function AppointmentPanel({ draft, appointment, services, professionals, onClose, onSaved }) {
  const open = !!draft || !!appointment
  const isNew = !!draft
  const activeServices = services.filter((s) => s.active)
  const activeProfs = professionals.filter((p) => p.active)

  const initial = useMemo(() => {
    if (appointment) {
      const s = spParts(appointment.startDateTime)
      return {
        clientName: appointment.clientName, clientPhone: appointment.clientPhone || '', leadId: appointment.leadId,
        serviceId: appointment.serviceId || '', professionalId: appointment.professionalId || '',
        date: s.date, time: hhmm(s.minutes), notes: appointment.notes || '', value: appointment.value ?? '',
      }
    }
    if (draft) {
      return {
        clientName: '', clientPhone: '', leadId: null, serviceId: '', professionalId: draft.professionalId || '',
        date: draft.date, time: hhmm(draft.minutes ?? 540), notes: '', value: '',
      }
    }
    return null
  }, [draft, appointment])

  const [form, setForm] = useState(initial)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null) // { message, alternatives, conflict }

  useEffect(() => { setForm(initial); setQuery(''); setResults([]); setError(null) }, [initial])

  useEffect(() => {
    if (!isNew || query.trim().length < 2) { setResults([]); return }
    const t = setTimeout(() => searchAgendaClients(query).then(setResults).catch(() => setResults([])), 250)
    return () => clearTimeout(t)
  }, [query, isNew])

  if (!open || !form) return null

  const service = activeServices.find((s) => s.id === form.serviceId) || services.find((s) => s.id === form.serviceId)
  const ableProfs = activeProfs.filter((p) => !form.serviceId || (p.serviceIds || []).includes(form.serviceId))
  const prof = professionals.find((p) => p.id === form.professionalId)
  const endLabel = service && form.time ? hhmm(toMin(form.time) + service.durationMinutes) : null
  const st = appointment ? STATUS[appointment.status] : null
  const isActive = appointment ? ['agendado', 'confirmado'].includes(appointment.status) : true

  const changedWhen = appointment && (form.date !== initial.date || form.time !== initial.time || form.professionalId !== initial.professionalId || form.serviceId !== initial.serviceId)
  const changedInfo = appointment && (form.notes !== initial.notes || String(form.value ?? '') !== String(initial.value ?? ''))

  function pickService(id) {
    const s = activeServices.find((x) => x.id === id)
    setForm((f) => ({
      ...f,
      serviceId: id,
      value: isNew ? (s?.price ?? '') : f.value,
      professionalId: f.professionalId && s && !(activeProfs.find((p) => p.id === f.professionalId)?.serviceIds || []).includes(id) ? '' : f.professionalId,
    }))
  }

  async function submit(force = false) {
    setSaving(true)
    setError(null)
    try {
      if (isNew) {
        await createAgendaAppointment({
          clientName: form.clientName, clientPhone: form.clientPhone || null, leadId: form.leadId || null,
          serviceId: form.serviceId, professionalId: form.professionalId || null,
          startDateTime: toISO(form.date, form.time), notes: form.notes || null,
          value: form.value === '' ? null : Number(form.value), force,
        })
      } else {
        const payload = {}
        if (changedWhen) Object.assign(payload, { startDateTime: toISO(form.date, form.time), professionalId: form.professionalId || null, serviceId: form.serviceId || undefined, force })
        if (changedInfo) Object.assign(payload, { notes: form.notes || null, value: form.value === '' ? null : Number(form.value) })
        await updateAgendaAppointment(appointment.id, payload)
      }
      onSaved()
    } catch (e) {
      setError({ message: e.message, alternatives: e.alternatives || [], conflict: e.status === 409 })
    } finally {
      setSaving(false)
    }
  }

  async function setStatus(status) {
    if (status === 'cancelado' && !window.confirm('Cancelar este agendamento? O profissional recebe o aviso.')) return
    setSaving(true)
    try {
      await updateAgendaAppointment(appointment.id, { status })
      onSaved()
    } catch (e) {
      setError({ message: e.message, alternatives: [] })
    } finally {
      setSaving(false)
    }
  }

  const canSubmit = isNew
    ? form.clientName.trim() && form.serviceId && form.date && form.time
    : (changedWhen || changedInfo)

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <div className="w-full max-w-md h-full bg-white shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-800">{isNew ? 'Novo agendamento' : appointment.clientName}</h2>
            {appointment && (
              <div className="flex items-center gap-2 mt-1">
                {st && <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.cls}`}>{st.label}</span>}
                <span className="text-xs text-gray-400 flex items-center gap-1">
                  {appointment.source === 'ia' ? <><Bot className="w-3 h-3" /> marcado pela IA</> : <><Hand className="w-3 h-3" /> marcado pela recepção</>}
                </span>
              </div>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {isNew ? (
            <div>
              <label className="text-xs font-medium text-gray-500">Cliente</label>
              {form.leadId ? (
                <div className="mt-1 flex items-center justify-between bg-pink-50 border border-pink-100 rounded-lg px-3 py-2">
                  <div className="text-sm"><span className="font-medium text-gray-800">{form.clientName}</span> <span className="text-gray-500">{form.clientPhone}</span></div>
                  <button onClick={() => setForm({ ...form, leadId: null, clientName: '', clientPhone: '' })} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
                </div>
              ) : (
                <>
                  <div className="relative mt-1">
                    <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-2.5" />
                    <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar cliente do WhatsApp por nome ou telefone" className="w-full text-sm border border-gray-200 rounded-lg pl-8 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-500" />
                    {results.length > 0 && (
                      <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                        {results.map((r) => (
                          <button key={r.id} onClick={() => { setForm({ ...form, leadId: r.id, clientName: r.name || r.phone, clientPhone: r.phone }); setResults([]); setQuery('') }} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50">
                            <span className="font-medium text-gray-800">{r.name || 'Sem nome'}</span> <span className="text-gray-500">{r.phone}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="text-[11px] text-gray-400 mt-2 mb-1">ou cliente nova:</div>
                  <div className="grid grid-cols-2 gap-2">
                    <input value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} placeholder="Nome" className="text-sm border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-pink-500" />
                    <input value={form.clientPhone} onChange={(e) => setForm({ ...form, clientPhone: e.target.value })} placeholder="WhatsApp" className="text-sm border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-pink-500" />
                  </div>
                </>
              )}
            </div>
          ) : (
            appointment.clientPhone && <div className="text-sm text-gray-600">📱 {appointment.clientPhone}</div>
          )}

          <div>
            <label className="text-xs font-medium text-gray-500">Serviço</label>
            <select value={form.serviceId} onChange={(e) => pickService(e.target.value)} disabled={!isActive} className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-2.5 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-pink-500 disabled:bg-gray-50">
              <option value="">Escolha o serviço…</option>
              {activeServices.map((s) => <option key={s.id} value={s.id}>{s.name} · {durationLabel(s.durationMinutes)}{s.price ? ` · ${fmtBRL(s.price)}` : ''}</option>)}
              {service && !service.active && <option value={service.id}>{service.name} (desativado)</option>}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-gray-500">Dia</label>
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} disabled={!isActive} className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-2.5 py-2 disabled:bg-gray-50" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500">Horário {endLabel && <span className="text-gray-400 font-normal">até {endLabel}</span>}</label>
              <input type="time" step="300" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} disabled={!isActive} className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-2.5 py-2 disabled:bg-gray-50" />
            </div>
          </div>
          <div className="text-xs text-gray-400 -mt-2">{labelDate(form.date)}</div>

          <div>
            <label className="text-xs font-medium text-gray-500">Profissional</label>
            <select value={form.professionalId} onChange={(e) => setForm({ ...form, professionalId: e.target.value })} disabled={!isActive} className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-2.5 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-pink-500 disabled:bg-gray-50">
              <option value="">Escolher automaticamente (quem estiver livre)</option>
              {ableProfs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              {prof && !ableProfs.includes(prof) && <option value={prof.id}>{prof.name}</option>}
            </select>
            {form.serviceId && ableProfs.length === 0 && <div className="text-xs text-amber-600 mt-1">Nenhum profissional ativo faz esse serviço — marque em Configurar agenda → Profissionais.</div>}
          </div>

          <div className="grid grid-cols-[1fr_2fr] gap-2">
            <div>
              <label className="text-xs font-medium text-gray-500">Valor (R$)</label>
              <input type="number" min="0" step="0.01" value={form.value ?? ''} onChange={(e) => setForm({ ...form, value: e.target.value })} className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-2.5 py-2" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500">Observação</label>
              <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Ex.: traz o cabelo dela" className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-2.5 py-2" />
            </div>
          </div>
          {service?.priceNote && <div className="text-xs text-gray-500 -mt-2">Preço: {service.priceNote}</div>}

          {error && (
            <div className={`p-3 rounded-lg text-sm ${error.conflict ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-700'}`}>
              <div className="flex items-start gap-2"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {error.message}</div>
              {error.alternatives?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="text-xs">Livres:</span>
                  {error.alternatives.map((a) => (
                    <button key={`${a.date}${a.time}`} onClick={() => { setForm({ ...form, date: a.date, time: a.time }); setError(null) }} className="text-xs bg-white border border-amber-200 rounded-full px-2 py-0.5 hover:bg-amber-100">
                      {a.date.split('-').reverse().slice(0, 2).join('/')} {a.time}
                    </button>
                  ))}
                </div>
              )}
              {error.conflict && (
                <button onClick={() => submit(true)} disabled={saving} className="mt-2 text-xs font-medium underline">Marcar mesmo assim (encaixe)</button>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-100 space-y-2">
          {appointment && isActive && (
            <div className="grid grid-cols-3 gap-2">
              <button onClick={() => setStatus('realizado')} disabled={saving} className="text-xs border border-gray-200 rounded-lg py-2 hover:bg-gray-50 flex items-center justify-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Realizado</button>
              <button onClick={() => setStatus('nao_compareceu')} disabled={saving} className="text-xs border border-gray-200 rounded-lg py-2 hover:bg-gray-50 flex items-center justify-center gap-1"><UserX className="w-3.5 h-3.5" /> Faltou</button>
              <button onClick={() => setStatus('cancelado')} disabled={saving} className="text-xs border border-red-200 text-red-600 rounded-lg py-2 hover:bg-red-50 flex items-center justify-center gap-1"><Ban className="w-3.5 h-3.5" /> Cancelar</button>
            </div>
          )}
          {(isNew || isActive) && (
            <button onClick={() => submit(false)} disabled={saving || !canSubmit} className="w-full bg-pink-600 hover:bg-pink-700 text-white text-sm font-medium py-2.5 rounded-lg disabled:opacity-50 flex items-center justify-center gap-1.5">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {isNew ? 'Agendar' : 'Salvar alterações'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
