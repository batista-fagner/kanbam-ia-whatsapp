// Trava de vídeo da Black Friday.
//
// Bug real (S&A Cabelos Naturais, 11/11/2026): os módulos mandam usar SÓ os vídeos com
// "Black Friday" no nome, mas a IA mandou "Video- Vietnamita- promocao- liso- 59 cm" (legenda
// antiga R$ 499,90) no lugar de "Video- Vietnamita- Liso- 59 cm- Black Friday- Promocao"
// (R$ 449,90). A cliente viu um preço no vídeo e outro na cotação. O modelo desobedece o
// prompt às vezes, então a regra tem que ser em código.
//
// Só vale para os tenants da lista. Ao fim da Black Friday, tire o tenant daqui.
export const BLACK_FRIDAY_MEDIA_TENANT_IDS = new Set<string>([
  'badfc5d9-d522-4253-a788-28b3ebe41753', // S&A Cabelos Naturais (Black Friday 2026)
]);

export const BLACK_FRIDAY_MEDIA_BLOCKED_REPLY =
  'Esse modelo não está na nossa Black Friday 😕 Quer que eu te mostre as opções mais parecidas que estão na promoção?';

// Palavras que não identificam o cabelo (o vídeo antigo diz "promocao", o novo "Black Friday- Promocao").
const NOISE = new Set(['video', 'black', 'friday', 'promocao', 'cm']);

function tokens(name: string): string[] {
  return (name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function isBlackFridayMedia(name: string): boolean {
  const t = ` ${tokens(name).join(' ')} `;
  return t.includes(' black friday ');
}

// Vídeo de cabelo = tem tamanho em cm. Vídeos de loja/endereço não têm e passam direto.
export function isHairMedia(name: string): boolean {
  return /\d+\s*cm\b/i.test(name ?? '');
}

// Identidade do cabelo: origem + textura + tamanho, sem as palavras de promoção.
export function hairSignature(name: string): string {
  return [...new Set(tokens(name).filter((t) => !NOISE.has(t)))].sort().join(' ');
}

// Para cada vídeo escolhido pela IA:
// - Black Friday ou não é de cabelo → mantém;
// - existe a versão Black Friday do mesmo cabelo → troca por ela;
// - não existe → barra (não envia).
export function swapToBlackFriday(
  names: string[],
  catalogNames: string[],
): { names: string[]; swapped: Array<{ from: string; to: string }>; blocked: string[] } {
  const bfBySignature = new Map<string, string>();
  for (const n of catalogNames) {
    if (isBlackFridayMedia(n) && isHairMedia(n)) {
      const sig = hairSignature(n);
      if (!bfBySignature.has(sig)) bfBySignature.set(sig, n);
    }
  }
  const out: string[] = [];
  const swapped: Array<{ from: string; to: string }> = [];
  const blocked: string[] = [];
  for (const n of names) {
    if (isBlackFridayMedia(n) || !isHairMedia(n)) {
      if (!out.includes(n)) out.push(n);
      continue;
    }
    const bf = bfBySignature.get(hairSignature(n));
    if (bf) {
      swapped.push({ from: n, to: bf });
      if (!out.includes(bf)) out.push(bf);
    } else {
      blocked.push(n);
    }
  }
  return { names: out, swapped, blocked };
}
