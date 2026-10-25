import { useState, useEffect } from 'react'
import { Link, useLocation, Outlet } from 'react-router-dom'
import { ChevronLeft, ChevronRight, ChevronDown, ShieldCheck, LayoutDashboard, Send, LogOut, Settings, Image, Calendar, Trash2, BarChart2, Bell, Users, Activity, BookOpen, Sparkles, FileText, Boxes, ClipboardList, ListChecks, Wallet, MessageSquare, Tag, MessageCircle } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { getInstanceConfig, getPriceConfig } from '../services/api'
import iconOnly from '../assets/convertHair_icon_only.png'

function NavLink({ item, collapsed, active, small }) {
  const Icon = item.icon
  return (
    <Link
      to={item.path}
      className={`flex items-center gap-3 px-3 ${small ? 'py-1.5' : 'py-2'} rounded transition ${
        active ? 'bg-teal-700 text-white' : 'text-gray-600 hover:bg-gray-100'
      }`}
      title={collapsed ? item.label : ''}
    >
      <Icon className={`${small ? 'w-4 h-4' : 'w-5 h-5'} flex-shrink-0`} />
      {!collapsed && <span className={`${small ? 'text-[13px]' : 'text-sm'} font-medium`}>{item.label}</span>}
    </Link>
  )
}

