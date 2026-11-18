import { useEffect, useMemo, useState } from 'react'
import { Instagram, Plus, Pencil, Trash2, Loader2, ExternalLink, MessageCircle, X, AlertTriangle, CheckCircle2 } from 'lucide-react'
import {
  getInstagramStatus, updateInstagramSettings, getInstagramMedia, getInstagramAutomations,
  createInstagramAutomation, updateInstagramAutomation, deleteInstagramAutomation, getInstagramEvents,
} from '../services/api'

// Automação de Instagram da cliente: quem comenta num post escolhido (qualquer comentário ou
// palavra-chave) ou manda Direct recebe uma mensagem com botão para o WhatsApp dela.
// O backend (backend/src/instagram) é quem envia; aqui só se configura.

const BUTTON_MAX = 20
const DM_MAX = 640
const DEFAULT_WA_TEXT = 'Oi! Vim pelo Instagram 😊'

const onlyDigits = (s) => String(s ?? '').replace(/\D/g, '')
function waLink(phone, text) {
  let d = onlyDigits(phone)
  if (!d) return null
  if (d.length === 10 || d.length === 11) d = `55${d}`
  const t = (text ?? '').trim()
  return t ? `https://wa.me/${d}?text=${encodeURIComponent(t)}` : `https://wa.me/${d}`
}
const preview = (tpl) => (tpl ?? '').replace(/\{nome\}/gi, '@cliente')

const ACTION = {
  sent: { label: 'Enviado', cls: 'text-teal-700 bg-teal-50' },
  no_match: { label: 'Sem palavra-chave', cls: 'text-gray-600 bg-gray-100' },
  cooldown: { label: 'Já tinha recebido', cls: 'text-amber-700 bg-amber-50' },
  disabled: { label: 'Resposta desligada', cls: 'text-gray-600 bg-gray-100' },
  failed: { label: 'Erro', cls: 'text-red-700 bg-red-50' },
  received: { label: 'Processando', cls: 'text-gray-600 bg-gray-100' },
}

const field = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-300'

function MessagePreview({ text, buttonLabel, link }) {
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
      <p className="text-xs text-gray-400 mb-2">Prévia do Direct</p>
      <div className="max-w-xs bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <p className="text-sm text-gray-800 px-3 py-2.5 whitespace-pre-wrap">{preview(text) || <span className="text-gray-400">Escreva a mensagem…</span>}</p>
        <div className="border-t border-gray-100 text-center text-sm font-medium text-blue-600 py-2">{(buttonLabel || 'Falar no WhatsApp').slice(0, BUTTON_MAX)}</div>
      </div>
      {link
        ? <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-pink-700 mt-2 hover:underline">Testar o link do WhatsApp <ExternalLink className="w-3 h-3" /></a>
        : <p className="text-xs text-red-600 mt-2">Sem número de WhatsApp: a mensagem vai sem botão.</p>}
    </div>
  )
}

function PostPicker({ selectedId, onPick }) {
  const [posts, setPosts] = useState([])
  const [after, setAfter] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load(cursor) {
    setLoading(true); setError('')
    try {
      const r = await getInstagramMedia(cursor)
      setPosts((p) => (cursor ? [...p, ...r.data] : r.data))
      setAfter(r.after)
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  return (
    <div>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {posts.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onPick(p)}
            className={`relative aspect-square rounded-lg overflow-hidden border-2 ${selectedId === p.id ? 'border-pink-600' : 'border-transparent hover:border-pink-200'}`}
            title={p.caption}
          >
            {p.thumbnail ? <img src={p.thumbnail} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full bg-gray-100" />}
            {p.mediaType === 'VIDEO' && <span className="absolute top-1 right-1 text-[10px] bg-black/60 text-white px-1.5 rounded">vídeo</span>}
            {selectedId === p.id && <CheckCircle2 className="absolute bottom-1 right-1 w-5 h-5 text-white drop-shadow" />}
          </button>
        ))}
      </div>
      {loading && <Loader2 className="w-4 h-4 animate-spin text-gray-400 mt-3" />}
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      {!loading && after && <button type="button" onClick={() => load(after)} className="mt-3 text-xs text-pink-700 hover:underline">Carregar mais posts</button>}
    </div>
  )
}

