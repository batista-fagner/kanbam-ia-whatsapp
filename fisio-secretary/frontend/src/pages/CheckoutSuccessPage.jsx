import { Link } from 'react-router-dom'
import { CheckCircle2, MessageCircle } from 'lucide-react'
import logo from '../assets/logo_hair.png'

export default function CheckoutSuccessPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-white to-purple-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md text-center">
        <img src={logo} alt="Convert Hair" className="h-16 mx-auto object-contain mb-6" />
        <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
            <CheckCircle2 className="w-9 h-9 text-green-600" />
          </div>
          <h1 className="text-xl font-bold text-gray-800 mb-2">Pagamento confirmado! 🎉</h1>
          <p className="text-sm text-gray-500 mb-6">
            Sua conta está sendo criada. Em instantes você recebe o e-mail e a senha de acesso no seu WhatsApp.
          </p>
          <div className="flex items-center justify-center gap-2 text-sm text-green-700 bg-green-50 rounded-xl py-3 mb-6">
            <MessageCircle className="w-4 h-4" /> Verifique seu WhatsApp
          </div>
          <Link to="/login" className="text-sm font-medium text-pink-600 hover:text-pink-700">Ir para o login →</Link>
        </div>
      </div>
    </div>
  )
}
