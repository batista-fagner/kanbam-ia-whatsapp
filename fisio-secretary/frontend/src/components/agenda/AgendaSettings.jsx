import { useEffect, useState } from 'react'
import { X, Plus, Loader2, Check, Scissors, Users, Clock, Ban, Trash2, Bot } from 'lucide-react'
import {
  getAgendaSettings, updateAgendaSettings,
  listAgendaServices, createAgendaService, updateAgendaService,
  listAgendaProfessionals, createAgendaProfessional, updateAgendaProfessional,
  listAgendaBlocks, createAgendaBlock, deleteAgendaBlock,
} from '../../services/api'
import WeeklyHoursEditor from './WeeklyHoursEditor'
import { addDays, durationLabel, labelDate, spParts, todayStr, toISO } from './time'

const DURATIONS = [15, 30, 45, 60, 75, 90, 105, 120, 150, 180, 210, 240, 300, 360, 420, 480]
const COLORS = ['#db2777', '#7c3aed', '#2563eb', '#0d9488', '#16a34a', '#ca8a04', '#ea580c', '#dc2626', '#475569']

const TABS = [
  { key: 'services', label: 'Serviços', icon: Scissors },
  { key: 'professionals', label: 'Profissionais', icon: Users },
  { key: 'rules', label: 'Horários e regras', icon: Clock },
  { key: 'blocks', label: 'Folgas e bloqueios', icon: Ban },
]

export default function AgendaSettings({ open, onClose, onChanged, initialTab = 'services' }) {
  const [tab, setTab] = useState(initialTab)
  const [services, setServices] = useState([])
  const [professionals, setProfessionals] = useState([])
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const [s, p, cfg] = await Promise.all([listAgendaServices(), listAgendaProfessionals(), getAgendaSettings()])
      setServices(s)
      setProfessionals(p)
      setSettings(cfg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (open) { setTab(initialTab); load() } }, [open])

  if (!open) return null

  const changed = () => { load(); onChanged?.() }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-stretch sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-4xl sm:rounded-2xl shadow-xl flex flex-col max-h-full sm:max-h-[92vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-800">Configurar agenda</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex gap-1 px-3 sm:px-5 pt-3 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm whitespace-nowrap transition ${tab === t.key ? 'bg-pink-50 text-pink-700 font-medium' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              <t.icon className="w-4 h-4" /> {t.label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto px-3 sm:px-5 py-4">
          {loading ? (
            <div className="flex items-center gap-2 text-gray-400 text-sm py-10 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Carregando…</div>
          ) : tab === 'services' ? (
            <ServicesTab services={services} onChanged={changed} />
          ) : tab === 'professionals' ? (
            <ProfessionalsTab professionals={professionals} services={services} onChanged={changed} goServices={() => setTab('services')} />
          ) : tab === 'rules' ? (
            <RulesTab settings={settings} onChanged={changed} />
          ) : (
            <BlocksTab professionals={professionals} onChanged={changed} />
          )}
        </div>
      </div>
    </div>
  )
}

// ───────── Serviços ─────────

function ServicesTab({ services, onChanged }) {
  const [adding, setAdding] = useState(services.length === 0)
  const active = services.filter((s) => s.active)
  const inactive = services.filter((s) => !s.active)
  return (
    <div>
      <p className="text-sm text-gray-500 mb-4">Cada serviço tem uma duração: é o tempo que o horário fica ocupado na agenda. A IA só oferece horários em que o serviço inteiro cabe.</p>
      <div className="space-y-2">
        {active.map((s) => <ServiceRow key={s.id} service={s} onSaved={onChanged} />)}
        {adding && <ServiceRow onSaved={() => { setAdding(false); onChanged() }} onCancel={() => setAdding(false)} />}
      </div>
      {!adding && (
        <button onClick={() => setAdding(true)} className="mt-3 flex items-center gap-1.5 text-sm text-pink-600 hover:text-pink-700 font-medium">
          <Plus className="w-4 h-4" /> Novo serviço
        </button>
      )}
      {inactive.length > 0 && (
        <div className="mt-6">
          <div className="text-xs font-medium text-gray-400 mb-2">Desativados</div>
          <div className="space-y-2 opacity-60">{inactive.map((s) => <ServiceRow key={s.id} service={s} onSaved={onChanged} />)}</div>
        </div>
      )}
    </div>
  )
}

