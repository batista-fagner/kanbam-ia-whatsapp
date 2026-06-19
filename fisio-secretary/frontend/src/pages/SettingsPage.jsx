import { useState, useEffect, useRef } from 'react'
import { Wifi, WifiOff, Loader2, Smartphone, RotateCcw, AlertCircle, X, RefreshCw, Trash2, Radio, Plus, Image as ImageIcon, Play, ChevronDown, Wand2, CheckCircle2, Search, ChevronUp } from 'lucide-react'
import { authFetch, getMediaList } from '../services/api'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

function StatusBadge({ status }) {
  if (status === 'connected') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
        Conectado
      </span>
    )
  }
  if (status === 'connecting') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">
        <Loader2 className="w-3 h-3 animate-spin" />
        Conectando...
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
      <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
      Desconectado
    </span>
  )
}

export default function SettingsPage() {
  const [bootstrapping, setBootstrapping] = useState(true)
  const [instanceConfig, setInstanceConfig] = useState(null) // null = não tem; objeto = tem
  const [instanceStatus, setInstanceStatus] = useState(null)
  const [connectMode, setConnectMode] = useState('qrcode')
  const [phoneInput, setPhoneInput] = useState('')
  const [qrCode, setQrCode] = useState(null)
  const [pairCode, setPairCode] = useState(null)
  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [showConfirmDisconnect, setShowConfirmDisconnect] = useState(false)
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [settingUpWebhook, setSettingUpWebhook] = useState(false)
  const [webhookConfigured, setWebhookConfigured] = useState(false)
  const [error, setError] = useState(null)
  const [instanceName, setInstanceName] = useState('')
  const [creatingInstance, setCreatingInstance] = useState(false)
  const [customPromptMegaHair, setCustomPromptMegaHair] = useState('')
  const [savingPrompt, setSavingPrompt] = useState(false)
  const [mediaList, setMediaList] = useState([])
  const [promptSaved, setPromptSaved] = useState(false)
  const [blocks, setBlocks] = useState({ identidade: '', regras: '' })
  const [builderOpen, setBuilderOpen] = useState(false)
  const [appliedNotice, setAppliedNotice] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [searchIndex, setSearchIndex] = useState(0)
  const pollingRef = useRef(null)
  const promptRef = useRef(null)

  const fetchStatus = async () => {
    try {
      const res = await authFetch(`${API_URL}/instance/status`)
      const data = await res.json()
      const status = data?.instance?.status ?? 'disconnected'
      setInstanceStatus(data)
      return { status, data }
    } catch {
      setInstanceStatus(null)
      return { status: 'disconnected', data: null }
    }
  }

  const fetchConfig = async () => {
    try {
      const res = await authFetch(`${API_URL}/instance/config`)
      const data = await res.json()
      setInstanceConfig(data)
      setWebhookConfigured(data?.webhookConfigured ?? false)
      setCustomPromptMegaHair(data?.customPromptMegaHair ?? '')
      return data
    } catch {
      setInstanceConfig(null)
      return null
    }
  }


  const startPolling = () => {
    if (pollingRef.current) return
    pollingRef.current = setInterval(async () => {
      const { status, data } = await fetchStatus()
      if (status === 'connected') {
        stopPolling()
        setConnecting(false)
        setQrCode(null)
        setPairCode(null)
        await setupWebhook()
      } else if (status === 'disconnected') {
        stopPolling()
        setConnecting(false)
        setQrCode(null)
        setPairCode(null)
      } else if (status === 'connecting') {
        if (data?.instance?.qrcode) setQrCode(data.instance.qrcode)
      }
    }, 3000)
  }

  const stopPolling = () => {
    clearInterval(pollingRef.current)
    pollingRef.current = null
  }

  const setupWebhook = async () => {
    setSettingUpWebhook(true)
    try {
      const res = await authFetch(`${API_URL}/instance/setup-webhook`, { method: 'POST' })
      const data = await res.json()
      setWebhookConfigured(data?.webhookConfigured ?? false)
      setInstanceConfig(data)
    } catch {
      setWebhookConfigured(false)
    } finally {
      setSettingUpWebhook(false)
    }
  }


  useEffect(() => {
    const init = async () => {
      const config = await fetchConfig()
      if (!config) {
        setBootstrapping(false)
        return
      }
      const { status, data } = await fetchStatus()
      if (status === 'connecting') {
        setConnecting(true)
        if (data?.instance?.qrcode) setQrCode(data.instance.qrcode)
        if (data?.instance?.paircode) setPairCode(data.instance.paircode)
        startPolling()
      } else {
        setConnecting(false)
      }
      setBootstrapping(false)
    }
    init()
    getMediaList().then(setMediaList).catch(() => setMediaList([]))
    return () => stopPolling()
  }, [])

  // Busca e seleciona ocorrência no textarea do prompt.
  const searchOccurrences = (term, text) => {
    if (!term) return []
    const lower = text.toLowerCase()
    const key = term.toLowerCase()
    const positions = []
    let pos = 0
    while ((pos = lower.indexOf(key, pos)) !== -1) {
      positions.push(pos)
      pos += key.length
    }
    return positions
  }

  const navigateSearch = (dir) => {
    const positions = searchOccurrences(searchTerm, customPromptMegaHair)
    if (positions.length === 0) return
    const next = (searchIndex + dir + positions.length) % positions.length
    setSearchIndex(next)
    const el = promptRef.current
    if (!el) return
    const start = positions[next]
    const end = start + searchTerm.length
    el.focus()
    el.setSelectionRange(start, end)
    // Scroll para a seleção
    const lineHeight = 16
    const lines = customPromptMegaHair.slice(0, start).split('\n').length
    el.scrollTop = (lines - 3) * lineHeight
  }

  // Insere snippet completo de envio de mídia na posição do cursor do textarea do prompt.
  const insertMediaName = (name) => {
    const el = promptRef.current
    const snippet = `envie usando action=send_media com mediaName="${name}"`
    if (!el) {
      setCustomPromptMegaHair(prev => `${prev}${snippet}`)
      return
    }
    const start = el.selectionStart ?? customPromptMegaHair.length
    const end = el.selectionEnd ?? customPromptMegaHair.length
    const next = customPromptMegaHair.slice(0, start) + snippet + customPromptMegaHair.slice(end)
    setCustomPromptMegaHair(next)
    // Reposiciona o cursor logo após o trecho inserido.
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + snippet.length
      el.setSelectionRange(pos, pos)
    })
  }

  const handleCreateInstance = async () => {
    setError(null)
    setCreatingInstance(true)
    try {
      // Cria a instância uazapi para o TENANT logado (não admin-only).
      const res = await authFetch(`${API_URL}/instance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: instanceName.trim() }),
      })
      const data = await res.json()
      if (data?.error) {
        setError(data.error)
        return
      }
      setInstanceConfig(data)
      setWebhookConfigured(data?.webhookConfigured ?? false)
      setInstanceName('')
      await fetchStatus()
    } catch {
      setError('Não foi possível criar a conexão. Verifique sua internet e tente novamente.')
    } finally {
      setCreatingInstance(false)
    }
  }

  const handleConnect = async () => {
    setError(null)
    setConnecting(true)
    setQrCode(null)
    setPairCode(null)

    try {
      const body = connectMode === 'paircode' ? { phone: phoneInput.replace(/\D/g, '') } : {}
      const res = await authFetch(`${API_URL}/instance/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()

      if (data?.instance?.qrcode) setQrCode(data.instance.qrcode)
      if (data?.instance?.paircode) setPairCode(data.instance.paircode)

      await fetchStatus()
      startPolling()
    } catch {
      setError('Não foi possível iniciar a conexão. Verifique sua internet e tente novamente.')
      setConnecting(false)
    }
  }

  const handleDisconnect = async () => {
    setShowConfirmDisconnect(false)
    setDisconnecting(true)
    setError(null)
    stopPolling()
    setConnecting(false)
    setQrCode(null)
    setPairCode(null)
    setWebhookConfigured(false)
    try {
      await authFetch(`${API_URL}/instance/disconnect`, { method: 'POST' })
      await fetchStatus()
    } catch {
      setError('Não foi possível desconectar. Verifique sua internet e tente novamente.')
    } finally {
      setDisconnecting(false)
    }
  }

  const handleReset = async () => {
    setResetting(true)
    setError(null)
    try {
      await authFetch(`${API_URL}/instance/reset`, { method: 'POST' })
      const { status, data } = await fetchStatus()
      if (status === 'connecting') {
        if (data?.instance?.qrcode) setQrCode(data.instance.qrcode)
        startPolling()
      }
    } catch {
      setError('Não foi possível reiniciar. Verifique sua internet e tente novamente.')
    } finally {
      setResetting(false)
    }
  }

  const handleDelete = async () => {
    setShowConfirmDelete(false)
    setDeleting(true)
    setError(null)
    stopPolling()
    try {
      await authFetch(`${API_URL}/instance`, { method: 'DELETE' })
      setInstanceStatus(null)
      // Recarrega config pois o backend MANTÉM o registro (prompts preservados),
      // apenas zera os campos da instância WhatsApp.
      await fetchConfig()
      setQrCode(null)
      setPairCode(null)
      setConnecting(false)
      setWebhookConfigured(false)
    } catch {
      setError('Não foi possível remover a conexão. Verifique sua internet e tente novamente.')
    } finally {
      setDeleting(false)
    }
  }

  const currentStatus = instanceStatus?.instance?.status ?? 'disconnected'
  const profileName = instanceStatus?.instance?.profileName ?? instanceConfig?.profileName
  const profilePicUrl = instanceStatus?.instance?.profilePicUrl ?? instanceConfig?.profilePicUrl
  const phone = instanceStatus?.status?.jid?.replace('@s.whatsapp.net', '').replace(/:\d+$/, '') ?? instanceConfig?.phone

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-xl font-bold text-gray-800 mb-6">Configurações</h1>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
              <Smartphone className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-800">WhatsApp</h2>
              <p className="text-xs text-gray-500">
                {instanceConfig?.profileName ? `Conexão: ${instanceConfig.profileName}` : 'Conexão via uazapi'}
              </p>
            </div>
          </div>
          {instanceConfig?.instanceToken && <StatusBadge status={currentStatus} />}
        </div>

        {/* Carregando estado inicial */}
        {bootstrapping && (
          <div className="flex items-center justify-center gap-2 py-8">
            <Loader2 className="w-5 h-5 animate-spin text-teal-600" />
            <span className="text-sm text-gray-500">Carregando...</span>
          </div>
        )}

        {/* Sem instância criada — formulário de criação */}
        {!bootstrapping && !instanceConfig?.instanceToken && (
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-800 font-medium mb-1">Nenhuma conexão configurada</p>
              <p className="text-xs text-blue-600">Crie uma nova conexão WhatsApp para começar. Você poderá conectar seu número logo em seguida.</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Nome da conexão</label>
              <input
                type="text"
                placeholder="Ex: Clínica Dr. Silva"
                value={instanceName}
                onChange={e => setInstanceName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
              <p className="text-xs text-gray-400 mt-1">Apenas para identificação interna.</p>
            </div>

            <button
              onClick={handleCreateInstance}
              disabled={creatingInstance || !instanceName.trim()}
              className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-white bg-teal-700 rounded-lg hover:bg-teal-800 transition disabled:opacity-50"
            >
              {creatingInstance ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Criar conexão
            </button>
          </div>
        )}

        {/* Tem instância e está conectado */}
        {!bootstrapping && instanceConfig?.instanceToken && currentStatus === 'connected' && (
          <div className="space-y-4">
            <div className="bg-green-50 rounded-lg p-4 flex items-center gap-4">
              {profilePicUrl ? (
                <img
                  src={profilePicUrl}
                  alt="Foto de perfil"
                  className="w-12 h-12 rounded-full object-cover border-2 border-green-200 flex-shrink-0"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-green-200 flex items-center justify-center flex-shrink-0">
                  <Wifi className="w-5 h-5 text-green-600" />
                </div>
              )}
              <div>
                {profileName && <p className="text-sm font-medium text-gray-800">{profileName}</p>}
                {phone && <p className="text-xs text-gray-500">{phone}</p>}
                <div className="flex items-center gap-1.5 mt-1">
                  {settingUpWebhook ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin text-yellow-500" />
                      <span className="text-xs text-yellow-600">Configurando...</span>
                    </>
                  ) : webhookConfigured ? (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                      <span className="text-xs text-green-600">Conectado e configurado</span>
                    </>
                  ) : (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
                      <span className="text-xs text-yellow-600">Conectado — webhook pendente</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={handleReset}
                disabled={resetting}
                className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition disabled:opacity-50"
                title="Reinicia a conexão sem perder a sessão"
              >
                {resetting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Reiniciar
              </button>
              <button
                onClick={setupWebhook}
                disabled={settingUpWebhook}
                className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition disabled:opacity-50"
                title="Reconfigura o webhook na uazapi com a URL atual do servidor"
              >
                {settingUpWebhook ? <Loader2 className="w-4 h-4 animate-spin" /> : <Radio className="w-4 h-4" />}
                Reconfigurar Webhook
              </button>
              <button
                onClick={() => setShowConfirmDisconnect(true)}
                disabled={disconnecting}
                className="flex items-center gap-2 px-4 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition disabled:opacity-50"
              >
                {disconnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <WifiOff className="w-4 h-4" />}
                Desconectar
              </button>
            </div>

            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">Zona de perigo</p>
              <button
                onClick={() => setShowConfirmDelete(true)}
                disabled={deleting}
                className="flex items-center gap-2 px-4 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition disabled:opacity-50"
              >
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Remover conexão
              </button>
              <p className="text-xs text-gray-400 mt-2">Remove permanentemente esta conexão. Será necessário criar uma nova do zero.</p>
            </div>
          </div>
        )}

        {/* Tem instância mas está desconectado — formulário para conectar */}
        {!bootstrapping && instanceConfig?.instanceToken && currentStatus === 'disconnected' && !connecting && (
          <div className="space-y-4">
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
              <p className="text-xs text-gray-600">Conexão <span className="font-medium">{instanceConfig.profileName}</span> pronta. Escolha como quer conectar:</p>
            </div>

            <div className="flex gap-1 p-1 bg-gray-100 rounded-lg">
              <button
                onClick={() => setConnectMode('qrcode')}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition ${
                  connectMode === 'qrcode'
                    ? 'bg-white text-gray-800 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                QR Code
              </button>
              <button
                onClick={() => setConnectMode('paircode')}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition ${
                  connectMode === 'paircode'
                    ? 'bg-white text-gray-800 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Código de Pareamento
              </button>
            </div>

            {connectMode === 'paircode' && (
              <input
                type="text"
                placeholder="Número (ex: 5571999999999)"
                value={phoneInput}
                onChange={e => setPhoneInput(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            )}

            <button
              onClick={handleConnect}
              disabled={connectMode === 'paircode' && !phoneInput.trim()}
              className="w-full py-2.5 text-sm font-medium text-white bg-teal-700 rounded-lg hover:bg-teal-800 transition disabled:opacity-50"
            >
              Conectar WhatsApp
            </button>

            <div className="pt-3 border-t border-gray-100">
              <button
                onClick={() => setShowConfirmDelete(true)}
                className="text-xs text-gray-400 hover:text-red-600 transition flex items-center gap-1"
              >
                <Trash2 className="w-3 h-3" />
                Remover esta conexão
              </button>
            </div>
          </div>
        )}

        {/* Conectando — exibe QR ou paircode */}
        {!bootstrapping && instanceConfig?.instanceToken && (connecting || currentStatus === 'connecting') && (
          <div className="space-y-4">
            {qrCode && (
              <div className="flex flex-col items-center gap-3">
                <p className="text-sm text-gray-600">Escaneie o QR code com seu WhatsApp</p>
                <img src={qrCode} alt="QR Code" className="w-56 h-56 rounded-lg border border-gray-200" />
                <p className="text-xs text-gray-400">Expira em 2 minutos</p>
              </div>
            )}

            {pairCode && (
              <div className="flex flex-col items-center gap-3">
                <p className="text-sm text-gray-600">Digite este código no seu WhatsApp</p>
                <div className="px-8 py-4 bg-gray-50 rounded-xl border border-gray-200">
                  <span className="text-3xl font-mono font-bold tracking-widest text-gray-800">
                    {pairCode}
                  </span>
                </div>
                <p className="text-xs text-gray-400">WhatsApp → Aparelhos Conectados → Conectar com número de telefone</p>
                <p className="text-xs text-gray-400">Expira em 5 minutos</p>
              </div>
            )}

            {!qrCode && !pairCode && (
              <div className="flex items-center justify-center gap-2 py-6">
                <Loader2 className="w-5 h-5 animate-spin text-teal-600" />
                <span className="text-sm text-gray-500">Iniciando conexão...</span>
              </div>
            )}

            <div className="flex items-center justify-center gap-2 text-xs text-gray-400">
              <Loader2 className="w-3 h-3 animate-spin" />
              Aguardando confirmação...
            </div>

            <button
              onClick={async () => {
                stopPolling()
                setConnecting(false)
                setQrCode(null)
                setPairCode(null)
                try {
                  await authFetch(`${API_URL}/instance/disconnect`, { method: 'POST' })
                  await fetchStatus()
                } catch { /* ignora erro silencioso ao cancelar */ }
              }}
              className="flex items-center gap-2 mx-auto text-xs text-gray-400 hover:text-gray-600 transition"
            >
              <RotateCcw className="w-3 h-3" />
              Cancelar
            </button>
          </div>
        )}

        {error && (
          <div className="mt-4 flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-red-700 flex-1">{error}</p>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 transition">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Botão para abrir o Drawer */}
      {!bootstrapping && instanceConfig && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setBuilderOpen(true)}
            className="flex items-center gap-2.5 px-5 py-3 bg-gradient-to-r from-teal-600 to-teal-700 hover:from-teal-700 hover:to-teal-800 text-white rounded-xl shadow-sm transition text-sm font-semibold"
          >
            <Wand2 className="w-4 h-4" />
            Construtor de Prompt
          </button>

          {/* Notificação de aplicado */}
          {appliedNotice && (
            <div className="mt-3 flex items-center gap-2 px-4 py-3 bg-green-50 border border-green-200 rounded-xl text-green-700 text-sm font-medium">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              Prompt aplicado com sucesso! Revise abaixo e clique em "Salvar prompt".
            </div>
          )}
        </div>
      )}

      {/* Drawer — Construtor de Prompt */}
      {builderOpen && (
        <>
          {/* Overlay */}
          <div
            className="fixed inset-0 bg-black/30 z-40"
            onClick={() => setBuilderOpen(false)}
          />

          {/* Painel lateral */}
          <div className="fixed top-0 right-0 h-full w-1/2 bg-white z-50 shadow-2xl flex flex-col">

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-teal-600 to-teal-700">
              <div className="flex items-center gap-2.5">
                <Wand2 className="w-4 h-4 text-white" />
                <span className="text-sm font-semibold text-white">Construtor de Prompt</span>
              </div>
              <button onClick={() => setBuilderOpen(false)} className="text-white/70 hover:text-white transition">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Conteúdo com scroll */}
            <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">

              {/* Bloco: Identidade */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">🎭 Identidade</label>
                <p className="text-xs text-gray-400 mb-2">Descreva quem é a IA, sua personalidade e contexto do negócio.</p>
                <textarea
                  value={blocks.identidade}
                  onChange={e => setBlocks(b => ({ ...b, identidade: e.target.value }))}
                  rows={6}
                  placeholder="Ex: Você é a Lindona, vendedora afetiva da Cabelô em Salvador/BA. Seu tom é descontraído e carinhoso..."
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-teal-500 text-gray-700 leading-relaxed"
                  spellCheck={false}
                />
              </div>

              {/* Bloco: Regras */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">📋 Regras</label>
                <p className="text-xs text-gray-400 mb-2">O que a IA deve ou não deve fazer.</p>
                <textarea
                  value={blocks.regras}
                  onChange={e => setBlocks(b => ({ ...b, regras: e.target.value }))}
                  rows={6}
                  placeholder="Ex: Nunca fale de concorrentes. Não faça promessas de resultado. Atenda apenas no horário comercial..."
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-teal-500 text-gray-700 leading-relaxed"
                  spellCheck={false}
                />
              </div>
            </div>

            {/* Footer fixo */}
            <div className="px-6 py-4 border-t border-gray-100 flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  const partes = []
                  if (blocks.identidade.trim()) partes.push(`## Identidade\n${blocks.identidade.trim()}`)
                  if (blocks.regras.trim()) partes.push(`## Regras\n${blocks.regras.trim()}`)
                  if (partes.length === 0) return
                  setCustomPromptMegaHair(partes.join('\n\n'))
                  setBuilderOpen(false)
                  setAppliedNotice(true)
                  setTimeout(() => setAppliedNotice(false), 3000)
                }}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-teal-700 rounded-xl hover:bg-teal-800 transition"
              >
                <CheckCircle2 className="w-4 h-4" />
                Aplicar no prompt oficial
              </button>
              <button
                type="button"
                onClick={() => setBuilderOpen(false)}
                className="px-4 py-2.5 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-xl hover:bg-gray-50 transition"
              >
                Cancelar
              </button>
            </div>
          </div>
        </>
      )}

      {/* Card de prompt customizado */}
      {!bootstrapping && instanceConfig && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mt-4">
          <h2 className="text-sm font-semibold text-gray-800 mb-1">Prompt da Lindona (Mega Hair)</h2>
          <p className="text-xs text-gray-500 mb-4">Personalize o comportamento da Lindona (personalidade, fluxo, regras). Datas, mídias disponíveis e formato técnico de resposta são adicionados automaticamente pelo sistema.</p>

          <div className="flex gap-4">
            {/* Coluna esquerda: editor do prompt */}
            <div className="flex-1 min-w-0">
              {/* Barra de busca */}
              <div className="flex items-center gap-2 mb-2">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={e => { setSearchTerm(e.target.value); setSearchIndex(0) }}
                    onKeyDown={e => { if (e.key === 'Enter') navigateSearch(e.shiftKey ? -1 : 1) }}
                    placeholder="Buscar no prompt..."
                    className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white text-gray-800 placeholder-gray-400"
                  />
                </div>
                {searchTerm && (() => {
                  const total = searchOccurrences(searchTerm, customPromptMegaHair).length
                  return (
                    <>
                      <span className="text-xs text-gray-600 font-medium whitespace-nowrap">
                        {total === 0 ? 'Não encontrado' : `${searchIndex + 1}/${total}`}
                      </span>
                      <button onClick={() => navigateSearch(-1)} disabled={total === 0} className="p-1 rounded hover:bg-teal-50 disabled:opacity-30 transition">
                        <ChevronUp className="w-3.5 h-3.5 text-teal-600" />
                      </button>
                      <button onClick={() => navigateSearch(1)} disabled={total === 0} className="p-1 rounded hover:bg-teal-50 disabled:opacity-30 transition">
                        <ChevronDown className="w-3.5 h-3.5 text-teal-600" />
                      </button>
                      <button onClick={() => setSearchTerm('')} className="p-1 rounded hover:bg-gray-100 transition">
                        <X className="w-3.5 h-3.5 text-gray-500" />
                      </button>
                    </>
                  )
                })()}
              </div>
              <textarea
                ref={promptRef}
                value={customPromptMegaHair}
                onChange={e => setCustomPromptMegaHair(e.target.value)}
                className="w-full h-80 text-xs font-mono border border-gray-200 rounded-lg p-3 resize-none focus:outline-none focus:ring-2 focus:ring-teal-500 text-gray-700 leading-relaxed"
                placeholder="Digite o prompt da IA aqui..."
                spellCheck={false}
              />
            </div>

            {/* Coluna direita: mídias disponíveis (clique para inserir o nome no prompt) */}
            <div className="w-56 flex-shrink-0">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-gray-600">Suas mídias</p>
                <span className="text-[10px] text-gray-400">clique p/ inserir</span>
              </div>
              <div className="h-80 overflow-y-auto border border-gray-200 rounded-lg p-2 space-y-1 bg-gray-50">
                {mediaList.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-6 px-2">
                    Nenhuma mídia cadastrada. Faça upload na página Mídias.
                  </p>
                ) : (
                  mediaList.map(media => (
                    <button
                      key={media.id}
                      type="button"
                      onClick={() => insertMediaName(media.name)}
                      title={`Inserir "${media.name}" no prompt`}
                      className="w-full flex items-center gap-2 p-1.5 rounded-lg hover:bg-teal-50 hover:border-teal-200 border border-transparent transition text-left group"
                    >
                      <div className="w-9 h-9 rounded-md overflow-hidden bg-gray-200 flex-shrink-0 flex items-center justify-center">
                        {media.mimeType?.startsWith('image/') ? (
                          <img src={media.url} alt={media.name} className="w-full h-full object-cover" />
                        ) : media.mimeType?.startsWith('video/') ? (
                          <div className="w-full h-full flex items-center justify-center bg-gray-800">
                            <Play className="w-3.5 h-3.5 text-white" />
                          </div>
                        ) : (
                          <ImageIcon className="w-3.5 h-3.5 text-gray-400" />
                        )}
                      </div>
                      <span className="text-xs text-gray-700 truncate flex-1 group-hover:text-teal-700">{media.name}</span>
                      <Plus className="w-3 h-3 text-gray-300 group-hover:text-teal-500 flex-shrink-0" />
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 mt-3">
            <button
              onClick={async () => {
                setSavingPrompt(true)
                setPromptSaved(false)
                try {
                  await authFetch(`${API_URL}/instance/config`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ customPromptMegaHair: customPromptMegaHair.trim() || null }),
                  })
                  setPromptSaved(true)
                  setTimeout(() => setPromptSaved(false), 2500)
                } finally {
                  setSavingPrompt(false)
                }
              }}
              disabled={savingPrompt}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-teal-700 rounded-lg hover:bg-teal-800 transition disabled:opacity-50"
            >
              {savingPrompt ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {savingPrompt ? 'Salvando...' : 'Salvar prompt'}
            </button>
            {promptSaved && <span className="text-xs text-green-600 font-medium">✓ Prompt salvo</span>}
          </div>
        </div>
      )}

      {showConfirmDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-80 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-800">Remover conexão?</h3>
                <p className="text-xs text-gray-500 mt-0.5">Esta ação não pode ser desfeita. Você precisará criar uma nova conexão do zero.</p>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setShowConfirmDelete(false)}
                className="flex-1 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition"
              >
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition"
              >
                Remover
              </button>
            </div>
          </div>
        </div>
      )}

      {showConfirmDisconnect && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-80 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
                <WifiOff className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-800">Desconectar WhatsApp?</h3>
                <p className="text-xs text-gray-500 mt-0.5">Será necessário escanear o QR code novamente para reconectar.</p>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setShowConfirmDisconnect(false)}
                className="flex-1 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition"
              >
                Cancelar
              </button>
              <button
                onClick={handleDisconnect}
                className="flex-1 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition"
              >
                Desconectar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
