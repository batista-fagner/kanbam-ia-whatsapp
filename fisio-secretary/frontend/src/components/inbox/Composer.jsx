import { useEffect, useRef, useState } from 'react'
import { Paperclip, Mic, Send, X, Image as ImageIcon, FileText, Play, Bot, UserCheck, Trash2, Search, Upload } from 'lucide-react'
import { getMediaList } from '../../services/api'
import { useAudioRecorder } from '../../hooks/useAudioRecorder'

export default function Composer({ aiEnabled, onTakeOver, onSendText, onSendCatalog, onSendFile, onSendAudio, onPickFile, pendingFile, setPendingFile, error }) {
  const [text, setText] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [mediaList, setMediaList] = useState(null)
  const [catalogSearch, setCatalogSearch] = useState('')
  const textRef = useRef(null)
  const fileRef = useRef(null)
  const recorder = useAudioRecorder((blob, mimeType) => onSendAudio(blob, mimeType))

  // Caixa de texto cresce com o conteúdo (até ~6 linhas), como no WhatsApp Web.
  useEffect(() => {
    const el = textRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 140) + 'px'
  }, [text])

  useEffect(() => {
    if (!aiEnabled) textRef.current?.focus()
  }, [aiEnabled])

  function handlePaste(e) {
    const file = [...(e.clipboardData?.files || [])][0]
    if (file) { e.preventDefault(); onPickFile(file) }
  }

  function submit() {
    if (pendingFile) {
      onSendFile(pendingFile.file, text.trim())
      setText('')
      return
    }
    const t = text.trim()
    if (!t) return
    onSendText(t)
    setText('')
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  async function openCatalog() {
    setMenuOpen(false)
    setCatalogOpen(true)
    if (!mediaList) getMediaList().then(setMediaList).catch(() => setMediaList([]))
  }

  if (aiEnabled) {
    return (
      <div className="px-4 py-3 bg-[#f0f2f5] border-t border-gray-200">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 bg-white rounded-xl px-4 py-3">
          <p className="text-sm text-gray-600 flex items-center gap-2">
            <Bot className="w-4 h-4 text-sky-600 shrink-0" />
            A IA está atendendo esta conversa.
          </p>
          <button
            onClick={onTakeOver}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold transition"
          >
            <UserCheck className="w-4 h-4" /> Assumir conversa
          </button>
        </div>
      </div>
    )
  }

  const filteredMedia = (mediaList || []).filter(m => !catalogSearch || m.name.toLowerCase().includes(catalogSearch.toLowerCase()))

  return (
    <div className="px-3 md:px-4 py-2.5 bg-[#f0f2f5] border-t border-gray-200 relative" onPaste={handlePaste}>
      {catalogOpen && (
        <div className="absolute bottom-full left-3 right-3 md:left-4 md:right-auto md:w-[420px] mb-2 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden z-20">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100">
            <Search className="w-4 h-4 text-gray-400" />
            <input
              autoFocus
              value={catalogSearch}
              onChange={e => setCatalogSearch(e.target.value)}
              placeholder="Buscar mídia do catálogo"
              className="flex-1 text-sm outline-none"
            />
            <button onClick={() => setCatalogOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
          </div>
          <div className="max-h-72 overflow-y-auto p-2 grid grid-cols-3 gap-2">
            {mediaList === null && <p className="col-span-3 text-xs text-gray-400 text-center py-6">Carregando…</p>}
            {mediaList && filteredMedia.length === 0 && <p className="col-span-3 text-xs text-gray-400 text-center py-6">Nenhuma mídia encontrada</p>}
            {filteredMedia.map(media => (
              <button
                key={media.id}
                onClick={() => { setCatalogOpen(false); onSendCatalog(media) }}
                className="text-left rounded-lg overflow-hidden border border-gray-100 hover:ring-2 hover:ring-teal-500 transition"
                title={media.name}
              >
                <div className="aspect-square bg-gray-100 flex items-center justify-center overflow-hidden">
                  {media.mimeType?.startsWith('video/')
                    ? <Play className="w-6 h-6 text-gray-400" />
                    : <img src={media.url} alt="" loading="lazy" className="w-full h-full object-cover" />}
                </div>
                <p className="text-[11px] text-gray-600 truncate px-1.5 py-1">{media.name}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {pendingFile && (
        <div className="mb-2 bg-white rounded-xl p-2 flex items-center gap-3 border border-gray-200">
          {pendingFile.previewUrl && pendingFile.file.type.startsWith('image/') ? (
            <img src={pendingFile.previewUrl} alt="" className="w-14 h-14 rounded-lg object-cover" />
          ) : pendingFile.previewUrl ? (
            <video src={pendingFile.previewUrl} className="w-14 h-14 rounded-lg object-cover" />
          ) : (
            <div className="w-14 h-14 rounded-lg bg-gray-100 flex items-center justify-center"><FileText className="w-6 h-6 text-gray-400" /></div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-gray-700 truncate">{pendingFile.file.name}</p>
            <p className="text-xs text-gray-400">{(pendingFile.file.size / 1024 / 1024).toFixed(1)} MB · escreva uma legenda (opcional) e envie</p>
          </div>
          <button onClick={() => setPendingFile(null)} className="p-1.5 text-gray-400 hover:text-red-500" title="Remover"><X className="w-4 h-4" /></button>
        </div>
      )}

      {(error || recorder.error) && <p className="text-xs text-red-500 mb-1.5 px-1">{error || recorder.error}</p>}

      <div className="flex items-end gap-2">
        {recorder.isRecording ? (
          <div className="flex-1 flex items-center gap-3 bg-white rounded-xl px-3 py-2.5">
            <button onClick={recorder.cancel} className="p-1 text-gray-400 hover:text-red-500" title="Descartar"><Trash2 className="w-5 h-5" /></button>
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-sm font-medium text-gray-700 tabular-nums">
              {String(Math.floor(recorder.seconds / 60)).padStart(2, '0')}:{String(recorder.seconds % 60).padStart(2, '0')}
            </span>
            <span className="text-xs text-gray-400">Gravando…</span>
          </div>
        ) : (
          <>
            <div className="relative">
              <button
                onClick={() => setMenuOpen(v => !v)}
                className="p-2.5 rounded-full text-gray-500 hover:bg-gray-200 transition"
                title="Anexar"
              >
                <Paperclip className="w-5 h-5" />
              </button>
              {menuOpen && (
                <div className="absolute bottom-full left-0 mb-2 bg-white border border-gray-200 rounded-xl shadow-xl py-1.5 w-56 z-20">
                  <button onClick={openCatalog} className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                    <ImageIcon className="w-4 h-4 text-violet-500" /> Mídia do catálogo
                  </button>
                  <button onClick={() => { setMenuOpen(false); fileRef.current?.click() }} className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                    <Upload className="w-4 h-4 text-sky-500" /> Arquivo do computador
                  </button>
                </div>
              )}
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
                onChange={e => { onPickFile(e.target.files?.[0]); e.target.value = '' }}
              />
            </div>
            <textarea
              ref={textRef}
              rows={1}
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => setMenuOpen(false)}
              placeholder={pendingFile ? 'Legenda (opcional)' : 'Digite uma mensagem'}
              className="flex-1 resize-none bg-white rounded-xl px-4 py-2.5 text-sm text-gray-800 outline-none placeholder-gray-400 leading-5"
            />
          </>
        )}

        {text.trim() || pendingFile ? (
          <button onClick={submit} className="p-2.5 rounded-full bg-teal-600 hover:bg-teal-700 text-white transition" title="Enviar (Enter)">
            <Send className="w-5 h-5" />
          </button>
        ) : (
          <button
            onClick={recorder.isRecording ? recorder.stop : recorder.start}
            className={`p-2.5 rounded-full transition ${recorder.isRecording ? 'bg-teal-600 hover:bg-teal-700 text-white' : 'text-gray-500 hover:bg-gray-200'}`}
            title={recorder.isRecording ? 'Parar e enviar' : 'Gravar áudio'}
          >
            {recorder.isRecording ? <Send className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>
        )}
      </div>
    </div>
  )
}
