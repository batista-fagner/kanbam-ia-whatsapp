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
