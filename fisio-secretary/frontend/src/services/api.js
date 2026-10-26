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

export const importClients = (contacts, stage) =>
  authFetch(`${BASE}/leads/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contacts, stage }),
  }).then(json)

export const getImportedSummary = () =>
  authFetch(`${BASE}/leads/import/summary`).then(json)

export const deleteImported = () =>
  authFetch(`${BASE}/leads/import`, { method: 'DELETE' }).then(json)

export const getConversation = (id) =>
  authFetch(`${BASE}/leads/${id}/conversation`).then(json)

// Inbox: contatos que já conversaram, mais recente primeiro (paginado).
export const getInbox = ({ search = '', filter = 'all', stage = '', offset = 0, limit = 40 } = {}) => {
  const q = new URLSearchParams({ offset: String(offset), limit: String(limit) })
  if (search) q.set('search', search)
  if (filter && filter !== 'all') q.set('filter', filter)
  if (stage) q.set('stage', stage)
  return authFetch(`${BASE}/leads/inbox?${q}`).then(json)
}

export const getInboxUnreadCount = () =>
  authFetch(`${BASE}/leads/inbox/unread-count`).then(json)

export const markConversationRead = (id) =>
  authFetch(`${BASE}/leads/${id}/read`, { method: 'POST' }).then(json)

export const getLead = (id) =>
  authFetch(`${BASE}/leads/${id}`).then(json)

// Arquivo do computador (foto, vídeo, PDF…) enviado pela Inbox.
export const sendInboxFile = (leadId, base64, mimeType, fileName, caption) =>
  authFetch(`${BASE}/inbox/send-file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leadId, base64, mimeType, fileName, caption }),
  }).then(json)

export const getHistory = (id) =>
  authFetch(`${BASE}/leads/${id}/history`).then(json)

export const updateStage = (id, stage) =>
  authFetch(`${BASE}/leads/${id}/stage`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stage }),
  }).then(json)

export const getFinanceiroConversations = () =>
  authFetch(`${BASE}/financeiro-whatsapp/conversations`).then(json)

export const getFinanceiroMessages = (phone) =>
  authFetch(`${BASE}/financeiro-whatsapp/messages/${phone}`).then(json)

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

export const sendManualAudio = (phone, base64, mimeType) =>
  authFetch(`${BASE}/webhooks/manual-audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, base64, mimeType }),
  }).then(json)

export const fetchAvatar = (leadId, phone) =>
  authFetch(`${BASE}/webhooks/fetch-avatar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leadId, phone }),
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

export const purgeDeletedLead = (id) =>
  authFetch(`${BASE}/leads/deleted/${id}/purge`, { method: 'DELETE' }).then(json)

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

// --- Tabela de preços (motor de cálculo por gramatura) ---
export const getPriceConfig = () =>
  authFetch(`${BASE}/price-config`).then(json)

