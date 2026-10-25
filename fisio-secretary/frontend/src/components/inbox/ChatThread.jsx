import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowDown, PanelRightOpen, PanelRightClose, MessageCircle, Bot } from 'lucide-react'
import MessageBubble from './MessageBubble'
import Composer from './Composer'
import { Avatar } from './ConversationList'
import { dayLabel, formatPhoneBR } from '../../utils/chatMessages'
import { displayPhone } from '../../hooks/useDemoMode'

export default function ChatThread({
  contact, messages, loading, aiEnabled, onToggleAi, onBack, panelOpen, onTogglePanel,
  bubbleMode, mediaList, onPreview, composerProps, demoMode, columns, className = '',
}) {
  const scrollRef = useRef(null)
  const [atBottom, setAtBottom] = useState(true)
  const [newBelow, setNewBelow] = useState(false)
  const lastCount = useRef(0)
  const [dragOver, setDragOver] = useState(false)

  // Abriu a conversa: vai pro fim. Mensagem nova: só rola sozinho se o operador já estava
  // no fim — senão perderia o ponto onde estava lendo.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const grew = messages.length > lastCount.current
    const first = lastCount.current === 0
    lastCount.current = messages.length
    if (!grew) return
    if (first || atBottom) {
      el.scrollTop = el.scrollHeight
      setNewBelow(false)
    } else {
      setNewBelow(true)
    }
  }, [messages, atBottom])

  // Fotos carregam depois do layout e empurram o fim pra baixo.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onLoad = () => { if (atBottom) el.scrollTop = el.scrollHeight }
    el.addEventListener('load', onLoad, true)
    return () => el.removeEventListener('load', onLoad, true)
  }, [atBottom])

  function handleScroll(e) {
    const el = e.currentTarget
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    setAtBottom(bottom)
    if (bottom) setNewBelow(false)
  }

  function jumpToBottom() {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    setNewBelow(false)
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    if (aiEnabled) return
    const file = e.dataTransfer?.files?.[0]
    if (file) composerProps.onPickFile(file)
  }

  const name = contact.name || displayPhone(formatPhoneBR(contact.phone), demoMode)
  const stage = columns.find(c => c.id === contact.stage)

  return (
    <section
      className={`flex-1 min-w-0 flex flex-col min-h-0 bg-[#efeae2] relative ${className}`}
      onDragOver={e => { e.preventDefault(); if (!aiEnabled) setDragOver(true) }}
      onDragLeave={e => { if (e.currentTarget === e.target) setDragOver(false) }}
      onDrop={handleDrop}
    >
      <header className="h-16 shrink-0 px-3 md:px-4 bg-[#f0f2f5] border-b border-gray-200 flex items-center gap-3">
        <button onClick={onBack} className="md:hidden p-1.5 -ml-1 text-gray-500 hover:bg-gray-200 rounded-full" title="Voltar">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <button onClick={onTogglePanel} className="flex items-center gap-3 min-w-0 text-left">
          <Avatar name={contact.name} phone={contact.phone} url={contact.avatarUrl} size="w-10 h-10" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-800 truncate">{name}</p>
            <p className="text-xs text-gray-500 truncate">
              {contact.name ? displayPhone(formatPhoneBR(contact.phone), demoMode) : ''}
              {stage && <>{contact.name ? ' · ' : ''}{stage.emoji} {stage.label}</>}
            </p>
          </div>
        </button>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => onToggleAi(!aiEnabled)}
            title={aiEnabled ? 'Desligar a IA nesta conversa' : 'Ligar a IA nesta conversa'}
            className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition ${
              aiEnabled ? 'bg-sky-100 text-sky-700 hover:bg-sky-200' : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
            }`}
          >
            <Bot className="w-3.5 h-3.5" /> {aiEnabled ? 'IA ligada' : 'IA desligada'}
          </button>
          <button
            onClick={onTogglePanel}
            title={panelOpen ? 'Esconder dados do contato' : 'Dados do contato'}
            className="p-2 text-gray-500 hover:bg-gray-200 rounded-full transition"
          >
            {panelOpen ? <PanelRightClose className="w-5 h-5" /> : <PanelRightOpen className="w-5 h-5" />}
          </button>
        </div>
      </header>

      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-3 md:px-[6%] py-4 space-y-1.5">
        {loading && (
          <div className="space-y-3 animate-pulse">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className={`flex ${i % 2 ? 'justify-end' : 'justify-start'}`}>
                <div className={`h-10 rounded-xl ${i % 2 ? 'bg-[#d9fdd3] w-2/5' : 'bg-white w-1/3'}`} />
              </div>
            ))}
          </div>
        )}
        {!loading && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center text-gray-500 py-20 gap-2">
            <MessageCircle className="w-10 h-10" />
            <p className="text-sm">Nenhuma mensagem ainda</p>
          </div>
        )}
        {!loading && messages.map((m, i) => {
          const prev = messages[i - 1]
          const showDay = m.createdAt && (!prev?.createdAt || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString())
          const senderChanged = prev && prev.sender !== m.sender
          return (
            <div key={m.id} className={senderChanged ? 'pt-1.5' : ''}>
              {showDay && (
                <div className="flex justify-center my-3">
                  <span className="text-[11.5px] text-gray-600 bg-white/90 rounded-lg px-3 py-1 shadow-sm">{dayLabel(m.createdAt)}</span>
                </div>
              )}
              <MessageBubble msg={m} bubbleMode={bubbleMode} mediaList={mediaList} onPreview={onPreview} />
            </div>
          )
        })}
      </div>

      {newBelow && (
        <button
          onClick={jumpToBottom}
          className="absolute bottom-24 right-6 px-3 py-2 rounded-full bg-white text-teal-700 text-xs font-semibold shadow-lg flex items-center gap-1.5 hover:bg-gray-50 z-10"
        >
          <ArrowDown className="w-4 h-4" /> Novas mensagens
        </button>
      )}

      {dragOver && (
        <div className="absolute inset-0 z-30 bg-teal-600/10 border-2 border-dashed border-teal-500 flex items-center justify-center pointer-events-none">
          <p className="bg-white px-4 py-2 rounded-xl shadow text-sm font-medium text-teal-700">Solte o arquivo para enviar</p>
        </div>
      )}

      <Composer aiEnabled={aiEnabled} onTakeOver={() => onToggleAi(false)} {...composerProps} />
    </section>
  )
}
