// Aviso sonoro de mensagem nova: "plim" de duas notas gerado no navegador (sem arquivo),
// diferente do toque do WhatsApp pra não confundir com o celular.
const PREF_KEY = 'inbox_sound'
export const SOUND_OPTIONS = [
  { key: 'all', label: 'Todas as mensagens' },
  { key: 'ai_off', label: 'Só conversas com a IA desligada' },
  { key: 'off', label: 'Desligado' },
]

export function getSoundPref() {
  try {
    return localStorage.getItem(PREF_KEY) || 'all'
  } catch {
    return 'all'
  }
}

export function setSoundPref(value) {
  try {
    localStorage.setItem(PREF_KEY, value)
  } catch {
    // sem localStorage (aba anônima bloqueada): vale só até recarregar
  }
}

let ctx = null
let lastPlayed = 0

export function playNotify() {
  const now = Date.now()
  if (now - lastPlayed < 2500) return // rajada de mensagens = um aviso só
  lastPlayed = now
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)()
    if (ctx.state === 'suspended') ctx.resume()
    const t = ctx.currentTime
    ;[[880, 0], [1320, 0.12]].forEach(([freq, delay]) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, t + delay)
      gain.gain.exponentialRampToValueAtTime(0.18, t + delay + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + delay + 0.25)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t + delay)
      osc.stop(t + delay + 0.3)
    })
  } catch {
    // navegador sem Web Audio — fica só o número na aba
  }
}
