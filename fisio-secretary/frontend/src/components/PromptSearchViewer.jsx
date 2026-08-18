import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Search, ChevronUp, ChevronDown, X } from 'lucide-react'

// Textarea de prompt com busca + highlight (usado em SettingsPage e no admin
// de auditoria de prompts). O highlight é feito com um <pre> transparente
// posicionado atrás do <textarea> (fundo transparente), sincronizado no scroll.
const PromptSearchViewer = forwardRef(function PromptSearchViewer(
  { value, onChange, readOnly = false, heightClass = 'h-80', placeholder = '' },
  externalRef,
) {
  const innerRef = useRef(null)
  const textareaRef = externalRef ?? innerRef
  const preRef = useRef(null)
  const activeMatchRef = useRef(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [searchIndex, setSearchIndex] = useState(0)

  const searchOccurrences = (term, text) => {
    if (!term) return []
    const lower = text.toLowerCase()
    const key = term.toLowerCase()
    const positions = []
    let pos = 0
    while ((pos = lower.indexOf(key, pos)) !== -1) {
      positions.push(pos)
      pos += key.length
    }
    return positions
  }

  const navigateSearch = (dir) => {
    const positions = searchOccurrences(searchTerm, value)
    if (positions.length === 0) return
    const next = (searchIndex + dir + positions.length) % positions.length
    setSearchIndex(next)
    // Foco só é roubado numa navegação explícita (Enter/setas) — nunca a cada
    // tecla digitada, senão corta a digitação no campo de busca.
    textareaRef.current?.focus()
  }

  // O <textarea> real tem barra de rolagem (perde ~15-17px de largura útil pro
  // texto); o <pre> de highlight, por trás, usa overflow-hidden e nunca tem
  // barra — então sobra mais largura pra ele, o texto quebra em pontos
  // diferentes entre os dois, e o highlight desalinha cada vez mais conforme
  // desce no documento. Força a mesma largura de conteúdo nos dois.
  useLayoutEffect(() => {
    const el = textareaRef.current
    const pre = preRef.current
    if (!el || !pre) return
    const sync = () => {
      const gutter = el.offsetWidth - el.clientWidth
      pre.style.width = `calc(100% - ${gutter}px)`
    }
    sync()
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  })

  // O scroll não pode ser estimado por "número de linhas × altura fixa" — linhas
  // longas (as tabelas do prompt, por exemplo) quebram em várias linhas visuais,
  // então essa conta desalinhava cada vez mais quanto mais fundo estava o resultado.
  // Em vez disso, lê a posição real do span destacado no <pre> (que renderiza o
  // mesmo texto com a mesma fonte) e usa ela pra rolar o textarea de verdade.
  useEffect(() => {
    const el = textareaRef.current
    const match = activeMatchRef.current
    if (!el || !match || !searchTerm) return
    const positions = searchOccurrences(searchTerm, value)
    const start = positions[searchIndex]
    if (start === undefined) return
    const end = start + searchTerm.length
    el.setSelectionRange(start, end)
    const target = Math.max(0, match.offsetTop - el.clientHeight / 2)
    el.scrollTop = target
    if (preRef.current) preRef.current.scrollTop = target
  }, [searchIndex, searchTerm, value])

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={e => { setSearchTerm(e.target.value); setSearchIndex(0) }}
            onKeyDown={e => { if (e.key === 'Enter') navigateSearch(e.shiftKey ? -1 : 1) }}
            placeholder="Buscar no prompt..."
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white text-gray-800 placeholder-gray-400"
          />
        </div>
        {searchTerm && (() => {
          const total = searchOccurrences(searchTerm, value).length
          return (
            <>
              <span className="text-sm text-gray-600 font-medium whitespace-nowrap">
                {total === 0 ? 'Não encontrado' : `${searchIndex + 1}/${total}`}
              </span>
              <button onClick={() => navigateSearch(-1)} disabled={total === 0} className="p-1 rounded hover:bg-teal-50 disabled:opacity-30 transition">
                <ChevronUp className="w-3.5 h-3.5 text-teal-600" />
              </button>
              <button onClick={() => navigateSearch(1)} disabled={total === 0} className="p-1 rounded hover:bg-teal-50 disabled:opacity-30 transition">
                <ChevronDown className="w-3.5 h-3.5 text-teal-600" />
              </button>
              <button onClick={() => setSearchTerm('')} className="p-1 rounded hover:bg-gray-100 transition">
                <X className="w-3.5 h-3.5 text-gray-500" />
              </button>
            </>
          )
        })()}
      </div>
      <div className="relative">
        {searchTerm && (() => {
          const positions = searchOccurrences(searchTerm, value)
          if (positions.length === 0) return null
          const parts = []
          let lastEnd = 0
          positions.forEach((start, idx) => {
            const end = start + searchTerm.length
            parts.push({ content: value.slice(lastEnd, start), isHighlight: false })
            parts.push({ content: value.slice(start, end), isHighlight: idx === searchIndex })
            lastEnd = end
          })
          parts.push({ content: value.slice(lastEnd), isHighlight: false })
          return (
            <pre
              ref={preRef}
              className={`absolute inset-0 w-full ${heightClass} text-sm font-mono p-3 border border-transparent resize-none pointer-events-none whitespace-pre-wrap break-words overflow-hidden rounded-lg leading-relaxed`}
              style={{ color: 'transparent' }}
            >
              {parts.map((part, idx) =>
                part.isHighlight ? (
                  <span key={idx} ref={activeMatchRef} className="bg-yellow-300">{part.content}</span>
                ) : (
                  part.content
                )
              )}
            </pre>
          )
        })()}
        <textarea
          ref={textareaRef}
          value={value}
          readOnly={readOnly}
          onChange={readOnly ? undefined : e => onChange?.(e.target.value)}
          onScroll={e => {
            if (preRef.current) preRef.current.scrollTop = e.target.scrollTop
          }}
          className={`relative w-full ${heightClass} text-sm font-mono border border-gray-200 rounded-lg p-3 resize-none focus:outline-none focus:ring-2 focus:ring-teal-500 text-gray-700 leading-relaxed bg-transparent`}
          placeholder={placeholder}
          spellCheck={false}
        />
      </div>
    </div>
  )
})

export default PromptSearchViewer
