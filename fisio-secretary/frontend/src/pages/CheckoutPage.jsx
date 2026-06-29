import { useState } from 'react'
import { CreditCard, QrCode, Loader2, User, Mail, Phone, CheckCircle2, MessageCircle, Wrench } from 'lucide-react'
import { createCheckout, createImplantacaoCheckout } from '../services/api'
import logo from '../assets/logo_hair.png'

const CHECKOUT_TYPES = {
  implantacao: { label: 'Implantação', price: 'R$ 400,00', subtitle: 'Pagamento único', description: 'Taxa de implantação para iniciar no sistema Convert Hair.' },
  plano: { label: 'Plano Mensal', price: 'R$ 310,00/mês', subtitle: 'Recorrente', description: 'Assinatura mensal do plano Convert Hair.' },
}

// Formata só dígitos em algo legível: 27996972230 → (27) 99697-2230
function formatPhone(digits) {
  const d = digits.replace(/\D/g, '')
  if (d.length <= 2) return d
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7, 11)}`
}

export default function CheckoutPage() {
  const [checkoutType, setCheckoutType] = useState('implantacao') // 'implantacao' | 'plano'
  const [form, setForm] = useState({ name: '', email: '', phone: '' })
  const [method, setMethod] = useState('pix')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false) // modal de confirmação do número (PIX)
  const [done, setDone] = useState(false)               // tela de sucesso (PIX enviado)

  const isImplantacao = checkoutType === 'implantacao'
  const currentType = CHECKOUT_TYPES[checkoutType]

  function handleSubmit(e) {
    e.preventDefault()
    setError('')
    // PIX: confirma o número antes de enviar. Cartão: vai direto pro Stripe.
    if (method === 'pix') {
      setConfirmOpen(true)
    } else {
      submit()
    }
  }

  async function submit() {
    setConfirmOpen(false)
    setLoading(true)
    try {
      let res
      if (isImplantacao) {
        res = await createImplantacaoCheckout({ name: form.name, phone: form.phone })
      } else {
        res = await createCheckout({ ...form, method })
      }
      if (res.url) {
        window.location.href = res.url          // cartão → Stripe
      } else if (res.ok) {
        setDone(true)                            // PIX → tela de sucesso
      } else {
        throw new Error('Não foi possível iniciar o checkout.')
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // Tela de sucesso após PIX disparado
  if (done) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-pink-50 via-white to-purple-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-4">
            <img src={logo} alt="Convert Hair" className="h-16 mx-auto object-contain" />
          </div>
          <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100 text-center">
            <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-7 h-7 text-green-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-800 mb-2">Tudo certo! 🎉</h2>
            <p className="text-sm text-gray-600 mb-6 leading-relaxed">
              Seu código PIX está sendo gerado e chegará no seu WhatsApp em até <strong>2 minutos</strong>.
            </p>

            <div className="bg-green-50 border border-green-100 rounded-xl p-4 flex items-center gap-3 text-left">
              <MessageCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
              <p className="text-sm text-gray-700">
                Enviaremos para <strong>{formatPhone(form.phone)}</strong>
              </p>
            </div>

            <p className="text-xs text-gray-400 mt-6 leading-relaxed">
              Após o pagamento ser confirmado, você recebe o login e a senha de acesso no mesmo WhatsApp. ✅
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-white to-purple-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">

        <div className="text-center mb-4">
          <img src={logo} alt="Convert Hair" className="h-16 mx-auto object-contain" />
          <p className="text-gray-500 text-sm mt-2">Comece a converter mais leads</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">

          {/* Seletor de tipo */}
          <div className="grid grid-cols-2 gap-2 mb-6">
            <button type="button" onClick={() => setCheckoutType('implantacao')}
              className={`flex flex-col items-center gap-1 py-3 px-2 rounded-xl border-2 text-sm font-medium transition ${
                isImplantacao ? 'border-pink-500 bg-pink-50 text-pink-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}>
              <Wrench className="w-4 h-4" />
              <span>Implantação</span>
              <span className={`text-xs font-bold ${isImplantacao ? 'text-pink-600' : 'text-gray-400'}`}>R$ 400,00</span>
            </button>
            <button type="button" onClick={() => setCheckoutType('plano')}
              className={`flex flex-col items-center gap-1 py-3 px-2 rounded-xl border-2 text-sm font-medium transition ${
                !isImplantacao ? 'border-pink-500 bg-pink-50 text-pink-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}>
              <QrCode className="w-4 h-4" />
              <span>Plano Mensal</span>
              <span className={`text-xs font-bold ${!isImplantacao ? 'text-pink-600' : 'text-gray-400'}`}>R$ 310,00/mês</span>
            </button>
          </div>

          {/* Destaque do tipo selecionado */}
          <div className="bg-gradient-to-r from-pink-600 to-purple-600 rounded-xl p-4 mb-6 text-white text-center">
            <p className="text-sm opacity-90">{currentType.label} — {currentType.subtitle}</p>
            <p className="text-2xl font-bold">{currentType.price}</p>
            <p className="text-xs opacity-80 mt-1">{currentType.description}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nome / Negócio</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required
                  className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-pink-500" />
              </div>
            </div>
            {!isImplantacao && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">E-mail de acesso</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required
                    className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-pink-500" />
                </div>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">WhatsApp</label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} required
                  placeholder="ex: 27996972230"
                  className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-pink-500" />
              </div>
              <p className="text-xs text-gray-400 mt-1">O código PIX será enviado para este número.</p>
            </div>

            {/* Método de pagamento (plano mensal) */}
            {!isImplantacao && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Forma de pagamento</label>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setMethod('card')}
                    className={`flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-medium transition ${
                      method === 'card' ? 'border-pink-500 bg-pink-50 text-pink-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                    }`}>
                    <CreditCard className="w-4 h-4" /> Cartão
                  </button>
                  <button type="button" onClick={() => setMethod('pix')}
                    className={`flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-medium transition ${
                      method === 'pix' ? 'border-pink-500 bg-pink-50 text-pink-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                    }`}>
                    <QrCode className="w-4 h-4" /> PIX
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-1">Enviamos o código PIX no seu WhatsApp.</p>
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-3 rounded-xl">{error}</div>
            )}

            <button type="submit" disabled={loading}
              className="w-full bg-gradient-to-r from-pink-600 to-purple-600 hover:opacity-90 disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition text-sm flex items-center justify-center gap-2">
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Processando...</> : 'Assinar agora'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">Pagamento seguro · Stripe & Efí Bank</p>
      </div>

      {/* Modal: confirmar número do WhatsApp antes de enviar o PIX */}
      {confirmOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <MessageCircle className="w-6 h-6 text-green-600" />
            </div>
            <h3 className="text-lg font-bold text-gray-800 text-center mb-2">Confirme seu WhatsApp</h3>
            <p className="text-sm text-gray-600 text-center mb-1">
              Enviaremos o código PIX para:
            </p>
            <p className="text-lg font-semibold text-gray-800 text-center mb-5">
              {formatPhone(form.phone)}
            </p>
            <p className="text-xs text-gray-400 text-center mb-5">
              O número está correto? Não dá pra receber o PIX em outro número depois.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmOpen(false)}
                className="flex-1 py-3 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 transition">
                Corrigir número
              </button>
              <button onClick={submit}
                className="flex-1 py-3 rounded-xl bg-gradient-to-r from-pink-600 to-purple-600 text-white text-sm font-semibold hover:opacity-90 transition">
                Sim, enviar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
