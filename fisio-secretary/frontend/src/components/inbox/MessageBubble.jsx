import { Bot, FileText, Loader2, AlertCircle } from 'lucide-react'
import { resolveVisual, mediaCaption, documentName, splitBubbleText, clockTime } from '../../utils/chatMessages'

// Balão estilo WhatsApp: cliente à esquerda (branco), IA e operador à direita
// (verde = operador, azul-claro = IA, com o rótulo embaixo).
export default function MessageBubble({ msg, bubbleMode, mediaList, onPreview }) {
  const mine = msg.sender !== 'lead'
  const tone = msg.sender === 'lead'
    ? 'bg-white text-gray-800 rounded-tl-sm'
    : msg.sender === 'ai'
      ? 'bg-sky-100 text-gray-800 rounded-tr-sm'
      : 'bg-[#d9fdd3] text-gray-800 rounded-tr-sm'
  const bubble = `px-3 py-2 rounded-xl text-sm shadow-[0_1px_0.5px_rgba(0,0,0,0.13)] whitespace-pre-line break-words ${tone}`

  const meta = (
    <div className={`flex items-center gap-1 mt-0.5 px-1 text-[10.5px] text-gray-500 ${mine ? 'justify-end' : 'justify-start'}`}>
      {msg.sender === 'ai' && <span className="flex items-center gap-0.5"><Bot className="w-3 h-3" /> IA ·</span>}
      {msg.sender === 'operator' && <span>Você ·</span>}
      {msg.createdAt && <span>{clockTime(msg.createdAt)}</span>}
      {msg.pending && <Loader2 className="w-3 h-3 animate-spin" />}
      {msg.failed && <span className="flex items-center gap-0.5 text-red-500"><AlertCircle className="w-3 h-3" /> não enviada</span>}
    </div>
  )

  let body
  if (msg.mediaType === 'document' && msg.mediaUrl) {
    const caption = mediaCaption(msg.content)
    body = (
      <div className={bubble}>
        <a href={msg.mediaUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 min-w-0 bg-black/5 rounded-lg px-2.5 py-2 hover:bg-black/10">
          <FileText className="w-8 h-8 shrink-0 text-gray-500" />
          <span className="min-w-0">
            <span className="block font-medium truncate">{documentName(msg.content)}</span>
            <span className="block text-xs text-gray-500">Abrir documento</span>
          </span>
        </a>
        {caption && <p className="pt-1.5">{caption}</p>}
      </div>
    )
  } else if (msg.mediaType === 'audio' && msg.mediaUrl) {
    body = <div className={bubble}><audio src={msg.mediaUrl} controls preload="metadata" className="max-w-[260px] h-9" /></div>
  } else {
    const visual = resolveVisual(msg, mediaList)
    if (visual) {
      const caption = mediaCaption(msg.content)
      body = (
        <div className={`${bubble} !p-1`}>
          {visual.video ? (
            <video src={visual.url} controls preload="metadata" className="rounded-lg max-h-80 max-w-full" />
          ) : (
            <img
              src={visual.url}
              alt="Foto da conversa"
              loading="lazy"
              onClick={() => onPreview(visual)}
              className="rounded-lg max-h-80 max-w-full object-cover cursor-zoom-in"
            />
          )}
          {caption && <p className="px-2 pt-1.5 pb-0.5">{caption}</p>}
        </div>
      )
    } else if (msg.content === '[imagem]') {
      body = <div className={`${bubble} italic text-gray-500`}>📷 Foto (não ficou salva no histórico)</div>
    } else {
      const parts = bubbleMode && msg.sender === 'ai' ? splitBubbleText(msg.content) : []
      body = parts.length > 1
        ? <div className="flex flex-col items-end gap-1">{parts.map((p, i) => <div key={i} className={bubble}>{p}</div>)}</div>
        : <div className={bubble}>{msg.content}</div>
    }
  }

  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'} ${msg.pending ? 'opacity-70' : ''}`}>
      <div className="max-w-[85%] md:max-w-[70%]">
        {body}
        {meta}
      </div>
    </div>
  )
}
