import { useState } from 'react'
import { Lock, Mail, Eye, EyeOff, Bot } from 'lucide-react'
import logo from '../assets/logo_hair.png'
import { useAuth } from '../context/AuthContext'

export default function LoginPage() {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(email, password)
      // AuthContext atualiza o estado; App.jsx redireciona para as rotas protegidas.
    } catch (err) {
      setError(err.message || 'E-mail ou senha incorretos.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex bg-gradient-to-br from-pink-50 via-white to-pink-50">

      {/* Painel esquerdo — branding + robô (escondido no mobile) */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-gradient-to-br from-pink-600 via-rose-600 to-pink-800">
        {/* Brilho decorativo */}
        <div className="absolute -top-24 -left-24 w-96 h-96 bg-pink-400/30 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-0 w-96 h-96 bg-rose-900/40 rounded-full blur-3xl" />

        <div className="relative z-10 flex flex-col justify-between p-12 w-full">
          {/* Logo */}
          <img src={logo} alt="Convert Hair" className="h-12 object-contain self-start brightness-0 invert" />

          {/* Placeholder do mascote — trocar por <img> quando a arte final estiver pronta */}
          <div className="flex-1 flex items-center justify-center">
            <div className="w-64 h-64 rounded-full border-2 border-white/40 flex items-center justify-center shadow-[0_0_80px_rgba(255,255,255,0.25)]">
              <div className="w-40 h-40 rounded-full bg-white/10 flex items-center justify-center">
                <Bot className="w-20 h-20 text-white/90" strokeWidth={1.5} />
              </div>
            </div>
          </div>

          {/* Tagline */}
          <div>
            <div className="w-12 h-1 bg-white/80 rounded-full mb-4" />
            <p className="text-white/90 text-lg leading-relaxed max-w-sm">
              Gerencie leads, automatize atendimentos e cresça seu negócio com inteligência.
            </p>
          </div>
        </div>
      </div>

      {/* Painel direito — formulário */}
      <div className="flex-1 flex items-center justify-center p-4 lg:p-8">
        <div className="w-full max-w-md">

          {/* Logo no mobile (painel esquerdo fica escondido) */}
          <div className="text-center mb-6 lg:hidden">
            <img src={logo} alt="Convert Hair" className="h-14 mx-auto object-contain" />
            <p className="text-gray-500 text-sm mt-1">Plataforma de gestão de leads</p>
          </div>

          {/* Card */}
          <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
            <h2 className="text-xl font-semibold text-gray-800 mb-1">Entrar na plataforma</h2>
            <p className="text-gray-500 text-sm mb-6">Painel de gestão de leads</p>

            <form onSubmit={handleSubmit} className="space-y-4">

              {/* Email */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="seu@email.com"
                    required
                    autoComplete="email"
                    className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition"
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Senha</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type={showPass ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    autoComplete="current-password"
                    className="w-full pl-10 pr-10 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-3 rounded-xl">
                  {error}
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-700 hover:to-rose-700 disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition text-sm"
              >
                {loading ? 'Entrando...' : 'Entrar'}
              </button>
            </form>

            <div className="mt-6 pt-4 border-t border-gray-100 flex items-center justify-center gap-1.5 text-gray-400">
              <Lock className="w-3.5 h-3.5" />
              <span className="text-xs">Seus dados estão seguros conosco.</span>
            </div>
          </div>

          <p className="text-center text-xs text-gray-400 mt-6">
            © 2026 Convert Hair. Todos os direitos reservados.
          </p>
        </div>
      </div>
    </div>
  )
}
