import { getStoredToken, clearStoredToken } from '../context/AuthContext'

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

// fetch com Authorization automático + tratamento de 401 (sessão expirada → login)
export const authFetch = (url, opts = {}) => {
  const token = getStoredToken()
  const headers = {
    ...(opts.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
  return fetch(url, { ...opts, headers }).then((r) => {
    if (r.status === 401) {
      clearStoredToken()
      if (window.location.pathname !== '/login') window.location.href = '/login'
      throw new Error('Sessão expirada. Faça login novamente.')
    }
    return r
  })
}

const json = async (r) => {
  const data = await r.json()
  if (!r.ok) throw new Error(data?.message || `HTTP ${r.status}`)
  return data
}

export const getLeads = () =>
  authFetch(`${BASE}/leads`).then(json)

export const createLead = (phone, name) =>
  authFetch(`${BASE}/leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, ...(name ? { name } : {}) }),
  }).then(json)

export const getConversation = (id) =>
  authFetch(`${BASE}/leads/${id}/conversation`).then(json)

export const getHistory = (id) =>
  authFetch(`${BASE}/leads/${id}/history`).then(json)

export const updateStage = (id, stage) =>
  authFetch(`${BASE}/leads/${id}/stage`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stage }),
  }).then(json)

export const updateName = (id, name) =>
  authFetch(`${BASE}/leads/${id}/name`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  }).then(json)

export const toggleAi = (id, enabled) =>
  authFetch(`${BASE}/leads/${id}/ai`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  }).then(json)

export const updateObservations = (id, observations) =>
  authFetch(`${BASE}/leads/${id}/observations`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ observations }),
  }).then(json)

export const sendManualMessage = (phone, text) =>
  authFetch(`${BASE}/webhooks/manual`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, text }),
  }).then(json)

export const sendManualMedia = (phone, mediaId, caption) =>
  authFetch(`${BASE}/webhooks/manual-media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, mediaId, caption }),
  }).then(json)

// ───────────────────────── Follow-up agendado ─────────────────────────

// IA sugere uma mensagem baseada na conversa (operador revisa antes de agendar)
export const generateFollowup = (leadId) =>
  authFetch(`${BASE}/followups/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leadId }),
  }).then(json)

// Agenda o envio (delayHours: 1 | 4 | 24)
export const scheduleFollowup = (leadId, message, delayHours) =>
  authFetch(`${BASE}/followups`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leadId, message, delayHours }),
  }).then(json)

export const getFollowups = (leadId) =>
  authFetch(`${BASE}/followups/lead/${leadId}`).then(json)

export const cancelFollowup = (id) =>
  authFetch(`${BASE}/followups/${id}`, { method: 'DELETE' }).then(json)

export const getMediaList = () =>
  authFetch(`${BASE}/media`).then(json)

export const deleteLead = (id, reason) =>
  authFetch(`${BASE}/leads/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  }).then(json)

export const getDeletedLeads = () =>
  authFetch(`${BASE}/leads/deleted`).then(json)

export const getDeletedLead = (id) =>
  authFetch(`${BASE}/leads/deleted/${id}`).then(json)

export const getDashboard = (period = 'all') =>
  authFetch(`${BASE}/leads/dashboard?period=${period}`).then(json)

export const removeLabel = (id, label) =>
  authFetch(`${BASE}/leads/${id}/labels/${encodeURIComponent(label)}`, { method: 'DELETE' }).then(json)

export const sendBulkMessage = (payload) =>
  authFetch(`${BASE}/bulk-message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(json)

export const getCampaigns = () =>
  authFetch(`${BASE}/bulk-message/campaigns`).then(json)

export const getCampaignMessages = (id) =>
  authFetch(`${BASE}/bulk-message/campaigns/${id}/messages`).then(json)

export const controlCampaign = (id, action) =>
  authFetch(`${BASE}/bulk-message/campaigns/${id}/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  }).then(json)

export const getAppointmentsByMonth = (year, month) =>
  authFetch(`${BASE}/appointments?year=${year}&month=${month}`).then(json)

export const createAppointment = (data) =>
  authFetch(`${BASE}/appointments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(json)

export const updateAppointment = (id, data) =>
  authFetch(`${BASE}/appointments/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(json)

export const deleteAppointment = (id) =>
  authFetch(`${BASE}/appointments/${id}`, { method: 'DELETE' }).then(json)

// --- Admin: gestão de clientes ---
export const getClients = () =>
  authFetch(`${BASE}/admin/clients`).then(json)

export const createClient = (payload) =>
  authFetch(`${BASE}/admin/clients`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(json)

export const setClientActive = (id, isActive) =>
  authFetch(`${BASE}/admin/clients/${id}/active`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isActive }),
  }).then(json)

export const resetClientPassword = (id, newPassword) =>
  authFetch(`${BASE}/admin/clients/${id}/reset-password`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newPassword }),
  }).then(json)

export const updateClientBilling = (id, payload) => // payload: { nextPaymentDate?, billingPhone?, billingDay? }
  authFetch(`${BASE}/admin/clients/${id}/billing`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(json)

export const clearClientPastDue = (id) =>
  authFetch(`${BASE}/admin/clients/${id}/clear-past-due`, { method: 'PATCH' }).then(json)

export const deleteClient = (id) =>
  authFetch(`${BASE}/admin/clients/${id}`, { method: 'DELETE' }).then(json)

export const getTokenUsage = (from, to) => {
  const params = new URLSearchParams()
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  return authFetch(`${BASE}/admin/usage?${params}`).then(json)
}

// --- Admin: auditoria de prompts de todos os tenants ---
export const getAdminPrompts = () =>
  authFetch(`${BASE}/admin/prompts`).then(json)

export const getAdminMonolithPrompt = (tenantId, kind) => // kind: 'sofia' | 'megahair'
  authFetch(`${BASE}/admin/prompts/${tenantId}/monolith/${kind}`).then(json)

export const getAdminAgentPrompt = (tenantId, agentId) =>
  authFetch(`${BASE}/admin/prompts/${tenantId}/agent/${agentId}`).then(json)

// --- Checkout público (Stripe) — sem auth ---
export const createCheckout = (payload) => // { name, email, phone, method: 'card'|'pix' }
  fetch(`${BASE}/payments/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(json)

// --- Implantação (R$400, PIX único, sem conta) ---
export const createImplantacaoCheckout = (payload) => // { name, phone, email }
  fetch(`${BASE}/payments/implantacao`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(json)

// --- Checkout: settings públicas (o que exibir na página) ---
export const getCheckoutSettings = () =>
  fetch(`${BASE}/payments/checkout-settings`).then(json)

// --- Admin: configurações do checkout (habilitar métodos, valores) ---
export const getAdminCheckoutSettings = () =>
  authFetch(`${BASE}/admin/checkout-settings`).then(json)

export const updateAdminCheckoutSettings = (payload) => // { pixEnabled?, cardEnabled?, implantacaoEnabled?, implantacaoPrice?, planoPrice? }
  authFetch(`${BASE}/admin/checkout-settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(json)

// --- Admin: clientes com PIX em atraso ---
export const getOverdueClients = () =>
  authFetch(`${BASE}/payments/overdue`).then(json)

// --- Trocar a própria senha ---
export const changePassword = (currentPassword, newPassword) =>
  authFetch(`${BASE}/auth/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
  }).then(json)
