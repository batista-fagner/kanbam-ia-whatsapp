import { useState, useEffect, useCallback } from 'react'
import { ClipboardList, Loader2, AlertCircle, Sparkles, Check, X, Save } from 'lucide-react'
import { listOnboardingForms, getPromptDraft, generatePromptDraft, updatePromptDraft, approvePromptDraft, discardPromptDraft } from '../services/api'

const STATUS_LABEL = {
  draft: { text: 'Rascunho pendente', className: 'bg-amber-100 text-amber-700' },
  approved: { text: 'Aprovado', className: 'bg-green-100 text-green-700' },
  discarded: { text: 'Descartado', className: 'bg-gray-100 text-gray-500' },
}

function StatusBadge({ status }) {
  if (!status) return <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">Sem rascunho</span>
  const s = STATUS_LABEL[status] ?? { text: status, className: 'bg-gray-100 text-gray-500' }
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.className}`}>{s.text}</span>
}

export default function OnboardingPage() {
  const [forms, setForms] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null) // form selecionado na lista

  const [draft, setDraft] = useState(null) // rascunho carregado do form selecionado
  const [draftLoading, setDraftLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [content, setContent] = useState('') // textarea editável
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    listOnboardingForms()
      .then(setForms)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const openForm = async (form) => {
    setSelected(form)
    setDraft(null)
    setContent('')
    setActionError('')
    if (!form.latestDraftId) return
    setDraftLoading(true)
    try {
      const d = await getPromptDraft(form.latestDraftId)
      setDraft(d)
      setContent(d.content)
    } catch (e) {
      setActionError(e.message)
    } finally {
      setDraftLoading(false)
    }
  }

  const handleGenerate = async () => {
    if (!selected?.tenantId) return
    setGenerating(true)
    setActionError('')
    try {
      const d = await generatePromptDraft(selected.tenantId)
      setDraft(d)
      setContent(d.content)
      load() // atualiza status na lista
    } catch (e) {
      setActionError(e.message)
    } finally {
      setGenerating(false)
    }
  }

  const handleSave = async () => {
    if (!draft) return
    setSaving(true)
    setActionError('')
    try {
      const d = await updatePromptDraft(draft.id, content)
      setDraft({ ...draft, ...d })
    } catch (e) {
      setActionError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleApprove = async () => {
    if (!draft) return
    if (!confirm(`Aprovar e ATIVAR este prompt pro cliente "${selected.tenantName}"? Isso substitui o prompt em produção dele.`)) return
    setSaving(true)
    setActionError('')
    try {
      const d = await approvePromptDraft(draft.id, content)
      setDraft({ ...draft, ...d })
      load()
    } catch (e) {
      setActionError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDiscard = async () => {
    if (!draft) return
    if (!confirm('Descartar este rascunho?')) return
    setSaving(true)
    setActionError('')
    try {
      const d = await discardPromptDraft(draft.id)
      setDraft({ ...draft, ...d })
      load()
    } catch (e) {
      setActionError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const faltaCount = (content.match(/⚠️ FALTA:/g) ?? []).length

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        <ClipboardList className="w-5 h-5 text-teal-700" />
        <h1 className="text-lg font-semibold text-gray-800">Onboarding — formulários e rascunhos de prompt</h1>
        <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">{forms.length}</span>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-gray-400 text-sm py-8"><Loader2 className="w-4 h-4 animate-spin" /> Carregando...</div>
      ) : forms.length === 0 ? (
        <div className="text-center text-gray-400 text-sm py-8">Nenhum formulário recebido ainda.</div>
      ) : (
        <div className="grid grid-cols-[320px_1fr] gap-6">
          {/* Lista de formulários recebidos */}
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 h-fit">
            {forms.map((f) => (
              <button
                key={f.id}
                onClick={() => openForm(f)}
                className={`w-full text-left p-3 hover:bg-gray-50 transition ${selected?.id === f.id ? 'bg-teal-50' : ''}`}
              >
                <div className="font-medium text-sm text-gray-800 truncate">{f.tenantName || f.email || '(sem identificação)'}</div>
                <div className="text-xs text-gray-400 mt-0.5">{new Date(f.createdAt).toLocaleString('pt-BR')}</div>
                <div className="mt-1.5"><StatusBadge status={f.latestDraftStatus} /></div>
              </button>
            ))}
          </div>

          {/* Detalhe: respostas do form + rascunho */}
          <div>
            {!selected ? (
              <div className="text-center text-gray-400 text-sm py-8">Selecione um formulário na lista.</div>
            ) : (
              <div className="space-y-4">
                {!selected.tenantId && (
                  <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-sm">
                    Este formulário não foi vinculado a nenhum cliente (órfão) — não é possível gerar rascunho até resolver isso manualmente.
                  </div>
                )}

                {actionError && (
                  <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" /> {actionError}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  {/* Respostas do formulário */}
                  <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <h2 className="text-sm font-semibold text-gray-700 mb-3">Respostas do formulário</h2>
                    <div className="space-y-3 max-h-[70vh] overflow-y-auto">
                      {Object.entries(selected.answers || {})
                        .filter(([titulo]) => titulo.trim().toLowerCase() !== 'código interno')
                        .map(([titulo, resposta]) => (
                          <div key={titulo}>
                            <div className="text-xs font-medium text-gray-400">{titulo}</div>
                            <div className="text-sm text-gray-700 whitespace-pre-wrap">{resposta || <span className="text-gray-300 italic">(não respondido)</span>}</div>
                          </div>
                        ))}
                    </div>
                  </div>

                  {/* Rascunho gerado */}
                  <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h2 className="text-sm font-semibold text-gray-700">Rascunho do prompt</h2>
                      {faltaCount > 0 && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-600 font-medium">{faltaCount} lacuna(s) ⚠️</span>
                      )}
                    </div>

                    {draftLoading ? (
                      <div className="flex items-center gap-2 text-gray-400 text-sm py-8"><Loader2 className="w-4 h-4 animate-spin" /> Carregando...</div>
                    ) : !draft ? (
                      <div className="text-center py-8">
                        <p className="text-sm text-gray-400 mb-3">Nenhum rascunho gerado ainda pra este cliente.</p>
                        <button
                          onClick={handleGenerate}
                          disabled={generating || !selected.tenantId}
                          className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg bg-teal-700 text-white hover:bg-teal-800 transition disabled:opacity-50"
                        >
                          {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                          Gerar rascunho
                        </button>
                      </div>
                    ) : (
                      <div>
                        <textarea
                          value={content}
                          onChange={(e) => setContent(e.target.value)}
                          disabled={draft.status !== 'draft'}
                          className="w-full h-[55vh] text-xs font-mono border border-gray-200 rounded-lg p-3 focus:outline-none focus:ring-1 focus:ring-teal-500 disabled:bg-gray-50 disabled:text-gray-500"
                        />
                        <div className="flex items-center gap-2 mt-3">
                          {draft.status === 'draft' && (
                            <>
                              <button
                                onClick={handleSave}
                                disabled={saving}
                                className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg text-gray-600 hover:bg-gray-100 transition disabled:opacity-50"
                              >
                                <Save className="w-3.5 h-3.5" /> Salvar rascunho
                              </button>
                              <button
                                onClick={handleApprove}
                                disabled={saving}
                                className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 transition disabled:opacity-50"
                              >
                                <Check className="w-3.5 h-3.5" /> Aprovar e Ativar
                              </button>
                              <button
                                onClick={handleDiscard}
                                disabled={saving}
                                className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg text-red-600 hover:bg-red-50 transition disabled:opacity-50"
                              >
                                <X className="w-3.5 h-3.5" /> Descartar
                              </button>
                              <button
                                onClick={handleGenerate}
                                disabled={generating}
                                className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg text-teal-700 hover:bg-teal-50 transition disabled:opacity-50 ml-auto"
                              >
                                {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                                Gerar de novo
                              </button>
                            </>
                          )}
                          {draft.status === 'approved' && (
                            <span className="text-xs text-green-600 font-medium">✅ Aprovado e ativo pro cliente.</span>
                          )}
                          {draft.status === 'discarded' && (
                            <button
                              onClick={handleGenerate}
                              disabled={generating}
                              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg text-teal-700 hover:bg-teal-50 transition disabled:opacity-50"
                            >
                              {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                              Gerar novo rascunho
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
