import { useSyncExternalStore } from 'react'

// Modo demonstração: oculta o número do lead na tela (ex.: print/tela compartilhada),
// sem precisar de deploy pra ligar/desligar. Estado global simples (não é dado
// sensível de servidor, só uma preferência de UI), persistido só neste navegador.
let demoModeValue = typeof localStorage !== 'undefined' && localStorage.getItem('crm_demo_mode') === '1'
const demoModeListeners = new Set()

export function setDemoMode(value) {
  demoModeValue = value
  try { localStorage.setItem('crm_demo_mode', value ? '1' : '0') } catch {}
  demoModeListeners.forEach((fn) => fn())
}

export function useDemoMode() {
  return useSyncExternalStore(
    (cb) => { demoModeListeners.add(cb); return () => demoModeListeners.delete(cb) },
    () => demoModeValue,
  )
}

export function maskPhone(phone) {
  if (!phone) return phone
  return String(phone).replace(/\d/g, '•')
}

export function displayPhone(phone, demoMode) {
  return demoMode ? maskPhone(phone) : phone
}