export const savePriceConfig = (data) =>
  authFetch(`${BASE}/price-config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(json)

// --- Minha agenda (ScheduleBuilder) ---
export const getSchedule = () =>
  authFetch(`${BASE}/schedule`).then(json)

export const saveSchedule = (data) =>
  authFetch(`${BASE}/schedule`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(json)

export const getScheduleSlots = (days = 14) =>
  authFetch(`${BASE}/schedule/slots?days=${days}`).then(json)

export const getScheduleBlocks = () =>
  authFetch(`${BASE}/schedule/blocks`).then(json)

export const createScheduleBlock = (data) =>
  authFetch(`${BASE}/schedule/blocks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(json)

export const deleteScheduleBlock = (id) =>
  authFetch(`${BASE}/schedule/blocks/${id}`, { method: 'DELETE' }).then(json)

// --- Agenda com profissionais (backend/src/agenda) ---
// 409 de conflito volta com { message, alternatives } — a tela usa pra oferecer "Marcar mesmo assim".
const agendaJson = async (r) => {
  const data = await r.json().catch(() => ({}))
  if (!r.ok) {
    const err = new Error(data?.message?.message || data?.message || `HTTP ${r.status}`)
    err.status = r.status
    err.alternatives = data?.message?.alternatives || data?.alternatives || []
    throw err
  }
  return data
}
const agendaSend = (path, method, body) =>
  authFetch(`${BASE}/agenda${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(agendaJson)

export const getAgendaSettings = () => authFetch(`${BASE}/agenda/settings`).then(agendaJson)
export const updateAgendaSettings = (payload) => agendaSend('/settings', 'PUT', payload)
export const listAgendaProfessionals = () => authFetch(`${BASE}/agenda/professionals`).then(agendaJson)
export const createAgendaProfessional = (payload) => agendaSend('/professionals', 'POST', payload)
export const updateAgendaProfessional = (id, payload) => agendaSend(`/professionals/${id}`, 'PATCH', payload)
export const deactivateAgendaProfessional = (id) => agendaSend(`/professionals/${id}`, 'DELETE')
export const listAgendaServices = () => authFetch(`${BASE}/agenda/services`).then(agendaJson)
export const createAgendaService = (payload) => agendaSend('/services', 'POST', payload)
export const updateAgendaService = (id, payload) => agendaSend(`/services/${id}`, 'PATCH', payload)
export const deactivateAgendaService = (id) => agendaSend(`/services/${id}`, 'DELETE')
export const listAgendaBlocks = (from, to) => authFetch(`${BASE}/agenda/blocks?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`).then(agendaJson)
export const createAgendaBlock = (payload) => agendaSend('/blocks', 'POST', payload)
export const deleteAgendaBlock = (id) => agendaSend(`/blocks/${id}`, 'DELETE')
export const listAgendaAppointments = (from, to) => authFetch(`${BASE}/agenda/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`).then(agendaJson)
export const createAgendaAppointment = (payload) => agendaSend('/appointments', 'POST', payload)
export const updateAgendaAppointment = (id, payload) => agendaSend(`/appointments/${id}`, 'PATCH', payload)
export const searchAgendaClients = (q) => authFetch(`${BASE}/agenda/clients?q=${encodeURIComponent(q)}`).then(agendaJson)
export const getAgendaSlots = (serviceId, from, days = 7) => authFetch(`${BASE}/agenda/slots?serviceId=${serviceId}&from=${from}&days=${days}`).then(agendaJson)
export const getAdminAgendaModes = () => authFetch(`${BASE}/admin/agenda/modes`).then(agendaJson)
export const setAdminAgendaMode = (tenantId, mode) =>
  authFetch(`${BASE}/admin/agenda/${tenantId}/mode`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  }).then(agendaJson)

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

// Arquivar/desarquivar em lote. Arquivar suspende a conta e silencia cobrança, PIX e follow-ups.
export const archiveClients = (ids) =>
  authFetch(`${BASE}/admin/clients/archive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  }).then(json)

export const unarchiveClients = (ids) =>
  authFetch(`${BASE}/admin/clients/unarchive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
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

// --- Drawer do cliente: teste/lead, churn, serviços extras ---
export const updateClientBubbleMode = (id, bubbleMode) =>
  authFetch(`${BASE}/admin/clients/${id}/bubble-mode`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bubbleMode }),
  }).then(json)

export const updateClientTestPhone = (id, phone) =>
  authFetch(`${BASE}/admin/clients/${id}/test-phone`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone }),
  }).then(json)

export const updateClientTestFlag = (id, isTest) =>
  authFetch(`${BASE}/admin/clients/${id}/test-flag`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isTest }),
  }).then(json)

export const updateClientChurn = (id, churned, reason) =>
  authFetch(`${BASE}/admin/clients/${id}/churn`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ churned, reason }),
  }).then(json)

export const getClientExtraCharges = (id) =>
  authFetch(`${BASE}/admin/clients/${id}/extra-charges`).then(json)

export const addClientExtraCharge = (id, description, amount) =>
  authFetch(`${BASE}/admin/clients/${id}/extra-charges`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description, amount }),
  }).then(json)

export const deleteClientExtraCharge = (id, chargeId) =>
  authFetch(`${BASE}/admin/clients/${id}/extra-charges/${chargeId}`, { method: 'DELETE' }).then(json)

export const getToolExpenses = () =>
  authFetch(`${BASE}/admin/tool-expenses`).then(json)

export const createToolExpense = (name, monthlyCost, billingDay) =>
  authFetch(`${BASE}/admin/tool-expenses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, monthlyCost, billingDay }),
  }).then(json)

