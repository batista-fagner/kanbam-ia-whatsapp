import { Search, Loader2, MessageCircle, BotOff } from 'lucide-react'
import { listTime, previewText, initials, avatarColor, formatPhoneBR } from '../../utils/chatMessages'
import { displayPhone } from '../../hooks/useDemoMode'

const FILTERS = [
  { key: 'all', label: 'Todas' },
  { key: 'unread', label: 'Não lidas' },
  { key: 'awaiting', label: 'Aguardando resposta' },
  { key: 'ai_off', label: 'IA desligada' },
  { key: 'ai_on', label: 'IA atendendo' },
]

export function Avatar({ name, phone, url, size = 'w-11 h-11', text = 'text-sm' }) {
  if (url) return <img src={url} alt="" className={`${size} rounded-full object-cover shrink-0`} />
  return (
    <div className={`${size} ${avatarColor(phone)} rounded-full flex items-center justify-center text-white font-semibold ${text} shrink-0`}>
      {initials(name, phone)}
    </div>
  )
}

function Row({ row, active, onSelect, demoMode }) {
  // Não lida: o cliente escreveu e ninguém abriu a conversa nem respondeu ainda.
  const awaiting = !!row.unread
  const name = row.name || displayPhone(formatPhoneBR(row.phone), demoMode)
  return (
    <button
      onClick={() => onSelect(row)}
      className={`w-full text-left px-3 py-3 flex items-center gap-3 transition border-b border-gray-50 ${
        active ? 'bg-teal-50' : 'hover:bg-gray-50'
      }`}
    >
      <Avatar name={row.name} phone={row.phone} url={row.avatarUrl} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className={`text-sm truncate flex-1 ${awaiting ? 'font-bold text-gray-900' : 'font-medium text-gray-800'}`}>{name}</p>
          <span className={`text-[11px] shrink-0 ${awaiting ? 'text-green-600 font-semibold' : 'text-gray-400'}`}>{listTime(row.lastMessageAt)}</span>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <p className={`text-[13px] truncate flex-1 ${awaiting ? 'text-gray-700' : 'text-gray-500'}`}>{previewText(row) || 'Sem mensagens'}</p>
          {row.aiEnabled === false && <BotOff className="w-3.5 h-3.5 text-amber-500 shrink-0" title="IA desligada" />}
          {awaiting && (
            <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-green-500 text-white text-[11px] font-bold flex items-center justify-center shrink-0" title="Não lida">
              {row.unreadCount > 0 ? (row.unreadCount > 99 ? '99+' : row.unreadCount) : ''}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

export default function ConversationList({
  rows, selectedId, onSelect, search, onSearch, filter, onFilter, stage, onStage, columns,
  loading, hasMore, loadingMore, onLoadMore, demoMode, className = '',
}) {
  return (
    <aside className={`w-full md:w-[340px] lg:w-[380px] shrink-0 bg-white border-r border-gray-200 flex flex-col min-h-0 ${className}`}>
      <div className="p-3 space-y-2.5 border-b border-gray-100">
        <div className="flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-2">
          <Search className="w-4 h-4 text-gray-400 shrink-0" />
          <input
            value={search}
            onChange={e => onSearch(e.target.value)}
            placeholder="Buscar por nome ou telefone"
            className="bg-transparent text-sm text-gray-700 placeholder-gray-400 outline-none w-full"
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 -mx-1 px-1">
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => onFilter(f.key)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition ${
                filter === f.key ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <select
          value={stage}
          onChange={e => onStage(e.target.value)}
          className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-600"
        >
          <option value="">Todas as raias</option>
          {columns.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>)}
        </select>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="p-3 space-y-4">
            {[0, 1, 2, 3, 4, 5].map(i => (
              <div key={i} className="flex items-center gap-3 animate-pulse">
                <div className="w-11 h-11 rounded-full bg-gray-200 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-gray-200 rounded w-2/3" />
                  <div className="h-2.5 bg-gray-100 rounded w-full" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && rows.length === 0 && (
          <div className="flex flex-col items-center justify-center text-gray-400 py-16 gap-2 px-6 text-center">
            <MessageCircle className="w-9 h-9" />
            <p className="text-sm font-medium">Nenhuma conversa</p>
            <p className="text-xs">{search || filter !== 'all' || stage ? 'Tente outra busca ou filtro.' : 'As conversas do WhatsApp aparecem aqui.'}</p>
          </div>
        )}

        {!loading && rows.map(r => (
          <Row key={r.id} row={r} active={r.id === selectedId} onSelect={onSelect} demoMode={demoMode} />
        ))}

        {hasMore && !loading && (
          <button
            onClick={onLoadMore}
            disabled={loadingMore}
            className="w-full py-3 text-xs font-semibold text-teal-700 hover:bg-teal-50 transition flex items-center justify-center gap-1.5"
          >
            {loadingMore && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Carregar mais conversas
          </button>
        )}
      </div>
    </aside>
  )
}
