import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import LoginPage from './pages/LoginPage'
import KanbanPage from './pages/KanbanPage'
import BulkMessagePage from './pages/BulkMessagePage'
import SettingsPage from './pages/SettingsPage'
import MediaPage from './pages/MediaPage'
import CalendarPage from './pages/CalendarPage'
import DeletedLeadsPage from './pages/DeletedLeadsPage'
import DashboardPage from './pages/DashboardPage'
import AlertRulesPage from './pages/AlertRulesPage'
import AdminPage from './pages/AdminPage'
import MonitoringPage from './pages/MonitoringPage'
import TemplatesPage from './pages/TemplatesPage'
import AgentBuilderPage from './pages/AgentBuilderPage'
import ProfilePage from './pages/ProfilePage'
import CheckoutPage from './pages/CheckoutPage'
import CheckoutSuccessPage from './pages/CheckoutSuccessPage'
import Layout from './components/Layout'

function Routing() {
  const { isAuthenticated, loading, logout } = useAuth()

  // Enquanto valida o token salvo (refresh), evita piscar a tela de login.
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">Carregando...</p>
      </div>
    )
  }

  return (
    <Routes>
      {/* Rotas públicas (checkout) — fora do guard de autenticação */}
      <Route path="/checkout" element={<CheckoutPage />} />
      <Route path="/checkout/success" element={<CheckoutSuccessPage />} />
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />}
      />
      <Route
        element={isAuthenticated ? <Layout onLogout={logout} /> : <Navigate to="/login" replace />}
      >
        <Route path="/" element={<KanbanPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/deleted-leads" element={<DeletedLeadsPage />} />
        <Route path="/mass-message" element={<BulkMessagePage />} />
        <Route path="/media" element={<MediaPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/monitoring" element={<MonitoringPage />} />
        <Route path="/alert-rules" element={<AlertRulesPage />} />
        <Route path="/templates" element={<TemplatesPage />} />
        <Route path="/agents" element={<AgentBuilderPage />} />
        <Route path="/profile" element={<ProfilePage />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routing />
      </BrowserRouter>
    </AuthProvider>
  )
}
