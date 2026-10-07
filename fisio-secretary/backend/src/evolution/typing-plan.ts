// Simula uma pessoa digitando no celular: digita um pedaço, para (pensando /
// apagando / relendo), volta a digitar. No WhatsApp o "digitando…" some quando a
// presença 'composing' expira e reaparece no próximo composing — é assim que a
// pausa e o "apagou e voltou a escrever" ficam visíveis pro cliente (apagar texto
// em si não aparece no WhatsApp).
//
// ~110ms/caractere (≈ 9 caracteres/s, digitação de celular de quem escreve rápido),
// com piso/teto e variação aleatória de ±15% pra duas bolhas do mesmo tamanho
// nunca terem o mesmo tempo. Uma frase de 146 caracteres leva ~16s digitando +
// ~3s de pausas.
export const TYPING_MS_PER_CHAR = 110;
export const TYPING_MIN_MS = 2500;
export const TYPING_MAX_MS = 20000;
export const PAUSE_BETWEEN_BUBBLES_MIN_MS = 1000;
export const PAUSE_BETWEEN_BUBBLES_MAX_MS = 1800;
const HESITATION_MIN_MS = 900;
const HESITATION_MAX_MS = 2200;

export type TypingStep = { type: 'type'; ms: number } | { type: 'pause'; ms: number };

const between = (min: number, max: number, rnd: () => number) => Math.round(min + (max - min) * rnd());

// Texto curto: 1 trecho. Médio (45-110): digita, hesita, termina. Longo (>110): 3 trechos.
export function buildTypingPlan(text: string, rnd: () => number = Math.random): TypingStep[] {
  const len = (text ?? '').length;
  const jitter = 0.85 + 0.3 * rnd();
  const total = Math.round(Math.min(TYPING_MAX_MS, Math.max(TYPING_MIN_MS, len * TYPING_MS_PER_CHAR)) * jitter);

  const ratios = len > 110 ? [0.4, 0.3, 0.3] : len >= 45 ? [0.55, 0.45] : [1];
  const steps: TypingStep[] = [];
  ratios.forEach((r, i) => {
    if (i > 0) steps.push({ type: 'pause', ms: between(HESITATION_MIN_MS, HESITATION_MAX_MS, rnd) });
    steps.push({ type: 'type', ms: Math.round(total * r) });
  });
  return steps;
}

export const pauseBetweenBubbles = (rnd: () => number = Math.random) =>
  between(PAUSE_BETWEEN_BUBBLES_MIN_MS, PAUSE_BETWEEN_BUBBLES_MAX_MS, rnd);
