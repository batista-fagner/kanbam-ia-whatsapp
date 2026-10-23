import { useEffect, useMemo, useState } from 'react'
import { Upload, X, Loader2, CheckCircle2 } from 'lucide-react'
import { importClients } from '../services/api'
import { parseContacts, readTextFile } from '../utils/parseContacts'

export default function ImportClientsModal({ columns, onClose, onImported }) {
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [stage, setStage] = useState(columns.some((c) => c.id === 'vendas') ? 'vendas' : columns[0]?.id)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const parsed = useMemo(() => parseContacts(text), [text])
  const contacts = parsed.contacts

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (/\.xlsx?$/i.test(file.name)) {
      setError('Planilha do Excel: abra no Excel e use "Salvar como" → CSV, depois envie o CSV.')
      return
    }
    setError('')
    setFileName(file.name)
    setText(await readTextFile(file))
  }

  async function handleSubmit() {
    setError('')
    if (contacts.length === 0) { setError('Nenhum telefone encontrado na lista.'); return }
    setSubmitting(true)
    try {
      const res = await importClients(contacts, stage)
      setResult(res)
      onImported()
    } catch (err) {
      setError(err.message || 'Erro ao importar.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(2px)' }}
      onClick={onClose}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="bg-teal-600 px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Upload className="w-4 h-4 text-white" />
            <span className="text-white text-sm font-semibold">Importar clientes antigos</span>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {result ? (
          <div className="px-5 py-6 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-teal-700 font-semibold text-sm">
              <CheckCircle2 className="w-5 h-5" /> Importação concluída
            </div>
            <ul className="text-sm text-gray-700 space-y-1">
              <li><b>{result.created}</b> clientes novos cadastrados</li>
              <li><b>{result.updated}</b> já estavam no sistema e ganharam a etiqueta "cliente"</li>
              {result.repeated > 0 && <li><b>{result.repeated}</b> repetidos na lista (ignorados)</li>}
              {result.invalid.length > 0 && (
                <li className="text-red-600">
                  <b>{result.invalid.length}</b> números inválidos (não importados): {result.invalid.slice(0, 10).join(', ')}{result.invalid.length > 10 ? '…' : ''}
                </li>
              )}
            </ul>
            <p className="text-xs text-gray-500">Todos estão com a IA desligada. Para a IA atender alguém, ligue no card do lead.</p>
            <button onClick={onClose} className="mt-2 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold">Fechar</button>
          </div>
        ) : (
          <div className="px-5 py-5 flex flex-col gap-4">
            <p className="text-xs text-gray-600 leading-relaxed">
              Cole a lista (um cliente por linha, ex.: <span className="font-mono">Maria Souza, (84) 99999-8888</span>) ou envie um arquivo CSV.
              Todos entram com a etiqueta <b>cliente</b> e com a <b>IA desligada</b>. Quem já está no sistema não duplica: só ganha a etiqueta.
            </p>

            <label className="self-start text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 cursor-pointer">
              Escolher arquivo (.csv ou .txt)
              <input type="file" accept=".csv,.txt,.xlsx,.xls,text/csv,text/plain" onChange={handleFile} className="hidden" />
            </label>

            {fileName ? (
              <div className="flex items-center justify-between text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5">
                <span className="truncate text-gray-700">{fileName}</span>
                <button type="button" onClick={() => { setFileName(''); setText('') }} className="text-gray-400 hover:text-gray-600 ml-2">trocar</button>
              </div>
            ) : (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              placeholder={'Maria Souza, (84) 99999-8888\nAna Lima; 84 98888-7777\n84 97777-6666'}
              className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            )}

            {parsed.columns && (
              <p className="text-[11px] text-gray-500">
                Usando só as colunas <b>{parsed.columns.name}</b> e <b>{parsed.columns.phones.join(', ')}</b>; o resto do arquivo é ignorado.
                {parsed.withoutPhone > 0 && <> {parsed.withoutPhone} cliente(s) sem telefone ficaram de fora.</>}
              </p>
            )}

            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-gray-500">{contacts.length} contato(s) encontrado(s)</span>
              <label className="flex items-center gap-2 text-xs text-gray-600">
                Raia
                <select value={stage} onChange={(e) => setStage(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white">
                  {columns.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </label>
            </div>

            {contacts.length > 0 && (
              <div className="max-h-28 overflow-y-auto text-[11px] text-gray-500 border border-gray-100 rounded-lg p-2">
                {contacts.slice(0, 5).map((c, i) => <div key={i}>{c.name || '(sem nome)'} — {c.phone}</div>)}
                {contacts.length > 5 && <div>… e mais {contacts.length - 5}</div>}
              </div>
            )}

            {error && <p className="text-xs text-red-500">{error}</p>}

            <div className="flex gap-2 pt-1">
              <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting || contacts.length === 0}
                className="flex-1 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors"
              >
                {submitting ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Importando...</> : <><Upload className="w-3.5 h-3.5" /> Importar {contacts.length || ''}</>}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
