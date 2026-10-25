// Formatação das mensagens do WhatsApp usada pela Inbox (mesmas regras do chat do card
// do Kanban em LeadModal.jsx: marcadores "[imagem]", "[mídia: nome]", "[documento: nome]").

export function formatPhoneBR(phone) {
  const digits = (phone || '').replace(/\D/g, '')
  const local = digits.startsWith('55') ? digits.slice(2) : digits
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`
  return phone
}

export function mapMessage(msg) {
  return {
    id: msg.id,
    sender: msg.direction === 'inbound' ? 'lead' : (msg.sender === 'ai' ? 'ai' : 'operator'),
    content: msg.content,
    mediaType: msg.messageType,
    mediaUrl: msg.mediaUrl,
    createdAt: msg.createdAt,
  }
}

function startOfDay(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function daysAgo(dateStr) {
  return Math.round((startOfDay(new Date()) - startOfDay(dateStr)) / 86400000)
}

// Hora na lista de conversas: hoje → 14:32, ontem → Ontem, semana → seg., depois → 12/10/26
export function listTime(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const diff = daysAgo(d)
  if (diff <= 0) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  if (diff === 1) return 'Ontem'
  if (diff < 7) return d.toLocaleDateString('pt-BR', { weekday: 'short' })
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

export function dayLabel(dateStr) {
  const diff = daysAgo(dateStr)
  if (diff <= 0) return 'Hoje'
  if (diff === 1) return 'Ontem'
  const d = new Date(dateStr)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) })
}

export function clockTime(dateStr) {
  return new Date(dateStr).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

// Resposta da IA em "bolhas": o backend grava as bolhas separadas por linha em branco.
export function splitBubbleText(content) {
  return String(content ?? '').split(/\n{2,}/).map(t => t.trim()).filter(Boolean)
}

// Foto/vídeo de uma mensagem: usa a URL salva; mensagens antigas só têm
// "[mídia: nome]" no texto, então procura o arquivo pelo nome na lista de mídias.
export function resolveVisual(msg, mediaList) {
  if ((msg.mediaType === 'image' || msg.mediaType === 'video') && msg.mediaUrl) {
    return { url: msg.mediaUrl, video: msg.mediaType === 'video' }
  }
  const m = /^\[mídia: (.+?)\]/.exec(msg.content || '')
  if (m) {
    const f = mediaList.find(x => x.name === m[1])
    if (f) return { url: f.url, video: !!f.mimeType?.startsWith('video/') }
  }
  return null
}

export function documentName(content) {
  const m = /^\[documento: (.+?)\]/.exec(content || '')
  return m ? m[1] : 'Documento'
}

// Texto que acompanha a mídia (legenda), sem o marcador.
export function mediaCaption(content) {
  return String(content ?? '')
    .replace(/^\[imagem\]\s*/, '')
    .replace(/^\[vídeo\]\s*/, '')
    .replace(/^\[áudio\]\s*/, '')
    .replace(/^\[documento: .+?\]\s*/, '')
    .replace(/^\[mídia: .+?\]\s*/, '')
    .trim()
}

// Prévia da última mensagem na lista de conversas.
export function previewText(row) {
  const content = row.lastContent || ''
  const type = row.lastType
  const caption = mediaCaption(content)
  let text
  if (type === 'audio' || content.startsWith('[áudio]')) text = '🎤 Áudio'
  else if (type === 'document' || content.startsWith('[documento:')) text = `📄 ${documentName(content)}`
  else if (type === 'video' || content.startsWith('[vídeo]')) text = caption ? `🎥 ${caption}` : '🎥 Vídeo'
  else if (type === 'image' || content.startsWith('[imagem]') || content.startsWith('[mídia:')) text = caption ? `📷 ${caption}` : '📷 Foto'
  else text = content.replace(/\s+/g, ' ').trim()
  if (row.lastMessageDirection === 'outbound') return `${row.lastSender === 'ai' ? 'IA' : 'Você'}: ${text}`
  return text
}

export function initials(name, phone) {
  const base = (name || '').trim()
  if (!base) return (phone || '?').slice(-2)
  const parts = base.split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || base.slice(0, 2).toUpperCase()
}

const AVATAR_COLORS = ['bg-teal-500', 'bg-sky-500', 'bg-violet-500', 'bg-rose-500', 'bg-amber-500', 'bg-emerald-500', 'bg-indigo-500', 'bg-pink-500']
export function avatarColor(key) {
  let h = 0
  for (const ch of String(key || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}