export const updateToolExpense = (id, data) =>
  authFetch(`${BASE}/admin/tool-expenses/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(json)

export const deleteToolExpense = (id) =>
  authFetch(`${BASE}/admin/tool-expenses/${id}`, { method: 'DELETE' }).then(json)

export const resendMonthlyPix = (id) =>
  authFetch(`${BASE}/admin/clients/${id}/resend-monthly-pix`, { method: 'POST' }).then(json)

export const getBillingEvents = (tenantId) => {
  const qs = tenantId ? `?tenantId=${tenantId}` : ''
  return authFetch(`${BASE}/admin/billing-events${qs}`).then(json)
}

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

export const getAdminModulePrompt = (tenantId, moduleId) =>
  authFetch(`${BASE}/admin/prompts/${tenantId}/module/${moduleId}`).then(json)

// Config da própria instância (tenant do usuário logado) — usado pelo Layout pra
// decidir se mostra o menu "Módulos" sem depender de lista de e-mail hardcoded.
export const getInstanceConfig = () =>
  authFetch(`${BASE}/instance/config`).then(json)

// --- Admin: edição de módulos dinâmicos de qualquer tenant (sem precisar logar como o cliente) ---
export const getAdminPromptModules = (tenantId) =>
  authFetch(`${BASE}/admin/prompt-modules/${tenantId}`).then(json)

export const updateAdminPromptModule = (tenantId, moduleId, body) =>
  authFetch(`${BASE}/admin/prompt-modules/${tenantId}/${moduleId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(json)

// --- Onboarding: form recebido → rascunho de prompt → revisão (agente de CS, Fase 1) ---
export const listOnboardingForms = () =>
  authFetch(`${BASE}/admin/prompt-drafts/forms`).then(json)

// --- Onboarding: formulário próprio (link público por cliente) ---
export const listClientFormDefinitions = () =>
  authFetch(`${BASE}/admin/client-forms/definitions`).then(json)

export const listClientForms = () =>
  authFetch(`${BASE}/admin/client-forms`).then(json)

export const createClientForm = (tenantId, formKey) =>
  authFetch(`${BASE}/admin/client-forms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantId, formKey }),
  }).then(json)

export const listPromptDrafts = (status) => {
  const qs = status ? `?status=${status}` : ''
  return authFetch(`${BASE}/admin/prompt-drafts${qs}`).then(json)
}

export const getPromptDraft = (id) =>
  authFetch(`${BASE}/admin/prompt-drafts/${id}`).then(json)

export const generatePromptDraft = (tenantId, referenceTenantId) =>
  authFetch(`${BASE}/admin/prompt-drafts/generate/${tenantId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(referenceTenantId ? { referenceTenantId } : {}),
  }).then(json)

export const updatePromptDraft = (id, content) =>
  authFetch(`${BASE}/admin/prompt-drafts/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  }).then(json)

export const approvePromptDraft = (id, content) =>
  authFetch(`${BASE}/admin/prompt-drafts/${id}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(content != null ? { content } : {}),
  }).then(json)

export const discardPromptDraft = (id) =>
  authFetch(`${BASE}/admin/prompt-drafts/${id}/discard`, { method: 'POST' }).then(json)

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

// --- Admin: financeiro (mapeamento de clientes, receita, custo, margem) ---
export const getFinanceOverview = (from, to) => {
  const qs = new URLSearchParams()
  if (from) qs.set('from', from)
  if (to) qs.set('to', to)
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  return authFetch(`${BASE}/admin/finance/overview${suffix}`).then(json)
}

export const syncClientOrigins = () =>
  authFetch(`${BASE}/admin/finance/sync-origins`, { method: 'POST' }).then(json)

// --- Admin: onboarding pós-pagamento (grupo automático + mensagens) ---
export const getAdminOnboardingSettings = () =>
  authFetch(`${BASE}/admin/onboarding/settings`).then(json)

export const updateAdminOnboardingSettings = (payload) => // { groupEnabled?, teamPhones?, welcomeMessage?, formMessageEnabled?, formMessage?, formDelayMinutes?, formUrl?, formEntryField? }
  authFetch(`${BASE}/admin/onboarding/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(json)

export const createOnboardingTestGroup = () =>
  authFetch(`${BASE}/admin/onboarding/test-group`, { method: 'POST' }).then(json)

// --- Admin: relatórios de grupos (monitoramento de "Projeto <cliente>" pós-onboarding —
// diferente de /admin/onboarding acima, que configura a CRIAÇÃO do grupo) ---
export const getGroupReportsOverview = (date) =>
  authFetch(`${BASE}/admin/group-monitor/overview?date=${date}`).then(json)

export const getGroupReports = (date) =>
  authFetch(`${BASE}/admin/group-monitor/reports?date=${date}`).then(json)

export const getGroupReport = (id) =>
  authFetch(`${BASE}/admin/group-monitor/reports/${id}`).then(json)

export const getGroupMonitorSettings = () =>
  authFetch(`${BASE}/admin/group-monitor/settings`).then(json)

export const updateGroupMonitorSettings = (payload) => // { riskAlertPhone?, pdfReportGroupJid? }
  authFetch(`${BASE}/admin/group-monitor/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(json)

// Gera o relatório do dia na hora, sem esperar o cron das 18h — útil pra ver o resultado
// de uma conversa recente sem precisar esperar.
export const runGroupReportsNow = (date) =>
  authFetch(`${BASE}/admin/group-monitor/reports/run-now`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date }),
  }).then(json)

