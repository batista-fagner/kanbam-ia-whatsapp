import { useEffect, useState } from 'react'
import { Instagram, Loader2 } from 'lucide-react'
import { getAdminInstagramStatus, connectAdminInstagram, testAdminInstagram, disconnectAdminInstagram } from '../../services/api'

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('pt-BR') : '—')

// Card do Admin (ClientDrawer): conecta o Instagram do cliente colando o token gerado no app
// CRM-IA (Meta → Casos de uso → API do Instagram → "Gerar token"). O token só vai na ida — o
// backend guarda criptografado, liga a assinatura do webhook e nunca devolve.
export default function InstagramAdminCard({ tenantId }) {
  const [status, setStatus] = useState(null)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!tenantId) return
    getAdminInstagramStatus(tenantId).then(setStatus).catch((e) => setError(e.message))
  }, [tenantId])

  async function run(kind, fn) {
    setBusy(kind); setError(''); setMsg('')
    try { await fn() } catch (e) { setError(e.message) } finally { setBusy('') }
  }

  const connected = !!status?.connected

  return (
    <div className="mb-5 border border-gray-200 rounded-xl p-4">
      <span className="flex items-center gap-2 text-sm font-medium text-gray-700">
        <Instagram className="w-4 h-4 text-pink-600" /> Automação de Instagram
        {connected && <span className="text-xs font-medium text-pink-700 bg-pink-50 px-2 py-0.5 rounded-full">conectado — @{status.username}</span>}
      </span>

      {!status && !error && <Loader2 className="w-4 h-4 animate-spin text-gray-400 mt-2" />}

      {status && (
        <>
          <div className="flex gap-2 mt-2">
            <input
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={connected ? 'Colar novo token para trocar' : 'Cole o token do Instagram (IGAA…)'}
              className="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-300"
            />
            <button
              onClick={() => run('save', async () => {
                const s = await connectAdminInstagram(tenantId, token.trim())
                setStatus(s); setToken('')
                setMsg(s.lastError ? `Conta @${s.username} salva, mas: ${s.lastError}` : `Conta @${s.username} conectada e webhook assinado.`)
              })}
              disabled={!!busy || token.trim().length < 30}
              className="px-3 py-2 text-sm font-medium text-white bg-pink-600 rounded-lg hover:bg-pink-700 disabled:opacity-40"
            >
              {busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Salvar'}
            </button>
          </div>

          {connected && (
            <div className="flex flex-wrap gap-2 mt-2">
              <button
                onClick={() => run('test', async () => {
                  const r = await testAdminInstagram(tenantId)
                  if (r.ok) setMsg(`Conexão ok — @${r.username}.`)
                  else setError(r.error || 'O Instagram recusou o token')
                })}
                disabled={!!busy}
                className="px-3 py-1.5 text-xs text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40"
              >
                {busy === 'test' ? 'Testando…' : 'Testar conexão'}
              </button>
              <button
                onClick={() => run('off', async () => {
                  await disconnectAdminInstagram(tenantId)
                  setStatus(await getAdminInstagramStatus(tenantId)); setMsg('Instagram desconectado. As automações ficaram guardadas.')
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
              Token renovado em {fmtDate(status.tokenRefreshedAt)} · vence em {fmtDate(status.tokenExpiresAt)} (renova sozinho)
              {status.lastError ? ` · último erro: ${status.lastError}` : ''}
            </p>
          )}
          {msg && <p className="text-xs text-pink-700 mt-1.5">{msg}</p>}
        </>
      )}
      {error && <p className="text-xs text-red-600 mt-1.5">{error}</p>}
      <p className="text-xs text-gray-400 mt-1.5">
        A conta precisa ser Testadora do Instagram no app CRM-IA e ter aceitado o convite. O token sai em Meta → CRM-IA → Casos de uso → API do Instagram → "Gerar token". Depois disso a cliente configura tudo na tela Instagram dela.
      </p>
    </div>
  )
}
