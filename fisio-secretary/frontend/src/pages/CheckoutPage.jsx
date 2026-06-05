import { useState } from 'react'
import { CreditCard, QrCode, Loader2, User, Mail, Phone } from 'lucide-react'
import { createCheckout } from '../services/api'
import logo from '../assets/logo_hair.png'

const PLAN_PRICE = 'R$ 310,00/mês'

export default function CheckoutPage() {
  const [form, setForm] = useState({ name: '', email: '', phone: '' })
  const [method, setMethod] = useState('card')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      const res = await createCheckout({ ...form, method })
      if (res.url) window.location.href = res.url
      else throw new Error('Não foi possível iniciar o checkout.')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-white to-purple-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">

        <div className="text-center mb-4">
          <img src={logo} alt="Convert Hair" className="h-16 mx-auto object-contain" />
          <p className="text-gray-500 text-sm mt-2">Assine e comece a converter mais leads</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">

          {/* Plano */}
          <div className="bg-gradient-to-r from-pink-600 to-purple-600 rounded-xl p-4 mb-6 text-white text-center">
            <p className="text-sm opacity-90">Plano Convert Hair</p>
            <p className="text-2xl font-bold">{PLAN_PRICE}</p>
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
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">E-mail de acesso</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required
                  className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-pink-500" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">WhatsApp</label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} required
                  placeholder="ex: 27996972230"
                  className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-pink-500" />
              </div>
            </div>

            {/* Método de pagamento */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Forma de pagamento</label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setMethod('card')}
                  className={`flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-medium transition ${
                    method === 'card' ? 'border-pink-500 bg-pink-50 text-pink-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                  }`}>
                  <CreditCard className="w-4 h-4" /> Cartão
                </button>
                <button type="button" disabled title="Em breve"
                  className="flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-medium border-gray-200 text-gray-300 cursor-not-allowed">
                  <QrCode className="w-4 h-4" /> PIX <span className="text-[10px]">(em breve)</span>
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                {method === 'card' ? 'Cobrança recorrente automática todo mês.' : 'Você receberá um link de pagamento PIX.'}
              </p>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-3 rounded-xl">{error}</div>
            )}

            <button type="submit" disabled={loading}
              className="w-full bg-gradient-to-r from-pink-600 to-purple-600 hover:opacity-90 disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition text-sm flex items-center justify-center gap-2">
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Processando...</> : 'Assinar agora'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">Pagamento seguro via Stripe</p>
      </div>
    </div>
  )
}
