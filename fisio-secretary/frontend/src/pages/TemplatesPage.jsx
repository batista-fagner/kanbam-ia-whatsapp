import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, Copy, CheckCircle2, Loader2, BookOpen, X } from 'lucide-react'
import { authFetch } from '../services/api'
import { useAuth } from '../context/AuthContext'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

const AGENT_LABELS = { fisio: 'Fisioterapia', megahair: 'Mega Hair', '': 'Todos' }

function TemplateModal({ template, onSave, onClose }) {
  const [form, setForm] = useState({
    name: template?.name ?? '',
    description: template?.description ?? '',
    content: template?.content ?? '',
    agentType: template?.agentType ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Nome é obrigatório'); return }
    setSaving(true)
    setError('')
    try {
      const method = template ? 'PATCH' : 'POST'
      const url = template ? `${API_URL}/templates/${template.id}` : `${API_URL}/templates`
      const res = await authFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, agentType: form.agentType || null }),
      })
      const data = await res.json()
      onSave(data)
    } catch {
      setError('Erro ao salvar template')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-800">{template ? 'Editar template' : 'Novo template'}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 transition">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Nome *</label>
              <input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500"
                placeholder="Ex: Mega Hair — Padrão"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Descrição</label>
              <input
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500"
                placeholder="Ex: Template para salões com fluxo de qualificação"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Agente</label>
              <select
                value={form.agentType}
                onChange={e => setForm(f => ({ ...f, agentType: e.target.value }))}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white"
              >
                <option value="">Todos</option>
                <option value="megahair">Mega Hair</option>
                <option value="fisio">Fisioterapia</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Conteúdo do prompt *</label>
              <textarea
                value={form.content}
                onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                className="w-full text-sm font-mono border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
                rows={16}
                placeholder="Cole o prompt de exemplo aqui..."
                spellCheck={false}
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-teal-700 rounded-lg hover:bg-teal-800 transition disabled:opacity-50">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function TemplatesPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [copied, setCopied] = useState(null)
  const [expanded, setExpanded] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)

  useEffect(() => {
    authFetch(`${API_URL}/templates`)
      .then(r => r.json())
      .then(data => setTemplates(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false))
  }, [])

  function handleSaved(saved) {
    setTemplates(prev => {
      const idx = prev.findIndex(t => t.id === saved.id)
      if (idx >= 0) { const next = [...prev]; next[idx] = saved; return next }
      return [...prev, saved]
    })
    setModalOpen(false)
    setEditing(null)
  }

  async function handleDelete(id) {
    await authFetch(`${API_URL}/templates/${id}`, { method: 'DELETE' })
    setTemplates(prev => prev.filter(t => t.id !== id))
    setConfirmDelete(null)
  }

  function handleCopy(t) {
    navigator.clipboard.writeText(t.content).catch(() => {})
    setCopied(t.id)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-teal-600" />
          <h1 className="text-lg font-bold text-gray-800">Templates de Prompt</h1>
          <span className="text-xs bg-teal-50 text-teal-700 px-2 py-0.5 rounded-full">{templates.length}</span>
        </div>
        {isAdmin && (
          <button
            onClick={() => { setEditing(null); setModalOpen(true) }}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-teal-700 rounded-lg hover:bg-teal-800 transition"
          >
            <Plus className="w-4 h-4" /> Novo template
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 text-teal-600 animate-spin" />
        </div>
      ) : templates.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Nenhum template cadastrado ainda.</p>
          {isAdmin && <p className="text-xs mt-1">Clique em "Novo template" para adicionar.</p>}
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map(t => (
            <div key={t.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4">
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    onClick={() => setExpanded(expanded === t.id ? null : t.id)}
                    className="text-left min-w-0"
                  >
                    <p className="text-sm font-semibold text-gray-800 truncate">{t.name}</p>
                    {t.description && <p className="text-xs text-gray-500 mt-0.5 truncate">{t.description}</p>}
                  </button>
                  {t.agentType && (
                    <span className="flex-shrink-0 text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full">
                      {AGENT_LABELS[t.agentType] ?? t.agentType}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                  <button
                    onClick={() => handleCopy(t)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition ${
                      copied === t.id ? 'bg-green-100 text-green-700' : 'bg-teal-700 text-white hover:bg-teal-800'
                    }`}
                  >
                    {copied === t.id ? <><CheckCircle2 className="w-3.5 h-3.5" /> Copiado!</> : <><Copy className="w-3.5 h-3.5" /> Copiar</>}
                  </button>
                  {isAdmin && (
                    <>
                      <button
                        onClick={() => { setEditing(t); setModalOpen(true) }}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-teal-600 hover:bg-teal-50 transition"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setConfirmDelete(t)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>
              {expanded === t.id && (
                <div className="border-t border-gray-100 px-5 py-4 bg-gray-50">
                  <pre className="text-xs text-gray-700 font-mono whitespace-pre-wrap leading-relaxed max-h-80 overflow-y-auto">
                    {t.content || <span className="text-gray-400 italic">Sem conteúdo</span>}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <TemplateModal
          template={editing}
          onSave={handleSaved}
          onClose={() => { setModalOpen(false); setEditing(null) }}
        />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-80 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-800">Excluir template?</p>
                <p className="text-xs text-gray-500 mt-0.5">"{confirmDelete.name}" será removido permanentemente.</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDelete(null)} className="flex-1 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition">Cancelar</button>
              <button onClick={() => handleDelete(confirmDelete.id)} className="flex-1 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition">Excluir</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