function AutomationEditor({ initial, defaultPhone, onClose, onSaved }) {
  const [f, setF] = useState(() => ({
    postId: initial?.postId ?? '',
    postCaption: initial?.postCaption ?? '',
    postThumbnail: initial?.postThumbnail ?? '',
    postPermalink: initial?.postPermalink ?? '',
    triggerMode: initial?.triggerMode ?? 'keyword',
    keywords: initial?.keywords ?? 'eu quero',
    dmText: initial?.dmText ?? 'Oi {nome}! 💜 Que bom que você gostou. Clica no botão abaixo que eu te atendo no WhatsApp 👇',
    buttonLabel: initial?.buttonLabel ?? 'Falar no WhatsApp',
    commentReply: initial?.commentReply ?? 'Te chamei no direct! 💜',
    whatsappPhone: initial?.whatsappPhone ?? '',
    whatsappText: initial?.whatsappText ?? DEFAULT_WA_TEXT,
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (patch) => setF((x) => ({ ...x, ...patch }))
  const link = waLink(f.whatsappPhone || defaultPhone, f.whatsappText)

  async function save() {
    setBusy(true); setError('')
    try {
      const saved = initial?.id ? await updateInstagramAutomation(initial.id, f) : await createInstagramAutomation(f)
      onSaved(saved)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="w-full max-w-xl bg-white h-full overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-center justify-between">
          <h2 className="font-semibold text-gray-800">{initial?.id ? 'Editar automação' : 'Nova automação'}</h2>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-100"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-5">
          <section>
            <p className="text-sm font-medium text-gray-700 mb-2">1. Qual post?</p>
            {initial?.id
              ? <div className="flex gap-3 items-center">
                  {f.postThumbnail && <img src={f.postThumbnail} alt="" className="w-16 h-16 rounded-lg object-cover" />}
                  <p className="text-xs text-gray-500 line-clamp-3">{f.postCaption || 'Post sem legenda'}</p>
                </div>
              : <PostPicker selectedId={f.postId} onPick={(p) => set({ postId: p.id, postCaption: p.caption, postThumbnail: p.thumbnail ?? '', postPermalink: p.permalink ?? '' })} />}
          </section>

          <section>
            <p className="text-sm font-medium text-gray-700 mb-2">2. Quando enviar?</p>
            <div className="flex flex-col gap-2 text-sm text-gray-700">
              <label className="flex items-center gap-2"><input type="radio" checked={f.triggerMode === 'any'} onChange={() => set({ triggerMode: 'any' })} /> Qualquer comentário</label>
              <label className="flex items-center gap-2"><input type="radio" checked={f.triggerMode === 'keyword'} onChange={() => set({ triggerMode: 'keyword' })} /> Só quem escrever uma palavra-chave</label>
            </div>
            {f.triggerMode === 'keyword' && (
              <>
                <textarea rows={2} value={f.keywords} onChange={(e) => set({ keywords: e.target.value })} className={`${field} mt-2`} placeholder="eu quero, preço, valor" />
                <p className="text-xs text-gray-400 mt-1">Separe por vírgula. Não importa acento nem maiúscula: "Eu QUERO!" bate com "eu quero".</p>
              </>
            )}
          </section>

          <section>
            <p className="text-sm font-medium text-gray-700 mb-2">3. Mensagem no Direct</p>
            <textarea rows={4} maxLength={DM_MAX} value={f.dmText} onChange={(e) => set({ dmText: e.target.value })} className={field} />
            <p className="text-xs text-gray-400 mt-1">Use {'{nome}'} para colocar o @ da pessoa. {f.dmText.length}/{DM_MAX}</p>
            <label className="block text-xs text-gray-600 mt-3 mb-1">Texto do botão (até {BUTTON_MAX} letras)</label>
            <input maxLength={BUTTON_MAX} value={f.buttonLabel} onChange={(e) => set({ buttonLabel: e.target.value })} className={field} />
          </section>

          <section>
            <p className="text-sm font-medium text-gray-700 mb-2">4. WhatsApp</p>
            <label className="block text-xs text-gray-600 mb-1">Número (vazio = o padrão da conta{defaultPhone ? `: ${defaultPhone}` : ''})</label>
            <input value={f.whatsappPhone} onChange={(e) => set({ whatsappPhone: e.target.value })} className={field} placeholder={defaultPhone || '71 99999-9999'} />
            <label className="block text-xs text-gray-600 mt-3 mb-1">Mensagem que já aparece escrita no WhatsApp da cliente</label>
            <input value={f.whatsappText} onChange={(e) => set({ whatsappText: e.target.value })} className={field} />
          </section>

          <section>
            <p className="text-sm font-medium text-gray-700 mb-2">5. Resposta pública no comentário (opcional)</p>
            <input value={f.commentReply} onChange={(e) => set({ commentReply: e.target.value })} className={field} placeholder="Deixe vazio para não responder em público" />
          </section>

          <MessagePreview text={f.dmText} buttonLabel={f.buttonLabel} link={link} />

          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2 justify-end pb-6">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50">Cancelar</button>
            <button onClick={save} disabled={busy || !f.postId} className="px-4 py-2 text-sm font-medium text-white bg-pink-600 rounded-lg hover:bg-pink-700 disabled:opacity-40">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Salvar automação'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function DmSettings({ status, onSaved }) {
  const s = status.settings
  const [f, setF] = useState({ ...s, whatsappPhone: s.whatsappPhone ?? '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const set = (patch) => { setF((x) => ({ ...x, ...patch })); setMsg('') }

  async function save() {
    setBusy(true); setError(''); setMsg('')
    try { onSaved(await updateInstagramSettings(f)); setMsg('Salvo.') } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="border border-gray-200 rounded-xl p-5 space-y-4">
      <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
        <input type="checkbox" checked={f.dmEnabled} onChange={(e) => set({ dmEnabled: e.target.checked })} />
        Responder automaticamente quem mandar Direct
      </label>
      <div>
        <label className="block text-xs text-gray-600 mb-1">Mensagem</label>
        <textarea rows={3} maxLength={DM_MAX} value={f.dmText} onChange={(e) => set({ dmText: e.target.value })} className={field} placeholder="Oi {nome}! Para te atender mais rápido, me chama no WhatsApp 👇" />
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-600 mb-1">Texto do botão (até {BUTTON_MAX} letras)</label>
          <input maxLength={BUTTON_MAX} value={f.dmButtonLabel} onChange={(e) => set({ dmButtonLabel: e.target.value })} className={field} />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Número do WhatsApp (padrão da conta)</label>
          <input value={f.whatsappPhone} onChange={(e) => set({ whatsappPhone: e.target.value })} className={field} placeholder="71 99999-9999" />
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-600 mb-1">Mensagem que já aparece escrita no WhatsApp</label>
        <input value={f.dmWhatsappText} onChange={(e) => set({ dmWhatsappText: e.target.value })} className={field} />
      </div>
      <div>
        <label className="block text-xs text-gray-600 mb-1">Intervalo entre mensagens automáticas para a mesma pessoa (horas)</label>
        <input type="number" min={0} max={720} value={f.cooldownHours} onChange={(e) => set({ cooldownHours: e.target.value })} className={`${field} max-w-[140px]`} />
        <p className="text-xs text-gray-400 mt-1">Quem já recebeu (por comentário ou Direct) não recebe de novo nesse intervalo. Evita parecer spam.</p>
      </div>
      <MessagePreview text={f.dmText} buttonLabel={f.dmButtonLabel} link={waLink(f.whatsappPhone, f.dmWhatsappText)} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      {msg && <p className="text-sm text-teal-700">{msg}</p>}
      <div className="flex justify-end">
        <button onClick={save} disabled={busy} className="px-4 py-2 text-sm font-medium text-white bg-pink-600 rounded-lg hover:bg-pink-700 disabled:opacity-40">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Salvar'}
        </button>
      </div>
    </div>
  )
}

export default function InstagramPage() {
  const [status, setStatus] = useState(null)
  const [automations, setAutomations] = useState([])
  const [events, setEvents] = useState([])
  const [editing, setEditing] = useState(null) // null | {} (nova) | automação
  const [error, setError] = useState('')

  async function loadAll() {
    try {
      const s = await getInstagramStatus()
      setStatus(s)
      if (s.connected) {
        const [a, e] = await Promise.all([getInstagramAutomations(), getInstagramEvents()])
        setAutomations(a); setEvents(e)
      }
    } catch (e) { setError(e.message) }
  }
  useEffect(() => { loadAll() }, [])

  const autoById = useMemo(() => Object.fromEntries(automations.map((a) => [a.id, a])), [automations])

  async function toggle(a) {
    try {
      const saved = await updateInstagramAutomation(a.id, { active: !a.active })
      setAutomations((list) => list.map((x) => (x.id === a.id ? saved : x)))
    } catch (e) { setError(e.message) }
  }
  async function remove(a) {
    if (!window.confirm('Excluir esta automação? Quem comentar no post deixa de receber a mensagem.')) return
    try { await deleteInstagramAutomation(a.id); setAutomations((l) => l.filter((x) => x.id !== a.id)) } catch (e) { setError(e.message) }
  }

  if (!status) {
    return <div className="p-8">{error ? <p className="text-sm text-red-600">{error}</p> : <Loader2 className="w-5 h-5 animate-spin text-gray-400" />}</div>
  }

  if (!status.connected) {
    return (
      <div className="p-4 sm:p-8 max-w-4xl mx-auto">
        <h1 className="text-xl font-bold text-gray-800 mb-2 flex items-center gap-2"><Instagram className="w-5 h-5 text-pink-600" /> Instagram</h1>
        <p className="text-sm text-gray-500">Seu Instagram ainda não está conectado. Fale com o suporte da Convert Hair para conectar.</p>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-8 max-w-4xl mx-auto">
      <h1 className="text-xl font-bold text-gray-800 mb-1 flex items-center gap-2"><Instagram className="w-5 h-5 text-pink-600" /> Instagram</h1>
      <p className="text-sm text-gray-500 mb-6">
        Conectado como <strong>@{status.username}</strong>. Quem comentar nos posts escolhidos ou mandar Direct recebe uma mensagem com botão para o seu WhatsApp, onde a sua IA continua o atendimento.
      </p>
      {status.lastError && (
        <div className="flex gap-2 items-start text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-6">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> <span>Último aviso do Instagram: {status.lastError}</span>
        </div>
      )}
      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-800">Comentários nos posts</h2>
        <button onClick={() => setEditing({})} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-pink-600 rounded-lg hover:bg-pink-700">
          <Plus className="w-4 h-4" /> Nova automação
        </button>
      </div>
      {automations.length === 0 && <p className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-xl p-5 mb-8">Nenhuma automação ainda. Clique em "Nova automação" e escolha o post.</p>}
      <div className="space-y-3 mb-8">
        {automations.map((a) => (
          <div key={a.id} className={`flex gap-3 border rounded-xl p-3 ${a.active ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
            {a.postThumbnail ? <img src={a.postThumbnail} alt="" className="w-16 h-16 rounded-lg object-cover shrink-0" /> : <div className="w-16 h-16 rounded-lg bg-gray-100 shrink-0" />}
            <div className="min-w-0 flex-1">
              <p className="text-sm text-gray-800 line-clamp-1">{a.postCaption || 'Post sem legenda'}</p>
              <p className="text-xs text-gray-500 mt-0.5">{a.triggerMode === 'any' ? 'Qualquer comentário' : `Palavras: ${a.keywords}`}</p>
              <p className="text-xs text-gray-400 mt-0.5">{a.triggeredCount} {a.triggeredCount === 1 ? 'mensagem enviada' : 'mensagens enviadas'}</p>
            </div>
            <div className="flex items-start gap-1 shrink-0">
              <button onClick={() => toggle(a)} className={`px-2.5 py-1 text-xs rounded-full ${a.active ? 'text-teal-700 bg-teal-50' : 'text-gray-600 bg-gray-100'}`}>{a.active ? 'Ligada' : 'Desligada'}</button>
              <button onClick={() => setEditing(a)} className="p-1.5 rounded hover:bg-gray-100" title="Editar"><Pencil className="w-4 h-4 text-gray-500" /></button>
              <button onClick={() => remove(a)} className="p-1.5 rounded hover:bg-red-50" title="Excluir"><Trash2 className="w-4 h-4 text-red-500" /></button>
            </div>
          </div>
        ))}
      </div>

      <h2 className="font-semibold text-gray-800 mb-3 flex items-center gap-2"><MessageCircle className="w-4 h-4" /> Mensagens no Direct</h2>
      <div className="mb-8"><DmSettings status={status} onSaved={setStatus} /></div>

      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-800">Atividade recente</h2>
        <button onClick={loadAll} className="text-xs text-pink-700 hover:underline">Atualizar</button>
      </div>
      {events.length === 0 && <p className="text-sm text-gray-500">Nenhum comentário ou Direct recebido ainda.</p>}
      <div className="divide-y divide-gray-100 border border-gray-200 rounded-xl">
        {events.map((ev) => {
          const act = ACTION[ev.action] ?? ACTION.received
          return (
            <div key={ev.id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
              <span className="text-xs text-gray-400 w-28 shrink-0">{new Date(ev.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
              <div className="min-w-0 flex-1">
                <p className="text-gray-700 truncate">
                  <span className="text-gray-500">{ev.kind === 'comment' ? 'Comentário' : 'Direct'}</span>
                  {ev.senderUsername ? ` · @${ev.senderUsername}` : ''} · {ev.text}
                </p>
                {ev.kind === 'comment' && ev.automationId && autoById[ev.automationId] && (
                  <p className="text-xs text-gray-400 truncate">Post: {autoById[ev.automationId].postCaption || 'sem legenda'}</p>
                )}
                {ev.error && <p className="text-xs text-red-600 truncate" title={ev.error}>{ev.error}</p>}
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${act.cls}`}>{act.label}</span>
            </div>
          )
        })}
      </div>

      {editing && (
        <AutomationEditor
          initial={editing.id ? editing : null}
          defaultPhone={status.settings?.whatsappPhone}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setAutomations((list) => (list.some((x) => x.id === saved.id) ? list.map((x) => (x.id === saved.id ? saved : x)) : [saved, ...list]))
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}
