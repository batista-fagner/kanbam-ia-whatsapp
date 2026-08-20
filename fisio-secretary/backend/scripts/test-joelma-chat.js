/**
 * Testa as respostas reais da IA para os módulos da Joelma, replicando
 * exatamente a montagem de prompt do PromptModulesService (selectModules +
 * buildSystemPrompt) e a chamada do AiService.processDynamicPrompt.
 *
 * NÃO sobe o AppModule de propósito: subir o Nest inteiro apontado pro banco
 * de produção ligaria os crons de follow-up/PIX e poderia disparar mensagem
 * real pra lead. Aqui só lê prompt_modules + media_files e chama o Gemini.
 */
const { Client } = require('pg');
const OpenAI = require('openai');
const fs = require('fs');

const env = fs.readFileSync(__dirname + '/../.env', 'utf8');
const pick = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();

const TENANT = 'cb994ad4-6478-4e23-b30a-6b4953696ec9';
const MODEL = 'gemini-3.1-flash-lite';

const JSON_SCHEMA = `RESPONDA SEMPRE em JSON com este formato exato (NÃO inclua campos além destes):
{
  "reply": "texto da resposta para a cliente",
  "stage": "novo_lead|lead_frio|lead_quente|agendado|perdido",
  "temperature": "quente|morno|frio",
  "action": "none|schedule|send_media",
  "mediaName": "id exato do catálogo (ou array de ids p/ vários vídeos) — só com action=send_media",
  "appointmentDateTime": "YYYY-MM-DDTHH:MM:SS — só com action=schedule, SEMPRE usando a TABELA DE DATAS (nunca calcule de cabeça)",
  "appointmentService": "mega_hair|manutencao|null",
  "appointmentValue": null,
  "tags": [],
  "shouldIgnore": false,
  "fields": { "name": "nome se coletado ou null" }
}`;

