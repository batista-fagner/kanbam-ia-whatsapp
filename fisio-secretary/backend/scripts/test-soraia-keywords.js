/**
 * Teste seco do mapeamento de keywords da Soraia — replica exatamente a
 * lógica de regex do PromptModulesService.selectModules (sem chamar IA).
 * Cada caso declara quais módulos DEVEM carregar; falha se faltar algum.
 */
const { Client } = require('pg');
const fs = require('fs');
const url = fs.readFileSync(__dirname + '/../.env', 'utf8').match(/SUPABASE_DATABASE_URL=(.*)/)[1].trim();
const TENANT = '79e2074f-2a9e-4f57-be19-c137e744b8a8';

const AVA = 'Avaliação & Diferenciais';
const PRECO = 'Preço & Objeções';
const AGENDA = 'Agendamento & Manutenção';
const INST = 'Institucional & Pagamento';

// msg, [modulos obrigatorios]
const CASES = [
  // ---- avaliação / diferenciais ----
  ['quero colocar mega hair, busco mais volume', [AVA]],
  ['queria mais comprimento', [AVA]],
  ['é a primeira vez que vou fazer', [AVA]],
  ['tenho medo de estragar meu cabelo', [AVA]],
  ['dói pra colocar?', [AVA]],
  ['fica artificial?', [AVA]],
  ['o mega hair pode cair?', [AVA]],
  ['como funciona a avaliação online?', [AVA]],
  ['queria fazer troca de método', [AVA]],
  ['que técnica vocês usam?', [AVA]],
  ['é fita adesiva?', [AVA]],
  ['meu cabelo é muito fino, serve pra mim?', [AVA]],
  ['de quanto em quanto tempo precisa de manutenção?', [AVA, AGENDA]],
  ['quanto tempo demora o procedimento?', [AVA]],

  // ---- preço / objeções ----
  ['quanto custa o mega hair?', [PRECO]],
  ['qual o valor?', [PRECO]],
  ['quanto fica pra colocar?', [PRECO]],
  ['tá caro', [PRECO]],
  ['achei mais barato em outro lugar', [PRECO]],
  ['tem desconto?', [PRECO]],
  ['faz promoção?', [PRECO]],
  ['parcela em quantas vezes?', [PRECO, INST]],
  ['vou pensar', [PRECO]],
  ['só estou pesquisando', [PRECO]],
  ['quanto é a progressiva?', [PRECO]],
  ['valor da coloração', [PRECO]],
  ['quanto custa um corte?', [PRECO]],
  ['quanto é a escova?', [PRECO]],
  ['vocês compram cabelo?', [PRECO]],
  ['quero vender meu cabelo', [PRECO]],
  ['tenho 150 gramas, quanto fica a troca de método?', [PRECO, AVA]],
  ['qual o valor do sinal?', [PRECO]],
  ['tem condição especial pra cabeleireira?', [PRECO]],
  ['vale a pena?', [PRECO]],

  // ---- agendamento ----
  ['quero agendar', [AGENDA]],
  ['posso marcar pra sábado?', [AGENDA]],
  ['tem horário amanhã?', [AGENDA]],
  ['queria fazer minha manutenção', [AGENDA]],
  ['pode ser terça de manhã?', [AGENDA]],
  ['preciso remarcar', [AGENDA]],
  ['quero cancelar meu horário', [AGENDA]],
  ['dá pra sexta às 14h?', [AGENDA]],
  ['tem vaga essa semana?', [AGENDA]],
  ['prefiro de tarde', [AGENDA]],
  ['que horas vocês atendem?', [AGENDA, INST]],
  ['quero fazer o retoque de raiz', [AGENDA, PRECO]],

  // ---- institucional / pagamento ----
  ['qual o endereço?', [INST]],
  ['onde fica o estúdio?', [INST]],
  ['vocês ficam em alphaville?', [INST]],
  ['como chego aí?', [INST]],
  ['qual a chave pix?', [INST]],
  ['me manda o cnpj', [INST]],
  ['aceita cartão de crédito?', [INST, PRECO]],
  ['já mandei o comprovante', [INST]],
  ['vocês abrem no domingo?', [INST]],
  ['tem estacionamento?', [INST]],
  ['qual o instagram de vocês?', [INST]],
  ['qual o cep?', [INST]],
  ['formas de pagamento?', [INST]],

  // ---- edge cases: resposta curta a pergunta da IA (usa priorAssistantText) ----
  // (testados no harness de conversa; aqui só o que a mensagem sozinha resolve)
];

// Casos que NÃO podem carregar determinado módulo (falso positivo caro:
// carregar Agendamento arrasta a tabela de datas inteira + a regra genérica
// "agende direto", num turno que é só uma saudação).
const NEGATIVE_CASES = [
  ['Oi, bom dia', AGENDA],
  ['boa tarde!', AGENDA],
  ['bom dia, tudo bem?', AGENDA],
  ['oi', AGENDA],
  ['obrigada, bom dia', AGENDA],
];

const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

c.connect().then(async () => {
  const r = await c.query(
    'SELECT name, keywords, is_core FROM prompt_modules WHERE tenant_id=$1 AND is_active=true ORDER BY sort_order',
    [TENANT],
  );
  const candidates = r.rows.filter(m => !m.is_core);

  const match = (msg) => candidates.filter(m =>
    m.keywords.split('\n').map(k => k.trim()).filter(Boolean).some(p => {
      try { return new RegExp(p, 'i').test(msg); }
      catch { return msg.toLowerCase().includes(p.toLowerCase()); }
    }),
  ).map(m => m.name);

  let fail = 0, orphan = 0;
  for (const [msg, expected] of CASES) {
    const got = match(msg);
    const missing = expected.filter(e => !got.includes(e));
    if (got.length === 0) orphan++;
    if (missing.length) {
      fail++;
      console.log(`FALHA  "${msg}"\n       esperado: ${expected.join(', ')}\n       obtido:   ${got.join(', ') || '(nenhum)'}`);
    } else {
      console.log(`ok     "${msg}"  ->  ${got.join(', ')}`);
    }
  }
  let negFail = 0;
  for (const [msg, forbidden] of NEGATIVE_CASES) {
    const got = match(msg);
    if (got.includes(forbidden)) {
      negFail++;
      console.log(`FALHA(-) "${msg}"\n       não podia carregar: ${forbidden}\n       obtido:   ${got.join(', ')}`);
    } else {
      console.log(`ok(-)  "${msg}"  ->  ${got.join(', ') || '(nenhum)'}`);
    }
  }

  console.log(`\n${CASES.length - fail}/${CASES.length} positivos | ${NEGATIVE_CASES.length - negFail}/${NEGATIVE_CASES.length} negativos | ${orphan} caso(s) sem nenhum módulo (cairiam no classificador de IA)`);
  await c.end();
}).catch(async e => { console.error('ERRO:', e.message); try { await c.end(); } catch {} process.exit(1); });