function ServiceRow({ service, onSaved, onCancel }) {
  const isNew = !service
  const [form, setForm] = useState({
    name: service?.name ?? '',
    durationMinutes: service?.durationMinutes ?? 60,
    price: service?.price ?? '',
    priceNote: service?.priceNote ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const dirty = isNew || form.name !== service.name || Number(form.durationMinutes) !== service.durationMinutes
    || String(form.price ?? '') !== String(service.price ?? '') || (form.priceNote || '') !== (service.priceNote || '')

  async function save() {
    setSaving(true)
    setError('')
    try {
      const payload = { name: form.name, durationMinutes: Number(form.durationMinutes), price: form.price === '' ? null : Number(form.price), priceNote: form.priceNote || null }
      if (isNew) await createAgendaService(payload)
      else await updateAgendaService(service.id, payload)
      onSaved()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive() {
    await updateAgendaService(service.id, { active: !service.active })
    onSaved()
  }

  return (
    <div className="border border-gray-200 rounded-xl p-3">
      <div className="grid grid-cols-2 sm:grid-cols-[2fr_1fr_1fr_1.5fr] gap-2">
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nome do serviço (ex.: Fita adesiva)" className="col-span-2 sm:col-span-1 text-sm border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-pink-500" />
        <select value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })} className="text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-pink-500" title="Duração">
          {DURATIONS.map((d) => <option key={d} value={d}>{durationLabel(d)}</option>)}
        </select>
        <input type="number" min="0" step="0.01" value={form.price ?? ''} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="Preço R$" className="text-sm border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-pink-500" />
        <input value={form.priceNote ?? ''} onChange={(e) => setForm({ ...form, priceNote: e.target.value })} placeholder="Obs. de preço (ex.: R$ 4 por grama)" className="col-span-2 sm:col-span-1 text-sm border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-pink-500" />
      </div>
      {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
      <div className="flex items-center justify-end gap-2 mt-2">
        {!isNew && (
          <button onClick={toggleActive} className="text-xs text-gray-400 hover:text-gray-600 mr-auto">
            {service.active ? 'Desativar' : 'Reativar'}
          </button>
        )}
        {isNew && onCancel && <button onClick={onCancel} className="text-xs text-gray-500 px-2 py-1">Cancelar</button>}
        {dirty && (
          <button onClick={save} disabled={saving || !form.name.trim()} className="text-xs bg-pink-600 hover:bg-pink-700 text-white px-3 py-1.5 rounded-lg disabled:opacity-50 flex items-center gap-1">
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} {isNew ? 'Adicionar' : 'Salvar'}
          </button>
        )}
      </div>
    </div>
  )
}

// ───────── Profissionais ─────────

function ProfessionalsTab({ professionals, services, onChanged, goServices }) {
  const [adding, setAdding] = useState(professionals.length === 0)
  const activeServices = services.filter((s) => s.active)
  const active = professionals.filter((p) => p.active)
  const inactive = professionals.filter((p) => !p.active)
  return (
    <div>
      <p className="text-sm text-gray-500 mb-4">
        Marque os serviços que cada profissional faz. O sistema escolhe sozinho quem está livre. Com o WhatsApp preenchido, o profissional recebe um aviso a cada agendamento, remarcação ou cancelamento.
      </p>
      {activeServices.length === 0 && (
        <div className="mb-4 p-3 bg-amber-50 text-amber-700 rounded-lg text-sm">
          Cadastre os serviços primeiro. <button onClick={goServices} className="underline font-medium">Ir para Serviços</button>
        </div>
      )}
      <div className="space-y-3">
        {active.map((p) => <ProfessionalCard key={p.id} professional={p} services={activeServices} onSaved={onChanged} />)}
        {adding && <ProfessionalCard services={activeServices} onSaved={() => { setAdding(false); onChanged() }} onCancel={() => setAdding(false)} defaultColor={COLORS[active.length % COLORS.length]} />}
      </div>
      {!adding && (
        <button onClick={() => setAdding(true)} className="mt-3 flex items-center gap-1.5 text-sm text-pink-600 hover:text-pink-700 font-medium">
          <Plus className="w-4 h-4" /> Novo profissional
        </button>
      )}
      {inactive.length > 0 && (
        <div className="mt-6">
          <div className="text-xs font-medium text-gray-400 mb-2">Desativados</div>
          <div className="space-y-2 opacity-60">{inactive.map((p) => <ProfessionalCard key={p.id} professional={p} services={activeServices} onSaved={onChanged} />)}</div>
        </div>
      )}
    </div>
  )
}

function ProfessionalCard({ professional, services, onSaved, onCancel, defaultColor }) {
  const isNew = !professional
  const [form, setForm] = useState({
    name: professional?.name ?? '',
    color: professional?.color ?? defaultColor ?? COLORS[0],
    whatsapp: professional?.whatsapp ?? '',
    notify: professional?.notify ?? true,
    serviceIds: professional?.serviceIds ?? [],
    ownHours: !!(professional?.weeklyHours && Object.keys(professional.weeklyHours).length),
    weeklyHours: professional?.weeklyHours && Object.keys(professional.weeklyHours).length ? professional.weeklyHours : { 1: [{ start: '09:00', end: '18:00' }], 2: [{ start: '09:00', end: '18:00' }], 3: [{ start: '09:00', end: '18:00' }], 4: [{ start: '09:00', end: '18:00' }], 5: [{ start: '09:00', end: '18:00' }], 6: [{ start: '09:00', end: '14:00' }] },
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const toggleService = (id) => setForm((f) => ({ ...f, serviceIds: f.serviceIds.includes(id) ? f.serviceIds.filter((x) => x !== id) : [...f.serviceIds, id] }))

  async function save() {
    setSaving(true)
    setError('')
    try {
      const payload = {
        name: form.name,
        color: form.color,
        whatsapp: form.whatsapp || null,
        notify: form.notify,
        serviceIds: form.serviceIds,
        weeklyHours: form.ownHours ? form.weeklyHours : {},
      }
      if (isNew) await createAgendaProfessional(payload)
      else await updateAgendaProfessional(professional.id, payload)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onSaved()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive() {
    await updateAgendaProfessional(professional.id, { active: !professional.active })
    onSaved()
  }

  return (
    <div className="border border-gray-200 rounded-xl p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {COLORS.map((c) => (
            <button key={c} type="button" onClick={() => setForm({ ...form, color: c })} className={`w-5 h-5 rounded-full border-2 ${form.color === c ? 'border-gray-800' : 'border-transparent'}`} style={{ background: c }} title="Cor na agenda" />
          ))}
        </div>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nome do profissional" className="flex-1 min-w-[160px] text-sm font-medium border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-pink-500" />
        <input value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} placeholder="WhatsApp (DDD + número)" className="w-48 text-sm border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-pink-500" />
        <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
          <input type="checkbox" checked={form.notify} onChange={(e) => setForm({ ...form, notify: e.target.checked })} className="accent-pink-600" />
          Avisar no WhatsApp
        </label>
      </div>

      <div className="mt-3">
        <div className="text-xs font-medium text-gray-500 mb-1.5">Serviços que faz</div>
        <div className="flex flex-wrap gap-1.5">
          {services.length === 0 && <span className="text-xs text-gray-400">Nenhum serviço cadastrado.</span>}
          {services.map((s) => {
            const on = form.serviceIds.includes(s.id)
            return (
              <button key={s.id} type="button" onClick={() => toggleService(s.id)} className={`text-xs px-2.5 py-1 rounded-full border transition ${on ? 'bg-pink-600 border-pink-600 text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-pink-300'}`}>
                {on && '✓ '}{s.name}
              </button>
            )
          })}
        </div>
      </div>

      <div className="mt-3">
        <div className="flex items-center gap-4 text-xs text-gray-600 mb-2">
          <span className="font-medium text-gray-500">Horário</span>
          <label className="flex items-center gap-1 cursor-pointer"><input type="radio" checked={!form.ownHours} onChange={() => setForm({ ...form, ownHours: false })} className="accent-pink-600" /> Igual ao do salão</label>
          <label className="flex items-center gap-1 cursor-pointer"><input type="radio" checked={form.ownHours} onChange={() => setForm({ ...form, ownHours: true })} className="accent-pink-600" /> Horário próprio</label>
        </div>
        {form.ownHours && <WeeklyHoursEditor value={form.weeklyHours} onChange={(weeklyHours) => setForm({ ...form, weeklyHours })} />}
      </div>

      {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
      <div className="flex items-center justify-end gap-2 mt-3">
        {!isNew && <button onClick={toggleActive} className="text-xs text-gray-400 hover:text-gray-600 mr-auto">{professional.active ? 'Desativar' : 'Reativar'}</button>}
        {isNew && onCancel && <button onClick={onCancel} className="text-xs text-gray-500 px-2 py-1">Cancelar</button>}
        <button onClick={save} disabled={saving || !form.name.trim()} className="text-xs bg-pink-600 hover:bg-pink-700 text-white px-3 py-1.5 rounded-lg disabled:opacity-50 flex items-center gap-1">
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} {isNew ? 'Adicionar' : saved ? 'Salvo' : 'Salvar'}
        </button>
      </div>
    </div>
  )
}

// ───────── Horários e regras ─────────

function RulesTab({ settings, onChanged }) {
  const [form, setForm] = useState({
    weeklyHours: settings?.weeklyHours ?? {},
    slotMinutes: [15, 30, 60].includes(settings?.slotMinutes) ? settings.slotMinutes : 30,
    minNoticeHours: settings?.minNoticeHours ?? 2,
    bookingWindowDays: settings?.bookingWindowDays ?? 30,
    enabled: !!settings?.enabled,
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    setSaving(true)
    setError('')
    try {
      await updateAgendaSettings({ ...form, minNoticeHours: Number(form.minNoticeHours), bookingWindowDays: Number(form.bookingWindowDays) })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onChanged()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <label className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer ${form.enabled ? 'border-pink-300 bg-pink-50' : 'border-gray-200'}`}>
        <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} className="mt-0.5 w-4 h-4 accent-pink-600" />
        <div>
          <div className="text-sm font-medium text-gray-800 flex items-center gap-1.5"><Bot className="w-4 h-4" /> A IA pode agendar sozinha pelo WhatsApp</div>
          <div className="text-xs text-gray-500 mt-0.5">Ela consulta os horários livres, marca, remarca e cancela direto nesta agenda. Desligado: a agenda funciona só pela recepção.</div>
        </div>
      </label>

      <div>
        <div className="text-sm font-medium text-gray-800 mb-1">Horário de funcionamento do salão</div>
        <div className="text-xs text-gray-500 mb-3">Vale para quem estiver com "Igual ao do salão".</div>
        <WeeklyHoursEditor value={form.weeklyHours} onChange={(weeklyHours) => setForm({ ...form, weeklyHours })} />
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <label className="block">
          <span className="text-xs font-medium text-gray-500">Horários começam de</span>
          <select value={form.slotMinutes} onChange={(e) => setForm({ ...form, slotMinutes: Number(e.target.value) })} className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white">
            <option value={15}>15 em 15 min</option>
            <option value={30}>30 em 30 min</option>
            <option value={60}>1 em 1 hora</option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-gray-500">Antecedência mínima (horas)</span>
          <input type="number" min="0" value={form.minNoticeHours} onChange={(e) => setForm({ ...form, minNoticeHours: e.target.value })} className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-2.5 py-2" />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-gray-500">Agenda aberta até (dias à frente)</span>
          <input type="number" min="1" max="90" value={form.bookingWindowDays} onChange={(e) => setForm({ ...form, bookingWindowDays: e.target.value })} className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-2.5 py-2" />
        </label>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}
      <div className="flex justify-end">
        <button onClick={save} disabled={saving} className="text-sm bg-pink-600 hover:bg-pink-700 text-white px-4 py-2 rounded-lg disabled:opacity-50 flex items-center gap-1.5">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {saved ? 'Salvo' : 'Salvar'}
        </button>
      </div>
    </div>
  )
}

// ───────── Folgas e bloqueios ─────────

function BlocksTab({ professionals, onChanged }) {
  const [blocks, setBlocks] = useState([])
  const [form, setForm] = useState({ date: todayStr(), allDay: true, start: '12:00', end: '13:00', professionalId: '', reason: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const profName = (id) => professionals.find((p) => p.id === id)?.name

  async function load() {
    const today = todayStr()
    setBlocks(await listAgendaBlocks(toISO(today, '00:00'), toISO(addDays(today, 120), '00:00')))
  }
  useEffect(() => { load() }, [])

  async function add() {
    setSaving(true)
    setError('')
    try {
      const startDateTime = form.allDay ? toISO(form.date, '00:00') : toISO(form.date, form.start)
      const endDateTime = form.allDay ? toISO(addDays(form.date, 1), '00:00') : toISO(form.date, form.end)
      await createAgendaBlock({ startDateTime, endDateTime, professionalId: form.professionalId || null, reason: form.reason || null })
      setForm({ ...form, reason: '' })
      await load()
      onChanged()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function remove(id) {
    await deleteAgendaBlock(id)
    await load()
    onChanged()
  }

  return (
    <div>
      <p className="text-sm text-gray-500 mb-4">Folga, feriado, almoço fora do comum ou curso: nesse período ninguém (ou só o profissional escolhido) recebe agendamento.</p>
      <div className="border border-gray-200 rounded-xl p-3 flex flex-wrap items-end gap-2">
        <label className="block"><span className="text-xs text-gray-500">Dia</span>
          <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="block mt-1 text-sm border border-gray-200 rounded-lg px-2 py-1.5" />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-gray-600 pb-2 cursor-pointer">
          <input type="checkbox" checked={form.allDay} onChange={(e) => setForm({ ...form, allDay: e.target.checked })} className="accent-pink-600" /> Dia inteiro
        </label>
        {!form.allDay && (
          <>
            <label className="block"><span className="text-xs text-gray-500">De</span><input type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} className="block mt-1 text-sm border border-gray-200 rounded-lg px-2 py-1.5" /></label>
            <label className="block"><span className="text-xs text-gray-500">Até</span><input type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} className="block mt-1 text-sm border border-gray-200 rounded-lg px-2 py-1.5" /></label>
          </>
        )}
        <label className="block"><span className="text-xs text-gray-500">Quem</span>
          <select value={form.professionalId} onChange={(e) => setForm({ ...form, professionalId: e.target.value })} className="block mt-1 text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
            <option value="">Salão inteiro</option>
            {professionals.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="block flex-1 min-w-[140px]"><span className="text-xs text-gray-500">Motivo</span>
          <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Ex.: feriado" className="block mt-1 w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5" />
        </label>
        <button onClick={add} disabled={saving} className="text-sm bg-pink-600 hover:bg-pink-700 text-white px-3 py-1.5 rounded-lg disabled:opacity-50 flex items-center gap-1">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Bloquear
        </button>
      </div>
      {error && <div className="text-sm text-red-600 mt-2">{error}</div>}

      <div className="mt-4 divide-y divide-gray-100 border border-gray-100 rounded-xl">
        {blocks.length === 0 && <div className="text-sm text-gray-400 p-4 text-center">Nenhum bloqueio nos próximos meses.</div>}
        {blocks.map((b) => {
          const s = spParts(b.startDateTime)
          const e = spParts(b.endDateTime)
          const allDay = s.minutes === 0 && e.minutes === 0
          return (
            <div key={b.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <div className="flex-1">
                <span className="font-medium text-gray-800">{labelDate(s.date)}</span>
                <span className="text-gray-500"> · {allDay ? 'dia inteiro' : `${String(Math.floor(s.minutes / 60)).padStart(2, '0')}:${String(s.minutes % 60).padStart(2, '0')} – ${String(Math.floor(e.minutes / 60)).padStart(2, '0')}:${String(e.minutes % 60).padStart(2, '0')}`}</span>
                <span className="text-gray-500"> · {b.professionalId ? profName(b.professionalId) || 'Profissional' : 'Salão inteiro'}</span>
                {b.reason && <span className="text-gray-400"> · {b.reason}</span>}
              </div>
              <button onClick={() => remove(b.id)} className="text-gray-300 hover:text-red-500" title="Remover bloqueio"><Trash2 className="w-4 h-4" /></button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
