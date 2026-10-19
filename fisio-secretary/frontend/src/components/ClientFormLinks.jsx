import { useState, useEffect, useCallback } from 'react'
import { Link2, Copy, Check, Loader2 } from 'lucide-react'
import { getClients, listClientForms, listClientFormDefinitions, createClientForm } from '../services/api'

// Gera o link do formulário próprio (alternativa ao Google Forms) pra um cliente e mostra o andamento.
// As respostas enviadas aparecem na lista de formulários logo abaixo, na página de Onboarding.
export default function ClientFormLinks() {
  const [clients, setClients] = useState([])
  const [defs, setDefs] = useState([])
  const [links, setLinks] = useState([])
  const [tenantId, setTenantId] = useState('')
  const [formKey, setFormKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')

  const load = useCallback(() => {
    Promise.all([getClients(), listClientFormDefinitions(), listClientForms()])
      .then(([c, d, l]) => {
        setClients(c.filter((x) => !x.archivedAt))
        setDefs(d)
        setLinks(l)
        setFormKey((k) => k || d[0]?.key || '')
      })
      .catch((e) => setError(e.message))
  }, [])

  useEffect(() => { load() }, [load])

  const generate = async () => {
    if (!tenantId || !formKey) return
    setBusy(true)
    setError('')
    try {
      const f = await createClientForm(tenantId, formKey)
      await navigator.clipboard?.writeText(f.link).catch(() => {})
      setCopied(f.id)
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const copy = async (f) => {
    await navigator.clipboard?.writeText(f.link).catch(() => {})
    setCopied(f.id)
    setTimeout(() => setCopied((c) => (c === f.id ? '' : c)), 2000)
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Link2 className="w-4 h-4 text-teal-700" />
        <h2 className="text-sm font-semibold text-gray-700">Formulário próprio — gerar link para o cliente</h2>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <select value={tenantId} onChange={(e) => setTenantId(e.target.value)} className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 min-w-[220px]">
          <option value="">Escolha o cliente…</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.displayName || c.profileName || c.id}</option>)}
        </select>
        <select value={formKey} onChange={(e) => setFormKey(e.target.value)} className="text-sm border border-gray-300 rounded-lg px-2 py-1.5">
          {defs.map((d) => <option key={d.key} value={d.key}>{d.title} ({d.key})</option>)}
        </select>
        <button onClick={generate} disabled={!tenantId || !formKey || busy} className="text-sm px-3 py-1.5 rounded-lg bg-teal-700 text-white disabled:opacity-50 flex items-center gap-1.5">
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Gerar e copiar link
        </button>
      </div>
      {error && <div className="mt-3 text-sm text-red-600">{error}</div>}

      {links.length > 0 && (
        <div className="mt-4 divide-y divide-gray-100 border border-gray-100 rounded-lg">
          {links.map((f) => (
            <div key={f.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-gray-800 truncate">{f.tenantName || f.tenantId} <span className="text-xs text-gray-400">· {f.formKey}</span></div>
                <div className="text-xs text-gray-400">
                  {f.submittedAt
                    ? `Enviado em ${new Date(f.submittedAt).toLocaleString('pt-BR')}`
                    : f.answered > 0 ? 'Em andamento' : 'Ainda não abriu'}
                  {' · '}{f.answered}/{f.total} respondidas · {f.fileCount} arquivo(s)
                </div>
              </div>
              <button onClick={() => copy(f)} className="text-xs px-2.5 py-1 rounded-lg border border-gray-300 hover:bg-gray-50 flex items-center gap-1 shrink-0">
                {copied === f.id ? <><Check className="w-3 h-3 text-green-600" /> Copiado</> : <><Copy className="w-3 h-3" /> Copiar link</>}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
