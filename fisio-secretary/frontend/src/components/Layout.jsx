import { useState } from 'react'
import { Link, useLocation, Outlet } from 'react-router-dom'
import { ChevronLeft, ChevronRight, LayoutDashboard, Send, LogOut, Settings, Image, Calendar, Trash2, BarChart2, Bell, Users, Activity, BookOpen, Sparkles } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import iconOnly from '../assets/convertHair_icon_only.png'

export default function Layout({ onLogout }) {
  const [collapsed, setCollapsed] = useState(false)
  const location = useLocation()
  const { user } = useAuth()
  const isLocalDev = import.meta.env.VITE_API_URL?.includes('localhost') || (typeof window !== 'undefined' && window.location.hostname === 'localhost')
  // Multi-agente em rollout controlado: visível em localhost e para contas beta.
  // Todos os outros clientes seguem no monólito (o backend também só ativa via
  // multiAgentEnabled por tenant, default false — aqui é só a aba do simulador).
  const MULTI_AGENT_BETA_EMAILS = ['bfagner@hotmail.com.br', 'claudia_teste@hotmail.com', 'alex_teste@hotmail.com']
  const canSeeMultiAgent = isLocalDev || MULTI_AGENT_BETA_EMAILS.includes(user?.email)

  const navItems = [
    { icon: LayoutDashboard, label: 'Kanban', path: '/' },
    { icon: BarChart2, label: 'Dashboard', path: '/dashboard' },
    { icon: Calendar, label: 'Calendário', path: '/calendar' },
    { icon: Send, label: 'Envio em Massa', path: '/mass-message' },
    { icon: Image, label: 'Mídias', path: '/media' },
    { icon: Trash2, label: 'Leads Excluídos', path: '/deleted-leads' },
    { icon: Settings, label: 'Configurações', path: '/settings' },
    // Multi-agente em rollout controlado — localhost + conta beta
    ...(canSeeMultiAgent ? [{ icon: Sparkles, label: 'Agentes', path: '/agents' }] : []),
    // { icon: BookOpen, label: 'Templates', path: '/templates' }, // TODO: ativar depois
    // Painel admin — só para o admin da plataforma
    ...(user?.role === 'admin' ? [
      { icon: Users, label: 'Clientes', path: '/admin' },
      { icon: Activity, label: 'Monitoramento', path: '/monitoring' },
    ] : []),
  ]

  const isActive = (path) => location.pathname === path

  const initials = (() => {
    const base = (user?.name || user?.email || '?').trim()
    const parts = base.split(/\s+/).filter(Boolean)
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
    return base.slice(0, 2).toUpperCase()
  })()

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className={`${
        collapsed ? 'w-16' : 'w-56'
      } bg-white border-r border-gray-100 flex flex-col transition-all duration-200 sticky top-0 h-screen z-40`}>

        {/* Header do Sidebar */}
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          {!collapsed && (
            <div className="flex items-center gap-2">
              <img src={iconOnly} alt="Convert Hair" className="w-6 h-6 object-contain" />
              <span className="text-xs font-bold text-gray-800">Convert Hair</span>
            </div>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1 hover:bg-gray-100 rounded transition text-gray-400"
            title={collapsed ? 'Expandir' : 'Recolher'}
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-2">
          <Link
            to="/profile"
            className={`flex items-center gap-3 px-3 py-2 rounded transition ${
              isActive('/profile') ? 'bg-teal-700 text-white' : 'text-gray-600 hover:bg-gray-100'
            }`}
            title={collapsed ? (user?.name || 'Meu perfil') : ''}
          >
            <div className="w-8 h-8 rounded-full bg-pink-500 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
              {initials}
            </div>
            {!collapsed && <span className="text-sm font-medium">{user?.name || 'Meu perfil'}</span>}
          </Link>

          {navItems.map(item => {
            const Icon = item.icon
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-3 py-2 rounded transition ${
                  isActive(item.path)
                    ? 'bg-teal-700 text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
                title={collapsed ? item.label : ''}
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                {!collapsed && <span className="text-sm font-medium">{item.label}</span>}
              </Link>
            )
          })}
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-gray-100 space-y-1">
          <Link
            to="/alert-rules"
            className={`flex items-center gap-3 px-3 py-2 rounded transition ${
              location.pathname === '/alert-rules'
                ? 'bg-teal-700 text-white'
                : 'text-gray-500 hover:bg-gray-100'
            }`}
            title={collapsed ? 'Regras de Alertas' : ''}
          >
            <Bell className="w-5 h-5 flex-shrink-0" />
            {!collapsed && <span className="text-sm font-medium">Regras de Alertas</span>}
          </Link>
          <button
            onClick={onLogout}
            className="w-full flex items-center gap-3 px-3 py-2 text-red-600 hover:bg-red-50 rounded transition text-sm font-medium"
            title={collapsed ? 'Sair' : ''}
          >
            <LogOut className="w-5 h-5 flex-shrink-0" />
            {!collapsed && <span>Sair</span>}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto flex flex-col">
        {(import.meta.env.VITE_API_URL?.includes('localhost') || typeof window !== 'undefined' && window.location.hostname === 'localhost') && (
          <div className="bg-red-600 text-white px-4 py-3 text-center font-bold text-sm z-50 border-b-2 border-red-700">
            🔴 AMBIENTE LOCAL - Banco e dados isolados da produção
          </div>
        )}
        <div className="flex-1">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
