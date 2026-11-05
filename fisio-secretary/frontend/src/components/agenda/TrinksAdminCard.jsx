import { useEffect, useState } from 'react'
import { CalendarCheck2, Loader2 } from 'lucide-react'
import { getAdminTrinksStatus, connectAdminTrinks, testAdminTrinks, disconnectAdminTrinks, setAdminTrinksMode } from '../../services/api'

// Card do Admin (ClientDrawer): cadastra a chave da API da Trinks do cliente, testa e liga a
// agenda da Trinks. A chave só vai na ida — o backend guarda criptografada e nunca devolve.
export default function TrinksAdminCard({ tenantId }) {
  const [status, setStatus] = useState(null)
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!tenantId) return
    getAdminTrinksStatus(tenantId).then(setStatus).catch((e) => setError(e.message))
  }, [tenantId])

  async function run(kind, fn) {
    setBusy(kind); setError(''); setMsg('')
    try { await fn() } catch (e) { setError(e.message) } finally { setBusy('') }
  }

  const connected = !!status?.connected
  const on = status?.mode === 'trinks'

  return (
    <div className="mb-5 border border-gray-200 rounded-xl p-4">
      <span className="flex items-center gap-2 text-sm font-medium text-gray-700">
        <CalendarCheck2 className="w-4 h-4 text-teal-600" /> Integração Trinks
        {connected && <span className="text-xs font-medium text-teal-700 bg-teal-50 px-2 py-0.5 rounded-full">conectada{status.establishmentName ? ` — ${status.establishmentName}` : ''}</span>}
        {on && <span className="text-xs font-medium text-pink-700 bg-pink-50 px-2 py-0.5 rounded-full">agenda ligada</span>}
      </span>

      {!status && !error && <Loader2 className="w-4 h-4 animate-spin text-gray-400 mt-2" />}

      {status && (
        <>
          <div className="flex gap-2 mt-2">
            <input
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={connected ? 'Colar nova chave para trocar' : 'Cole a chave da API da Trinks'}
              className="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-300"
            />
            <button
              onClick={() => run('save', async () => {
                const s = await connectAdminTrinks(tenantId, apiKey.trim())
                setStatus(s); setApiKey(''); setMsg('Chave salva e catálogo copiado da Trinks.')
              })}
              disabled={!!busy || apiKey.trim().length < 20}
              className="px-3 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-40"
            >
              {busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Salvar'}
            </button>
          </div>

          {connected && (
            <div className="flex flex-wrap gap-2 mt-2">
              <button
                onClick={() => run('test', async () => {
                  const r = await testAdminTrinks(tenantId)
                  if (r.ok) setMsg(`Conexão ok — ${r.establishmentName || 'estabelecimento encontrado'}.`)
                  else setError(r.error || 'A Trinks recusou a conexão')
                })}
                disabled={!!busy}
                className="px-3 py-1.5 text-xs text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40"
              >
                {busy === 'test' ? 'Testando…' : 'Testar conexão'}
              </button>
              <button
                onClick={() => run('mode', async () => setStatus(await setAdminTrinksMode(tenantId, !on)))}
                disabled={!!busy}
                className={`px-3 py-1.5 text-xs rounded-lg border disabled:opacity-40 ${on ? 'text-gray-700 border-gray-200 hover:bg-gray-50' : 'text-white bg-pink-600 border-pink-600 hover:bg-pink-700'}`}
              >
                {busy === 'mode' ? 'Salvando…' : on ? 'Voltar para a agenda do CRM' : 'Usar a agenda da Trinks'}
              </button>
              <button
                onClick={() => run('off', async () => {
                  await disconnectAdminTrinks(tenantId)
                  setStatus(await getAdminTrinksStatus(tenantId)); setMsg('Trinks desconectada. A IA parou de agendar.')
                })}
                disabled={!!busy}
                className="px-3 py-1.5 text-xs text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-40"
              >
                Desconectar
              </button>
            </div>
          )}

          {connected && (
            <p className="text-xs text-gray-500 mt-2">
              Consultas no mês: {status.usage?.count ?? 0} de {status.usage?.limit ?? 5000}
              {status.catalogCounts ? ` · ${status.catalogCounts.services} serviços e ${status.catalogCounts.professionals} profissionais copiados` : ''}
              {status.lastError ? ` · último erro: ${status.lastError}` : ''}
            </p>
          )}
          {msg && <p className="text-xs text-teal-700 mt-1.5">{msg}</p>}
        </>
      )}
      {error && <p className="text-xs text-red-600 mt-1.5">{error}</p>}
      <p className="text-xs text-gray-400 mt-1.5">
        A IA agenda direto na Trinks, só nos serviços que a cliente aprovar na tela Agenda dela. "Usar a agenda da Trinks" troca a agenda do CRM pela Trinks; a IA só começa a marcar quando a cliente liga "A IA pode agendar sozinha".
      </p>
    </div>
  )
}