export default function Layout({ onLogout }) {
  const [collapsed, setCollapsed] = useState(false)
  const location = useLocation()
  const { user } = useAuth()
  const [promptEngine, setPromptEngine] = useState(null)

  // Cliente já rodando em módulos dinâmicos precisa ver o menu mesmo sem estar
  // na lista de e-mail beta abaixo (ela existe só pra dar acesso ANTES da
  // migração, pra montar módulos com antecedência) — sem isso o cliente não
  // acha onde editar o próprio prompt (ver memória bug Joelma/Charm's Cabelos).
  useEffect(() => {
    if (user?.role === 'admin') return
    getInstanceConfig().then(cfg => setPromptEngine(cfg?.promptEngine ?? null)).catch(() => {})
  }, [user?.role])
  // Tabela de preços só aparece pra quem vende por gramatura (já tem linha em
  // price_configs, ex: S&A) — pros outros o menu ficaria sem sentido.
  const [hasPriceConfig, setHasPriceConfig] = useState(false)
  useEffect(() => {
    getPriceConfig().then(cfg => setHasPriceConfig(!!cfg?.exists)).catch(() => {})
  }, [user?.id])
  const isLocalDev = import.meta.env.VITE_API_URL?.includes('localhost') || (typeof window !== 'undefined' && window.location.hostname === 'localhost')
  // Multi-agente em rollout controlado: visível em localhost e para contas beta.
  // Todos os outros clientes seguem no monólito (o backend também só ativa via
  // multiAgentEnabled por tenant, default false — aqui é só a aba do simulador).
  const MULTI_AGENT_BETA_EMAILS = ['bfagner@hotmail.com.br', 'claudia_teste@hotmail.com', 'alex_teste@hotmail.com', 'alexcosta171@yahoo.com', 'claudia_temp@hotmail.com', 'soraiadias2023@gmail.com']
  const canSeeMultiAgent = isLocalDev || MULTI_AGENT_BETA_EMAILS.includes(user?.email)
  // Protótipo "agente único + módulos dinâmicos" (2026-07) — tenant de teste do
  // Alex + conta oficial dele em migração (prompt_engine ainda 'legacy' até o
  // conteúdo ser testado e aprovado, ver memória project_alex_dynamic_modules_migration).
  // Soraia entra no mesmo estado (2026-08): vinda do multiagente, com acesso ao
  // construtor pra montar os módulos, mas prompt_engine segue 'legacy' — o
  // WhatsApp real dela continua no multiagente até o conteúdo ser aprovado.
  const DYNAMIC_MODULES_BETA_EMAILS = ['bfagner@hotmail.com.br', 'alex_teste@hotmail.com', 'alexcosta171@yahoo.com', 'soraiadias2023@gmail.com']
  const canSeeModulesTest = isLocalDev || DYNAMIC_MODULES_BETA_EMAILS.includes(user?.email) || promptEngine === 'dynamic_modules'

  // Menu em seções (Operação / Gestão / Sistema). "group" vira um item que expande —
  // Configurações e Administração guardam o que não se usa o dia todo.
  const isAdmin = user?.role === 'admin'
  const navSections = [
    {
      label: 'Operação',
      items: [
        { icon: LayoutDashboard, label: 'Kanban', path: '/' },
        { icon: MessageCircle, label: 'Inbox', path: '/inbox' },
        { icon: Calendar, label: 'Calendário', path: '/calendar' },
        { icon: Send, label: 'Envio em Massa', path: '/mass-message' },
        { icon: Image, label: 'Mídias', path: '/media' },
      ],
    },
    {
      label: 'Gestão',
      items: [
        { icon: BarChart2, label: 'Dashboard', path: '/dashboard' },
        // Tabela de preços só aparece pra quem vende por gramatura (já tem linha em
        // price_configs, ex: S&A) — pros outros o menu ficaria sem sentido.
        ...(hasPriceConfig || isAdmin ? [{ icon: Tag, label: 'Tabela de preços', path: '/prices' }] : []),
      ],
    },
    {
      label: 'Sistema',
      items: [
        {
          icon: Settings, label: 'Configurações', key: 'config',
          children: [
            { icon: Settings, label: 'Geral', path: '/settings' },
            { icon: Bell, label: 'Regras de Alertas', path: '/alert-rules' },
            { icon: Trash2, label: 'Leads Excluídos', path: '/deleted-leads' },
            // Multi-agente em rollout controlado — localhost + conta beta
            ...(canSeeMultiAgent ? [{ icon: Sparkles, label: 'Agentes', path: '/agents' }] : []),
            ...(canSeeModulesTest ? [{ icon: Boxes, label: 'Módulos (beta)', path: '/modules-test' }] : []),
          ],
        },
        // Painel admin — só para o admin da plataforma
        ...(isAdmin ? [{
          icon: ShieldCheck, label: 'Administração', key: 'admin',
          children: [
            { icon: Users, label: 'Clientes', path: '/admin' },
            { icon: FileText, label: 'Prompts', path: '/admin/prompts' },
            { icon: ClipboardList, label: 'Onboarding', path: '/admin/onboarding' },
            { icon: ListChecks, label: 'Status do projeto', path: '/admin/changelog' },
            { icon: Activity, label: 'Monitoramento', path: '/monitoring' },
            { icon: MessageSquare, label: 'Relatórios de Grupos', path: '/admin/group-reports' },
            { icon: Wallet, label: 'Financeiro WhatsApp', path: '/financeiro-whatsapp' },
          ],
        }] : []),
      ],
    },
  ]

  // Grupo abre sozinho quando a página atual está dentro dele; o clique do usuário vale depois disso.
  const [openGroups, setOpenGroups] = useState({})
  const groupIsOpen = (item) => openGroups[item.key] ?? item.children.some(c => location.pathname === c.path)
  const toggleGroup = (item) => setOpenGroups(prev => ({ ...prev, [item.key]: !groupIsOpen(item) }))

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
        <nav className="flex-1 p-3 space-y-2 overflow-y-auto">
          <Link
            to="/profile"
            className={`flex items-center gap-3 px-3 py-2 rounded transition min-w-0 ${
              isActive('/profile') ? 'bg-teal-700 text-white' : 'text-gray-600 hover:bg-gray-100'
            }`}
            title={user?.name || 'Meu perfil'}
          >
            <div className="w-8 h-8 rounded-full bg-pink-500 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
              {initials}
            </div>
            {!collapsed && <span className="text-sm font-medium truncate min-w-0">{user?.name || 'Meu perfil'}</span>}
          </Link>

          {navSections.filter(sec => sec.items.length > 0).map((section, idx) => (
            <div key={section.label} className={idx > 0 ? 'pt-2 border-t border-gray-100' : ''}>
              {!collapsed && (
                <div className="px-3 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">{section.label}</div>
              )}
              <div className="space-y-0.5">
                {section.items.map(item => {
                  if (!item.children) return <NavLink key={item.path} item={item} collapsed={collapsed} active={isActive(item.path)} />
                  const Icon = item.icon
                  // Recolhido: sem espaço pra expandir, então os filhos aparecem só como ícones.
                  if (collapsed) {
                    return item.children.map(child => <NavLink key={child.path} item={child} collapsed active={isActive(child.path)} />)
                  }
                  const open = groupIsOpen(item)
                  return (
                    <div key={item.key}>
                      <button
                        onClick={() => toggleGroup(item)}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded transition text-gray-600 hover:bg-gray-100"
                      >
                        <Icon className="w-5 h-5 flex-shrink-0" />
                        <span className="text-sm font-medium flex-1 text-left">{item.label}</span>
                        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
                      </button>
                      {open && (
                        <div className="ml-4 pl-2 border-l border-gray-100 space-y-0.5 mt-0.5">
                          {item.children.map(child => <NavLink key={child.path} item={child} collapsed={false} active={isActive(child.path)} small />)}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-gray-100 space-y-1">
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
