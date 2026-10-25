import { io } from 'socket.io-client'
import { getStoredToken } from '../context/AuthContext'

// Uma conexão de tempo real por aba, compartilhada entre o menu (contador de não lidas
// e som) e a Inbox. O Layout fecha ao sair (logout troca de conta/sala).
let socket = null

export function getSocket() {
  if (!socket) {
    socket = io(import.meta.env.VITE_API_URL ?? 'http://localhost:3000', { auth: { token: getStoredToken() } })
  }
  return socket
}

export function closeSocket() {
  socket?.disconnect()
  socket = null
}

// Conversa aberta agora na Inbox (com a aba visível) — mensagem dela não toca som nem conta
// como não lida.
let openLeadId = null
export const setOpenInboxLead = (id) => { openLeadId = id }
export const isLeadOpenOnScreen = (id) => !!id && id === openLeadId && document.visibilityState === 'visible'
