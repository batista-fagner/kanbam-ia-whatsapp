const BASE = 'http://localhost:3000'

const json = (r) => r.json()

export const getLeads = () =>
  fetch(`${BASE}/leads`).then(json)

export const getConversation = (id) =>
  fetch(`${BASE}/leads/${id}/conversation`).then(json)

export const getHistory = (id) =>
  fetch(`${BASE}/leads/${id}/history`).then(json)

export const updateStage = (id, stage) =>
  fetch(`${BASE}/leads/${id}/stage`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stage }),
  }).then(json)

export const toggleAi = (id, enabled) =>
  fetch(`${BASE}/leads/${id}/ai`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  }).then(json)

export const sendManualMessage = (phone, text) =>
  fetch(`${BASE}/webhooks/manual`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, text }),
  }).then(json)

export const deleteLead = (id) =>
  fetch(`${BASE}/leads/${id}`, { method: 'DELETE' }).then(json)

export const sendBulkMessage = (payload) =>
  fetch(`${BASE}/bulk-message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(json)

export const getCampaigns = () =>
  fetch(`${BASE}/bulk-message/campaigns`).then(json)

export const getCampaignMessages = (id) =>
  fetch(`${BASE}/bulk-message/campaigns/${id}/messages`).then(json)

export const controlCampaign = (id, action) =>
  fetch(`${BASE}/bulk-message/campaigns/${id}/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  }).then(json)
