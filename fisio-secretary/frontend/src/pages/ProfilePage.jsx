import { useState } from 'react'
import { Lock, Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { authFetch } from '../services/api'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

function getInitials(nameOrEmail) {
  const base = (nameOrEmail || '?').trim()
  const parts = base.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return base.slice(0, 2).toUpperCase()
}

function ChangePasswordCard() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPasswords, setShowPasswords] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSuccess(false)

    if (!currentPassword) {
      setError('Informe sua senha atual.')
      return
    }
    if (newPassword.length < 5) {
      setError('A nova senha deve ter pelo menos 5 caracteres.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('A confirmação não confere com a nova senha.')
      return
    }

    setSaving(true)
    try {
      const res = await authFetch(`${API_URL}/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message || 'Não foi possível trocar a senha.')

      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 mt-4">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-teal-100">
          <Lock className="w-4 h-4 text-teal-600" />
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-800">Trocar minha senha</p>
          <p className="text-xs text-gray-500 mt-0.5">Altere a senha da sua conta. Você vai precisar informar a senha atual.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3 max-w-sm">
        <div>
          <label className="text-xs text-gray-500 block mb-1">Senha atual</label>
          <input
            type={showPasswords ? 'text' : 'password'}
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500"
            autoComplete="current-password"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Nova senha</label>
          <input
            type={showPasswords ? 'text' : 'password'}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500"
            autoComplete="new-password"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Confirmar nova senha</label>
          <input
            type={showPasswords ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500"
            autoComplete="new-password"
          />
        </div>

        <button
          type="button"
          onClick={() => setShowPasswords((v) => !v)}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
        >
          {showPasswords ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          {showPasswords ? 'Ocultar senhas' : 'Mostrar senhas'}
        </button>

        {error && <p className="text-xs text-red-600">{error}</p>}
        {success && <p className="text-xs text-teal-600">Senha alterada com sucesso!</p>}

        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50 transition"
        >
          {saving ? 'Salvando...' : 'Salvar nova senha'}
        </button>
      </form>
    </div>
  )
}

export default function ProfilePage() {
  const { user } = useAuth()
  const initials = getInitials(user?.name || user?.email)

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold text-gray-800 mb-6">Meu Perfil</h1>

      <div className="bg-white rounded-xl border border-gray-200 p-6 flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-pink-500 text-white flex items-center justify-center text-lg font-bold flex-shrink-0">
          {initials}
        </div>
        <div>
          <p className="text-base font-semibold text-gray-800">{user?.name || 'Usuário'}</p>
          <p className="text-sm text-gray-500">{user?.email}</p>
        </div>
      </div>

      <ChangePasswordCard />
    </div>
  )
}