function buildMiniDateBlock() {
  const TZ = 'America/Sao_Paulo';
  const now = new Date();
  const parts = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(now);
  const g = (t) => parts.find(p => p.type === t).value;
  const hour = parseInt(new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', hour12: false }).format(now), 10);
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  return `DATA DE HOJE: ${g('day')}/${g('month')}/${g('year')} (${g('weekday')}). Ao cumprimentar, use EXATAMENTE "${greeting}" (nunca escreva com barras).`;
}

function buildMediaCatalogBlock(names) {
  if (!names.length) return 'CATÁLOGO DE MÍDIAS: nenhuma mídia cadastrada ainda. Não ofereça vídeos.';
  return `CATÁLOGO DE MÍDIAS DISPONÍVEIS (lista atual, sempre atualizada):\n${names.map(n => `- "${n}"`).join('\n')}\n\nUse em "mediaName" EXATAMENTE um dos nomes acima, copiado letra por letra (maiúsculas/minúsculas/espaços/acentos). NUNCA invente um nome fora desta lista. Se a cliente pedir algo que não bate exatamente, escolha o mais próximo (mesma textura, tamanho mais parecido) dentre os nomes acima.`;
}

function selectModules(message, allModules, previousNames, priorAssistantText) {
  const candidates = allModules.filter(m => !m.is_core && m.is_active);
  const haystack = priorAssistantText ? `${priorAssistantText}\n${message}` : message;
  const fresh = candidates.filter(m =>
    m.keywords.split('\n').map(k => k.trim()).filter(Boolean).some(p => {
      try { return new RegExp(p, 'i').test(haystack); }
      catch { return haystack.toLowerCase().includes(p.toLowerCase()); }
    }),
  );
  const freshSet = new Set(fresh.map(m => m.name));
  const prevSet = new Set(previousNames || []);
  const carried = candidates.filter(m => prevSet.has(m.name) && !freshSet.has(m.name));
  const selected = [...fresh, ...carried].sort((a, b) => a.sort_order - b.sort_order);
  return { selected, freshNames: fresh.map(m => m.name) };
}

function buildSystemPrompt(core, selected, mediaNames) {
  const blocks = selected.map(m => m.injects_media_catalog
    ? [m.content, buildMediaCatalogBlock(mediaNames)].join('\n\n')
    : m.content);
  return [core.content, ...blocks, JSON_SCHEMA, buildMiniDateBlock()].filter(p => p && p.trim()).join('\n\n');
}

// ── cenários: cada um é uma lista de turnos da cliente ──
const SCENARIOS = [
  { id: 'saudacao',        turns: ['Oi, boa tarde'] },
  { id: 'categoria-link',  turns: ['Quero ver Tic Tac Bio'] },
  { id: 'ambiguidade-bio', turns: ['quero cabelo bio'] },
  { id: 'preco-lace',      turns: ['quanto custa a lace wig bio vegetal?'] },
  { id: 'FRETE-critico',   turns: ['quanto fica o frete pro CEP 04567-000?'] },
  { id: 'AGENDA-critico',  turns: ['quero marcar pra terça às 14h'] },
  { id: 'megahair-COMPRA', turns: ['vocês vendem mega hair?'] },
  { id: 'megahair-APLICA', turns: ['vocês colocam mega hair? quanto custa pra colocar?'] },
  { id: 'desconto',        turns: ['quero comprar essa lace, faz um desconto pra mim?'] },
  { id: 'midia-cadastrada',turns: ['tem bio humano liso 75 cm preto?'] },
  { id: 'nao-negar',       turns: ['tem lace grisalha?'] },
  { id: 'nao-negar-2',     turns: ['vocês têm cabelo ruivo?'] },
  { id: 'nao-negar-3',     turns: ['tem tic tac bio na cor cinza?'] },
  { id: 'cartao-link',     turns: ['aceita cartão? pode me mandar o link de pagamento?'] },
  { id: 'multi-turno',     turns: ['oi, queria uma lace', 'quero a humana', 'quanto custa?'] },
];

const c = new Client({ connectionString: pick('SUPABASE_DATABASE_URL'), ssl: { rejectUnauthorized: false } });

(async () => {
  await c.connect();
  const mods = (await c.query('SELECT * FROM prompt_modules WHERE tenant_id=$1 AND is_active=true ORDER BY sort_order', [TENANT])).rows;
  const core = mods.find(m => m.is_core);
  const mediaNames = (await c.query('SELECT name FROM media_files WHERE tenant_id=$1 ORDER BY name', [TENANT])).rows.map(r => r.name);
  await c.end();

  const openai = new OpenAI({ apiKey: pick('GEMINI_API_KEY'), baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/' });
  const only = process.argv[2];
  let promptSizes = [];

  for (const sc of SCENARIOS) {
    if (only && !sc.id.includes(only)) continue;
    console.log(`\n${'='.repeat(78)}\nCENÁRIO: ${sc.id}`);
    let history = [];
    let prevModules = [];

    for (const turn of sc.turns) {
      const priorAssistant = [...history].reverse().find(m => m.role === 'assistant')?.content || '';
      const { selected, freshNames } = selectModules(turn, mods, prevModules, priorAssistant);
      const usesMedia = selected.some(m => m.injects_media_catalog);
      const systemPrompt = buildSystemPrompt(core, selected, usesMedia ? mediaNames : []);
      promptSizes.push(systemPrompt.length);

      const res = await openai.chat.completions.create({
        model: MODEL, max_tokens: 1024, response_format: { type: 'json_object' },
        reasoning_effort: 'none',
        messages: [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: turn }],
      });
      let out;
      try { out = JSON.parse(res.choices[0].message.content); }
      catch { out = { reply: '[JSON INVÁLIDO] ' + res.choices[0].message.content }; }

      console.log(`\n  CLIENTE: ${turn}`);
      console.log(`  módulos: [${selected.map(m => m.name).join(', ') || '-'}]  prompt=${systemPrompt.length}c  tokens_in=${res.usage?.prompt_tokens}`);
      console.log(`  BELLA:   ${out.reply}`);
      console.log(`  action=${out.action}  mediaName=${JSON.stringify(out.mediaName)}  stage=${out.stage}  shouldIgnore=${out.shouldIgnore}`);

      history.push({ role: 'user', content: turn }, { role: 'assistant', content: out.reply });
      prevModules = freshNames;
    }
  }

  if (promptSizes.length) {
    const avg = Math.round(promptSizes.reduce((a, b) => a + b, 0) / promptSizes.length);
    console.log(`\n${'='.repeat(78)}\nprompt médio: ${avg} chars  (monólito atual: 37716 chars em TODA chamada)`);
    console.log(`min=${Math.min(...promptSizes)}  max=${Math.max(...promptSizes)}  economia média: ${Math.round((1 - avg / 37716) * 100)}%`);
  }
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
