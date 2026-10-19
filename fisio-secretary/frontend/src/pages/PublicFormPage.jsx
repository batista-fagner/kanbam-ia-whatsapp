import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { Loader2, Paperclip, X, CheckCircle2, AlertCircle, UploadCloud } from 'lucide-react'

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'
const MAX_MB = 40

const call = async (path, opts) => {
  const r = await fetch(`${BASE}/forms/public/${path}`, opts)
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data?.message || `HTTP ${r.status}`)
  return data
}

function formatSize(bytes) {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export default function PublicFormPage() {
  const { token } = useParams()
  const [form, setForm] = useState(null)
  const [answers, setAnswers] = useState({})
  const [files, setFiles] = useState([])
  const [error, setError] = useState('')
  const [saveState, setSaveState] = useState('') // '', 'saving', 'saved', 'error'
  const [uploading, setUploading] = useState({}) // questionId -> nº de uploads em andamento
  const [uploadError, setUploadError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const timer = useRef(null)
  const latest = useRef({})

  useEffect(() => {
    call(token)
      .then((d) => {
        setForm(d)
        setAnswers(d.answers || {})
        setFiles(d.files || [])
        latest.current = d.answers || {}
        if (d.submittedAt) setDone(true)
      })
      .catch((e) => setError(e.message))
  }, [token])

  const persist = useCallback(async () => {
    setSaveState('saving')
    try {
      await call(`${token}/answers`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: latest.current }),
      })
      setSaveState('saved')
    } catch {
      setSaveState('error')
    }
  }, [token])

  const onChange = (id, value) => {
    setAnswers((a) => ({ ...a, [id]: value }))
    latest.current = { ...latest.current, [id]: value }
    setSaveState('')
    clearTimeout(timer.current)
    timer.current = setTimeout(persist, 900)
  }

  const upload = async (questionId, fileList) => {
    setUploadError('')
    for (const file of Array.from(fileList)) {
      if (file.size > MAX_MB * 1024 * 1024) {
        setUploadError(`"${file.name}" tem mais de ${MAX_MB} MB. Envie um arquivo menor.`)
        continue
      }
      setUploading((u) => ({ ...u, [questionId]: (u[questionId] || 0) + 1 }))
      try {
        const fd = new FormData()
        fd.append('questionId', questionId)
        fd.append('file', file)
        const entry = await call(`${token}/files`, { method: 'POST', body: fd })
        setFiles((f) => [...f, entry])
      } catch (e) {
        setUploadError(`Não consegui enviar "${file.name}": ${e.message}`)
      } finally {
        setUploading((u) => ({ ...u, [questionId]: u[questionId] - 1 }))
      }
    }
  }

  const removeFile = async (id) => {
    try {
      await call(`${token}/files/${id}`, { method: 'DELETE' })
      setFiles((f) => f.filter((x) => x.id !== id))
    } catch (e) {
      setUploadError(e.message)
    }
  }

  const submit = async () => {
    clearTimeout(timer.current)
    setSubmitting(true)
    setError('')
    try {
      await call(`${token}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: latest.current }),
      })
      setDone(true)
      window.scrollTo({ top: 0 })
    } catch (e) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (error && !form) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50">
        <div className="max-w-sm text-center">
          <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-3" />
          <p className="text-gray-700 font-medium">Esse link não está disponível.</p>
          <p className="text-sm text-gray-400 mt-1">Confira se copiou o link inteiro ou peça um novo para a nossa equipe.</p>
        </div>
      </div>
    )
  }

  if (!form) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
  }

  const isAnswered = (q) => (answers[q.id] || '').trim() || files.some((f) => f.questionId === q.id)
  const answeredCount = form.questions.filter(isAnswered).length
  const anyUploading = Object.values(uploading).some((n) => n > 0)

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50">
        <div className="max-w-sm text-center bg-white rounded-2xl border border-gray-200 p-8">
          <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-3" />
          <h1 className="text-lg font-semibold text-gray-800">Recebemos tudo, obrigado!</h1>
          <p className="text-sm text-gray-500 mt-2">Nossa equipe vai configurar a sua IA com essas informações e te avisa pelo grupo.</p>
          <button onClick={() => setDone(false)} className="mt-5 text-sm text-teal-700 underline">
            Quero revisar ou completar minhas respostas
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-xl font-semibold text-gray-800">{form.title}</h1>
        {form.businessName && <p className="text-sm text-teal-700 font-medium mt-1">{form.businessName}</p>}
        <p className="text-sm text-gray-500 mt-3 leading-relaxed">{form.intro}</p>

        <div className="mt-5 mb-6">
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>{answeredCount} de {form.questions.length} respondidas</span>
            <span>
              {saveState === 'saving' && 'Salvando…'}
              {saveState === 'saved' && 'Salvo ✓'}
              {saveState === 'error' && <span className="text-red-500">Não consegui salvar — tente de novo</span>}
            </span>
          </div>
          <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full bg-teal-600 transition-all" style={{ width: `${(answeredCount / form.questions.length) * 100}%` }} />
          </div>
        </div>

        <div className="space-y-5">
          {form.questions.map((q, i) => {
            const qFiles = files.filter((f) => f.questionId === q.id)
            const canFiles = q.type === 'file' || q.allowFiles
            return (
              <div key={q.id} className="bg-white rounded-xl border border-gray-200 p-4">
                <label className="block text-sm font-medium text-gray-800">
                  <span className="text-gray-400 mr-1">{i + 1}.</span>{q.label}
                  {q.optional && <span className="ml-2 text-xs font-normal text-gray-400 border border-gray-200 rounded-full px-2 py-0.5">opcional</span>}
                </label>
                {q.hint && <p className="text-xs text-gray-400 mt-1">{q.hint}</p>}

                {q.type !== 'file' && (
                  <textarea
                    value={answers[q.id] || ''}
                    onChange={(e) => onChange(q.id, e.target.value)}
                    rows={4}
                    placeholder="Digite aqui…"
                    className="mt-3 w-full text-sm border border-gray-300 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-teal-500 resize-y"
                  />
                )}

                {canFiles && (
                  <div className="mt-3">
                    <label className="inline-flex items-center gap-2 text-sm text-teal-700 border border-dashed border-teal-300 rounded-lg px-3 py-2 cursor-pointer hover:bg-teal-50">
                      <UploadCloud className="w-4 h-4" />
                      {q.type === 'file' ? 'Enviar fotos, vídeos ou PDF' : 'Anexar foto ou PDF'}
                      <input
                        type="file"
                        multiple
                        accept="image/*,video/*,application/pdf"
                        className="hidden"
                        onChange={(e) => { upload(q.id, e.target.files); e.target.value = '' }}
                      />
                    </label>
                    {uploading[q.id] > 0 && (
                      <span className="ml-3 text-xs text-gray-400 inline-flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" /> enviando {uploading[q.id]}…
                      </span>
                    )}
                    {qFiles.length > 0 && (
                      <ul className="mt-3 space-y-1.5">
                        {qFiles.map((f) => (
                          <li key={f.id} className="flex items-center gap-2 text-xs text-gray-600 bg-gray-50 rounded-lg px-2.5 py-1.5">
                            <Paperclip className="w-3 h-3 text-gray-400 shrink-0" />
                            <span className="truncate flex-1">{f.name}</span>
                            <span className="text-gray-400 shrink-0">{formatSize(f.size)}</span>
                            <button onClick={() => removeFile(f.id)} className="text-gray-400 hover:text-red-500" title="Remover">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {uploadError && <div className="mt-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{uploadError}</div>}
        {error && <div className="mt-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}

        <button
          onClick={submit}
          disabled={submitting || anyUploading}
          className="mt-6 w-full py-3 rounded-xl bg-teal-700 text-white font-medium disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {(submitting || anyUploading) && <Loader2 className="w-4 h-4 animate-spin" />}
          {anyUploading ? 'Aguarde os arquivos terminarem de enviar…' : 'Enviar respostas'}
        </button>
        <p className="text-xs text-gray-400 text-center mt-3">
          Não precisa responder tudo de uma vez: suas respostas ficam salvas e você pode voltar neste mesmo link.
        </p>
      </div>
    </div>
  )
}