// Envia o PDF consolidado do dia pro grupo configurado — separado do "Gerar agora" de
// propósito, pra não mandar mensagem no grupo real só de conferir o relatório.
export const sendGroupReportsPdf = (date) =>
  authFetch(`${BASE}/admin/group-monitor/reports/send-pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date }),
  }).then(json)

// --- Admin: clientes com PIX em atraso ---
export const getOverdueClients = () =>
  authFetch(`${BASE}/payments/overdue`).then(json)

// --- Página pública de renovação (QR + código Pix) — sem auth, link vem do WhatsApp ---
export const getPixPageData = (txid) =>
  fetch(`${BASE}/payments/pix/${txid}`).then(json)

// --- Trocar a própria senha ---
export const changePassword = (currentPassword, newPassword) =>
  authFetch(`${BASE}/auth/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
  }).then(json)

// ── Relatório de vendas (IA) — piloto DALU ──
export const getSalesReportStatus = () =>
  authFetch(`${BASE}/sales-reports/status`).then(json)

export const listSalesReports = () =>
  authFetch(`${BASE}/sales-reports`).then(json)

export const getSalesReport = (id) =>
  authFetch(`${BASE}/sales-reports/${id}`).then(json)

export const requestSalesReport = () =>
  authFetch(`${BASE}/sales-reports`, { method: 'POST' }).then(json)

export const downloadSalesReportPdf = async (id) => {
  const r = await authFetch(`${BASE}/sales-reports/${id}/pdf`)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const blob = await r.blob()
  const name = /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') ?? '')?.[1] ?? 'relatorio-vendas.pdf'
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
