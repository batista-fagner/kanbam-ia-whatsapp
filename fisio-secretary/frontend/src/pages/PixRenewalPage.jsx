import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { Copy, Check, CheckCircle2, Loader2, AlertCircle } from 'lucide-react'
import { getPixPageData } from '../services/api'
import logo from '../assets/logo_hair.png'

export default function PixRenewalPage() {
  const { txid } = useParams()
  const [data, setData] = useState(null) // { status, valor, qrCode, pixCode, clientName }
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    getPixPageData(txid)
      .then(setData)
      .catch(() => setError('Não foi possível carregar sua cobrança. Tente novamente em instantes.'))
  }, [txid])

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(data.pixCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      // clipboard indisponível (contexto não-seguro/permissão) — usuário pode selecionar o texto manualmente
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-white to-purple-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-4">
          <img src={logo} alt="Convert Hair" className="h-16 mx-auto object-contain" />
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
          {error && (
            <div className="text-center py-6">
              <div className="w-14 h-14 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="w-7 h-7 text-red-500" />
              </div>
              <p className="text-sm text-gray-600">{error}</p>
            </div>
          )}

          {!error && !data && (
            <div className="flex justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-pink-500" />
            </div>
          )}

          {!error && data?.status === 'paid' && (
            <div className="text-center py-6">
              <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-7 h-7 text-green-600" />
              </div>
              <h2 className="text-xl font-bold text-gray-800 mb-2">Pagamento confirmado! 🎉</h2>
              <p className="text-sm text-gray-600">
                Sua renovação já foi processada. Obrigado por continuar com a Convert Hair!
              </p>
            </div>
          )}

          {!error && data?.status === 'expired' && (
            <div className="text-center py-6">
              <div className="w-14 h-14 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="w-7 h-7 text-amber-500" />
              </div>
              <h2 className="text-xl font-bold text-gray-800 mb-2">Link expirado</h2>
              <p className="text-sm text-gray-600">
                Este código Pix não está mais disponível. Se você ainda precisa renovar, entre em contato pelo WhatsApp.
              </p>
            </div>
          )}

          {!error && data?.status === 'pending' && (
            <>
              <div className="bg-gradient-to-r from-pink-600 to-purple-600 rounded-xl p-4 mb-6 text-white text-center">
                <p className="text-sm opacity-90">Renovação mensal{data.clientName ? ` — ${data.clientName}` : ''}</p>
                <p className="text-2xl font-bold">R$ {data.valor}</p>
              </div>

              <div className="flex justify-center mb-6">
                <img
                  src={data.qrCode}
                  alt="QR Code Pix"
                  className="w-48 h-48 rounded-xl border border-gray-100"
                />
              </div>

              <p className="text-sm text-gray-600 text-center mb-3">
                Escaneie o QR code ou copie o código abaixo no app do seu banco, na opção Pix Copia e Cola.
              </p>

              <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 mb-3">
                <p className="text-xs font-mono text-gray-500 break-all leading-relaxed">{data.pixCode}</p>
              </div>

              <button
                type="button"
                onClick={copyCode}
                className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition ${
                  copied
                    ? 'bg-green-100 text-green-700'
                    : 'bg-gradient-to-r from-pink-600 to-purple-600 text-white hover:opacity-90'
                }`}
              >
                {copied ? <><Check className="w-4 h-4" /> Código copiado!</> : <><Copy className="w-4 h-4" /> Copiar código Pix</>}
              </button>

              <p className="text-xs text-gray-400 text-center mt-6 leading-relaxed">
                Após o pagamento, a confirmação é automática — pode levar até 1 minuto para atualizar.
              </p>
            </>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">Pagamento seguro · Efí Bank</p>
      </div>
    </div>
  )
}
