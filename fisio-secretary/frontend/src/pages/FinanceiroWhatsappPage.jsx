import { useCallback, useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import { Wallet, MessageSquare, RefreshCw, Mic } from 'lucide-react'
import { getFinanceiroConversations, getFinanceiroMessages } from '../services/api'
import { getStoredToken } from '../context/AuthContext'

function formatPhoneBR(phone) {
  const digits = (phone || '').replace(/\D/g, '')
  const local = digits.startsWith('55') ? digits.slice(2) : digits
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`
  return phone
}

function formatTime(dateStr) {
  const d = new Date(dateStr)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

export default function FinanceiroWhatsappPage() {
  const [conversations, setConversations] = useState([])
  const [loadingList, setLoadingList] = useState(true)
  const [selected, setSelected] = useState(null)
  const [messages, setMessages] = useState([])
  const [loadingThread, setLoadingThread] = useState(false)

  const selectedRef = useRef(null)
  selectedRef.current = selected

  const loadConversations = useCallback(async () => {
    setLoadingList(true)
    try {
      const data = await getFinanceiroConversations()
      setConversations(data)
    } finally {
      setLoadingList(false)
    }
  }, [])

  useEffect(() => {
    loadConversations()
  }, [loadConversations])

  // Realtime: novas respostas do cliente chegam aqui sem precisar recarregar a
  // tela — mesmo padrão de useLeads.js, mas ouvindo o evento financeiro:message.
  useEffect(() => {
    const socket = io(import.meta.env.VITE_API_URL ?? 'http://localhost:3000', {
      auth: { token: getStoredToken() },
    })

    socket.on('financeiro:message', (message) => {
      setConversations((prev) => {
        const without = prev.filter((c) => c.phone !== message.phone)
        return [
          {
            phone: message.phone,
            clientName: message.clientName,
            tenantId: message.tenantId,
            lastMessage: message.content,
            lastMessageAt: message.createdAt,
            lastDirection: message.direction,
          },
          ...without,
        ]
      })

      if (selectedRef.current?.phone === message.phone) {
        setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]))
      }
    })

    return () => socket.disconnect()
  }, [])

  async function openConversation(conv) {
    setSelected(conv)
    setLoadingThread(true)
    setMessages([])
    try {
      const data = await getFinanceiroMessages(conv.phone)
      setMessages(data)
    } finally {
      setLoadingThread(false)
    }
  }

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col overflow-hidden bg-gray-50">
      {/* Toolbar */}
      <div className="h-14 shrink-0 px-5 bg-white border-b border-gray-100 flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-teal-700 flex items-center justify-center">
            <Wallet className="w-4 h-4 text-white" />
          </div>
          <span className="text-sm font-bold text-gray-800">Financeiro WhatsApp</span>
          <span className="px-2 py-0.5 rounded bg-teal-50 text-teal-700 text-[11px] font-semibold">
            +55 27 99668-0415
          </span>
        </div>
        <button
          onClick={loadConversations}
          className="ml-auto p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition"
          title="Atualizar"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* 2 colunas */}
      <div className="flex-1 flex min-h-0">
        {/* Lista de conversas */}
        <aside className="w-80 shrink-0 border-r border-gray-100 bg-white flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto">
            {loadingList ? (
              <div className="p-4 text-sm text-gray-400">Carregando...</div>
            ) : conversations.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-400">
                Nenhuma conversa ainda.
              </div>
            ) : (
              conversations.map((conv) => (
                <button
                  key={conv.phone}
                  onClick={() => openConversation(conv)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-50 transition ${
                    selected?.phone === conv.phone ? 'bg-teal-50' : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-gray-800 truncate">
                      {conv.clientName || formatPhoneBR(conv.phone)}
                    </span>
                    <span className="text-[11px] text-gray-400 shrink-0">{formatTime(conv.lastMessageAt)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <p className="text-xs text-gray-500 truncate">
                      {conv.lastDirection === 'outbound' ? 'Você: ' : ''}
                      {conv.lastMessage}
                    </p>
                  </div>
                  {conv.clientName && (
                    <p className="text-[11px] text-gray-400 mt-0.5">{formatPhoneBR(conv.phone)}</p>
                  )}
                </button>
              ))
            )}
          </div>
        </aside>

        {/* Thread */}
        {selected ? (
          <section className="flex-1 flex flex-col min-h-0">
            <div className="h-14 shrink-0 px-5 bg-white border-b border-gray-100 flex items-center">
              <div>
                <p className="text-sm font-semibold text-gray-800">
                  {selected.clientName || formatPhoneBR(selected.phone)}
                </p>
                <p className="text-xs text-gray-400">{formatPhoneBR(selected.phone)}</p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {loadingThread ? (
                <div className="text-sm text-gray-400">Carregando mensagens...</div>
              ) : (
                messages.map((m) => (
                  <div key={m.id} className={`flex ${m.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-md px-3.5 py-2 rounded-2xl text-sm ${
                        m.direction === 'outbound'
                          ? 'bg-teal-700 text-white rounded-br-sm'
                          : 'bg-white border border-gray-200 text-gray-800 rounded-bl-sm'
                      }`}
                    >
                      {m.content.startsWith('[áudio]') && (
                        <Mic className="w-3.5 h-3.5 inline mr-1 -mt-0.5 opacity-70" />
                      )}
                      <span className="whitespace-pre-wrap break-words">
                        {m.content.replace(/^\[áudio\]\s*/, '')}
                      </span>
                      <div className={`text-[10px] mt-1 ${m.direction === 'outbound' ? 'text-teal-100' : 'text-gray-400'}`}>
                        {formatTime(m.createdAt)}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Envio ainda não implementado — só leitura por enquanto */}
            <div className="shrink-0 px-5 py-3 border-t border-gray-100 bg-white text-center text-xs text-gray-400">
              Envio de mensagem por aqui ainda não está disponível.
            </div>
          </section>
        ) : (
          <section className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-3">
            <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center">
              <MessageSquare className="w-7 h-7 text-gray-300" />
            </div>
            <p className="text-sm font-medium text-gray-500">Selecione uma conversa</p>
            <p className="text-xs">Escolha um cliente à esquerda para ver as mensagens.</p>
          </section>
        )}
      </div>
    </div>
  )
}
