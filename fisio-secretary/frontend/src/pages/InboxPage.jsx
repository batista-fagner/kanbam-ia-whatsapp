import { useCallback, useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import { MessageCircle, Wifi, WifiOff, X, ExternalLink } from 'lucide-react'
import ConversationList from '../components/inbox/ConversationList'
import ChatThread from '../components/inbox/ChatThread'
import ContactPanel from '../components/inbox/ContactPanel'
import LeadModal from '../components/LeadModal'
import {
  getInbox, getLead, getConversation, toggleAi, updateStage, getInstanceConfig, getMediaList,
  sendManualMessage, sendManualMedia, sendManualAudio, sendInboxFile,
} from '../services/api'
import { getStoredToken, useAuth } from '../context/AuthContext'
import { useDemoMode } from '../hooks/useDemoMode'
import { getColumns } from '../data/mockData'
import { mapMessage, blobToBase64 } from '../utils/chatMessages'

const PAGE_SIZE = 40
const MAX_FILE_BYTES = 7 * 1024 * 1024

// Inbox estilo WhatsApp Web: lista de conversas | conversa | dados do contato.
// Usa os mesmos endpoints do chat do card do Kanban; o Kanban continua igual.
export default function InboxPage() {
  const { user } = useAuth()
  const columns = getColumns(user?.tenantId)
  const demoMode = useDemoMode()

  const [rows, setRows] = useState([])
  const [hasMore, setHasMore] = useState(false)
  const [loadingList, setLoadingList] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [stage, setStage] = useState('')

  const [selected, setSelected] = useState(null) // linha da lista + dados completos do lead
  const [messages, setMessages] = useState([])
  const [aiEnabled, setAiEnabled] = useState(true)
  const [loadingThread, setLoadingThread] = useState(false)
  const [panelOpen, setPanelOpen] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1280)
  const [detailsLead, setDetailsLead] = useState(null)

  const [pendingFile, setPendingFile] = useState(null)
  const [composerError, setComposerError] = useState('')
  const [bubbleMode, setBubbleMode] = useState(false)
  const [mediaList, setMediaList] = useState([])
  const [preview, setPreview] = useState(null)
  const [connected, setConnected] = useState(false)

  const selectedRef = useRef(null)
  selectedRef.current = selected
  const listQueryRef = useRef({ search: '', filter: 'all', stage: '' })
  listQueryRef.current = { search: debouncedSearch, filter, stage }

  useEffect(() => {
    getInstanceConfig().then(cfg => setBubbleMode(!!cfg?.bubbleMode)).catch(() => {})
  }, [])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  const loadList = useCallback(async (offset = 0) => {
    offset === 0 ? setLoadingList(true) : setLoadingMore(true)
    try {
      const res = await getInbox({ search: debouncedSearch, filter, stage, offset, limit: PAGE_SIZE })
      setRows(prev => (offset === 0 ? res.data : [...prev, ...res.data.filter(r => !prev.some(p => p.id === r.id))]))
      setHasMore(res.hasMore)
    } catch {
      if (offset === 0) setRows([])
    } finally {
      setLoadingList(false)
      setLoadingMore(false)
    }
  }, [debouncedSearch, filter, stage])

  useEffect(() => { loadList(0) }, [loadList])

  // Mensagens antigas só têm "[mídia: nome]" no texto — a URL vem do catálogo.
  useEffect(() => {
    if (mediaList.length > 0) return
    if (!messages.some(m => !m.mediaUrl && /^\[mídia: /.test(m.content || ''))) return
    getMediaList().then(setMediaList).catch(() => {})
  }, [messages, mediaList.length])

  function patchRow(id, patch) {
    setRows(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)))
  }

  async function openConversation(row) {
    if (selectedRef.current?.id === row.id) return
    setSelected(row)
    setMessages([])
    setPendingFile(null)
    setComposerError('')
    setLoadingThread(true)
    setAiEnabled(row.aiEnabled ?? true)
    try {
      const [conv, lead] = await Promise.all([getConversation(row.id), getLead(row.id).catch(() => null)])
      if (selectedRef.current?.id !== row.id) return
      setMessages((conv?.messages ?? []).map(mapMessage))
      setAiEnabled(conv?.aiEnabled ?? true)
      patchRow(row.id, { aiEnabled: conv?.aiEnabled ?? true })
      if (lead) setSelected(s => (s?.id === row.id ? { ...s, ...lead } : s))
    } finally {
      if (selectedRef.current?.id === row.id) setLoadingThread(false)
    }
  }

  function rowFitsList(row) {
    const q = listQueryRef.current
    if (q.search) return false
    if (q.stage && row.stage !== q.stage) return false
    if (q.filter === 'awaiting') return row.lastMessageDirection === 'inbound'
    if (q.filter === 'ai_off') return row.aiEnabled === false
    if (q.filter === 'ai_on') return row.aiEnabled !== false
    return true
  }

  // --- Tempo real ---
  useEffect(() => {
    const socket = io(import.meta.env.VITE_API_URL ?? 'http://localhost:3000', { auth: { token: getStoredToken() } })
    socket.on('connect', () => setConnected(true))
    socket.on('disconnect', () => setConnected(false))

    socket.on('message:new', ({ leadId, message }) => {
      const m = mapMessage(message)
      if (selectedRef.current?.id === leadId) {
        setMessages(prev => {
          if (prev.some(x => x.id === m.id)) return prev
          // Troca a mensagem otimista (enviada daqui) pela gravada no banco.
          const tempIdx = m.sender === 'operator' ? prev.findIndex(x => x.temp && x.content === m.content) : -1
          if (tempIdx >= 0) return prev.map((x, i) => (i === tempIdx ? m : x))
          return [...prev, m]
        })
      }
      const summary = {
        lastContent: m.content?.slice(0, 200), lastType: m.mediaType, lastSender: message.sender,
        lastMessageAt: message.createdAt, lastMessageDirection: message.direction,
      }
      setRows(prev => {
        const existing = prev.find(r => r.id === leadId)
        if (!existing) {
          getLead(leadId).then(lead => {
            const row = { id: lead.id, name: lead.name, phone: lead.phone, avatarUrl: lead.avatarUrl, stage: lead.stage, labels: lead.labels, ...summary }
            if (!rowFitsList(row)) return
            setRows(p => (p.some(r => r.id === leadId) ? p : [row, ...p]))
          }).catch(() => {})
          return prev
        }
        const updated = { ...existing, ...summary }
        const rest = prev.filter(r => r.id !== leadId)
        // Respondeu uma conversa no filtro "Aguardando": ela sai da lista.
        const q = listQueryRef.current
        if (q.filter === 'awaiting' && updated.lastMessageDirection !== 'inbound' && selectedRef.current?.id !== leadId) return rest
        return [updated, ...rest]
      })
    })

    socket.on('lead:updated', (lead) => {
      const patch = { name: lead.name, avatarUrl: lead.avatarUrl, stage: lead.stage, labels: lead.labels }
      setRows(prev => prev.map(r => (r.id === lead.id ? { ...r, ...patch } : r)))
      if (selectedRef.current?.id === lead.id) setSelected(s => ({ ...s, ...lead }))
    })

    socket.on('lead:deleted', (leadId) => {
      setRows(prev => prev.filter(r => r.id !== leadId))
      if (selectedRef.current?.id === leadId) setSelected(null)
    })

    return () => socket.disconnect()
  }, [])

  // --- Ações ---
  async function handleToggleAi(next) {
    if (!selected) return
    const id = selected.id
    setAiEnabled(next)
    patchRow(id, { aiEnabled: next })
    try {
      await toggleAi(id, next)
    } catch {
      setAiEnabled(!next)
      patchRow(id, { aiEnabled: !next })
    }
  }

  async function handleStageChange(nextStage) {
    if (!selected) return
    const before = selected.stage
    setSelected(s => ({ ...s, stage: nextStage }))
    patchRow(selected.id, { stage: nextStage })
    try {
      await updateStage(selected.id, nextStage)
    } catch {
      setSelected(s => ({ ...s, stage: before }))
      patchRow(selected.id, { stage: before })
    }
  }

  function handleLeadChange(lead) {
    setSelected(s => ({ ...s, ...lead }))
    patchRow(lead.id, { name: lead.name, labels: lead.labels })
  }

  // Mensagem otimista: aparece na hora; o evento message:new troca pela gravada no banco.
  async function sendOptimistic(temp, send) {
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const leadId = selected.id
    setMessages(prev => [...prev, { id: tempId, sender: 'operator', temp: true, pending: true, createdAt: new Date().toISOString(), ...temp }])
    setComposerError('')
    try {
      const res = await send()
      if (selectedRef.current?.id !== leadId) return
      setMessages(prev => {
        if (res?.message) {
          const real = mapMessage(res.message)
          if (prev.some(x => x.id === real.id)) return prev.filter(x => x.id !== tempId)
          return prev.map(x => (x.id === tempId ? real : x))
        }
        return prev.map(x => (x.id === tempId ? { ...x, pending: false } : x))
      })
    } catch (err) {
      setMessages(prev => prev.map(x => (x.id === tempId ? { ...x, pending: false, failed: true } : x)))
      setComposerError(err?.message || 'Não foi possível enviar.')
    }
  }

  function handleSendText(text) {
    const phone = selected.phone
    sendOptimistic({ content: text }, () => sendManualMessage(phone, text))
  }

  function handleSendCatalog(media) {
    const phone = selected.phone
    const isVideo = media.mimeType?.startsWith('video/')
    sendOptimistic(
      { content: `[mídia: ${media.name}]`, mediaType: isVideo ? 'video' : 'image', mediaUrl: media.url },
      () => sendManualMedia(phone, media.id),
    )
  }

  function handleSendAudio(blob, mimeType) {
    const phone = selected.phone
    sendOptimistic(
      { content: '[áudio]', mediaType: 'audio', mediaUrl: URL.createObjectURL(blob) },
      async () => sendManualAudio(phone, await blobToBase64(blob), mimeType),
    )
  }

  function handlePickFile(file) {
    if (!file) return
    if (file.size > MAX_FILE_BYTES) { setComposerError('Arquivo muito grande (máx. 7 MB)'); return }
    setComposerError('')
    const visual = file.type.startsWith('image/') || file.type.startsWith('video/')
    setPendingFile({ file, previewUrl: visual ? URL.createObjectURL(file) : null })
  }

  function handleSendFile(file, caption) {
    const leadId = selected.id
    const type = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'document'
    const marker = type === 'image' ? '[imagem]' : type === 'video' ? '[vídeo]' : `[documento: ${file.name}]`
    setPendingFile(null)
    sendOptimistic(
      { content: caption ? `${marker} ${caption}` : marker, mediaType: type, mediaUrl: URL.createObjectURL(file) },
      async () => sendInboxFile(leadId, await blobToBase64(file), file.type || 'application/octet-stream', file.name, caption),
    )
  }

  return (
    <div className="h-[100dvh] flex flex-col overflow-hidden bg-white">
      <div className="h-12 shrink-0 px-4 border-b border-gray-200 flex items-center gap-2">
        <MessageCircle className="w-5 h-5 text-teal-600" />
        <span className="text-sm font-semibold text-gray-800">Inbox</span>
        <span
          title={connected ? 'Mensagens chegando ao vivo' : 'Reconectando…'}
          className={`ml-auto flex items-center gap-1 text-[11px] font-medium ${connected ? 'text-emerald-600' : 'text-gray-400'}`}
        >
          {connected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
          {connected ? 'Ao vivo' : 'Offline'}
        </span>
      </div>

      <div className="flex-1 flex min-h-0">
        <ConversationList
          className={selected ? 'hidden md:flex' : 'flex'}
          rows={rows}
          selectedId={selected?.id}
          onSelect={openConversation}
          search={search}
          onSearch={setSearch}
          filter={filter}
          onFilter={setFilter}
          stage={stage}
          onStage={setStage}
          columns={columns}
          loading={loadingList}
          hasMore={hasMore}
          loadingMore={loadingMore}
          onLoadMore={() => loadList(rows.length)}
          demoMode={demoMode}
        />

        {selected ? (
          <>
            <ChatThread
              key={selected.id}
              className={panelOpen ? 'hidden lg:flex' : 'flex'}
              contact={selected}
              messages={messages}
              loading={loadingThread}
              aiEnabled={aiEnabled}
              onToggleAi={handleToggleAi}
              onBack={() => setSelected(null)}
              panelOpen={panelOpen}
              onTogglePanel={() => setPanelOpen(v => !v)}
              bubbleMode={bubbleMode}
              mediaList={mediaList}
              onPreview={setPreview}
              demoMode={demoMode}
              columns={columns}
              composerProps={{
                onSendText: handleSendText,
                onSendCatalog: handleSendCatalog,
                onSendAudio: handleSendAudio,
                onSendFile: handleSendFile,
                onPickFile: handlePickFile,
                pendingFile,
                setPendingFile,
                error: composerError,
              }}
            />
            {panelOpen && (
              <ContactPanel
                key={`panel-${selected.id}`}
                lead={selected}
                aiEnabled={aiEnabled}
                onToggleAi={handleToggleAi}
                onStageChange={handleStageChange}
                onLeadChange={handleLeadChange}
                onOpenDetails={() => setDetailsLead(selected)}
                onClose={() => setPanelOpen(false)}
                columns={columns}
                demoMode={demoMode}
              />
            )}
          </>
        ) : (
          <section className="hidden md:flex flex-1 flex-col items-center justify-center bg-[#f0f2f5] text-gray-500 gap-3 border-b-4 border-teal-500">
            <div className="w-16 h-16 rounded-2xl bg-white flex items-center justify-center shadow-sm">
              <MessageCircle className="w-8 h-8 text-teal-500" />
            </div>
            <p className="text-base font-medium text-gray-600">Selecione uma conversa</p>
            <p className="text-sm">Escolha um contato à esquerda para ler e responder.</p>
          </section>
        )}
      </div>

      {detailsLead && <LeadModal lead={detailsLead} onClose={() => setDetailsLead(null)} />}

      {preview && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80" onClick={() => setPreview(null)}>
          <button onClick={() => setPreview(null)} className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white" title="Fechar">
            <X className="w-5 h-5" />
          </button>
          <a
            href={preview.url}
            target="_blank"
            rel="noreferrer"
            onClick={e => e.stopPropagation()}
            className="absolute top-4 right-16 flex items-center gap-1.5 px-3 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white text-sm"
          >
            <ExternalLink className="w-4 h-4" /> Abrir original
          </a>
          <img src={preview.url} alt="Foto ampliada" onClick={e => e.stopPropagation()} className="max-h-[90vh] max-w-[95vw] rounded-lg object-contain" />
        </div>
      )}
    </div>
  )
}
