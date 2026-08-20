/**
 * Teste seco do mapeamento de keywords da Joelma — replica exatamente a
 * lógica de regex do PromptModulesService.selectModules (sem chamar IA).
 * Cada caso declara quais módulos DEVEM carregar; falha se faltar algum.
 */
const { Client } = require('pg');
const fs = require('fs');
const url = fs.readFileSync(__dirname + '/../.env', 'utf8').match(/SUPABASE_DATABASE_URL=(.*)/)[1].trim();
const TENANT = 'cb994ad4-6478-4e23-b30a-6b4953696ec9';

// msg, [modulos obrigatorios]
const CASES = [
  // ---- catálogo / produtos ----
  ['Quero Jumbo',                                   ['Catálogo & Links']],
  ['Tem rabo orgânico?',                            ['Catálogo & Links']],
  ['Quero ver Tic Tac Bio',                         ['Catálogo & Links']],
  ['quero uma lace humana',                         ['Catálogo & Links']],
  ['tem lace grisalha?',                            ['Catálogo & Links']],
  ['quero cabelo bio',                              ['Catálogo & Links']],
  ['tem front lace repartição livre?',              ['Catálogo & Links']],
  ['vocês tem nina softex',                         ['Catálogo & Links']],
  ['quero french curl braids',                      ['Catálogo & Links']],
  ['tem afro puff',                                 ['Catálogo & Links']],
  ['queria ver o miojão',                           ['Catálogo & Links']],
  ['tem xuxinha?',                                  ['Catálogo & Links']],
  ['me manda o catálogo',                           ['Catálogo & Links']],
  ['quero topo humano',                             ['Catálogo & Links']],
  ['tem bio humano liso 75 preto?',                 ['Catálogo & Links']],
  ['quero ondulado 85 cor 27',                      ['Catálogo & Links']],
  ['tem cacheado castanho?',                        ['Catálogo & Links']],
  ['queria ver as opções de crochet',               ['Catálogo & Links']],
  ['tem microlink?',                                ['Catálogo & Links']],
  ['vende agulha peixinho?',                        ['Catálogo & Links']],
  ['tem cola pra lace',                             ['Catálogo & Links']],
  ['quero ver fotos',                               ['Catálogo & Links']],
  // ---- preço ----
  ['quanto custa a lace wig orgânica?',             ['Catálogo & Links', 'Preço & Pagamento']],
  ['qual o valor do jumbo',                         ['Catálogo & Links', 'Preço & Pagamento']],
  ['quanto é o topo de fibra',                      ['Catálogo & Links', 'Preço & Pagamento']],
  ['aceita cartão?',                                ['Preço & Pagamento']],
  ['pode parcelar em 3x?',                          ['Preço & Pagamento']],
  ['qual a chave pix',                              ['Preço & Pagamento']],
  ['tem desconto?',                                 ['Preço & Pagamento']],
  ['tá caro',                                       ['Preço & Pagamento']],
  ['aceita boleto?',                                ['Preço & Pagamento']],
  ['quanto sai o kit 3 telas',                      ['Preço & Pagamento']],
  ['formas de pagamento',                           ['Preço & Pagamento']],
  // ---- serviços ----
  ['vocês colocam mega hair?',                      ['Serviços & Aplicação']],
  ['vocês fazem ponto americano?',                  ['Serviços & Aplicação']],
  ['quanto custa pra colocar',                      ['Serviços & Aplicação', 'Preço & Pagamento']],
  ['quero fazer um alongamento',                    ['Serviços & Aplicação']],
  ['vocês fazem tranças?',                          ['Serviços & Aplicação']],
  ['quais métodos vocês trabalham',                 ['Serviços & Aplicação']],
  ['me explica como funciona o entrelace',          ['Serviços & Aplicação']],
  ['vocês vendem mega hair?',                       ['Serviços & Aplicação']],
  ['qual técnica agride menos',                     ['Serviços & Aplicação']],
  // ---- institucional ----
  ['qual o valor do frete?',                        ['Institucional']],
  ['vocês enviam pra todo Brasil?',                 ['Institucional']],
  ['qual o prazo de entrega',                       ['Institucional']],
  ['qual o endereço de vocês',                      ['Institucional']],
  ['onde fica a loja',                              ['Institucional']],
  ['vocês atendem sábado?',                         ['Institucional']],
  ['qual horário de funcionamento',                 ['Institucional']],
  ['vocês abrem que horas',                         ['Institucional']],
  ['isso é confiável? tenho medo de golpe',         ['Institucional']],
  ['qual o instagram de vocês',                     ['Institucional']],
  ['posso retirar na loja?',                        ['Institucional']],
  ['como faço pra rastrear',                        ['Institucional']],
  // ---- fechamento ----
  ['quero comprar',                                 ['Fechamento & Transferência']],
  ['vou levar esse',                                ['Fechamento & Transferência']],
  ['pode separar pra mim?',                         ['Fechamento & Transferência']],
  ['quero marcar pra terça',                        ['Fechamento & Transferência']],
  ['tem vaga às 14h?',                              ['Fechamento & Transferência']],
  ['quero falar com um atendente',                  ['Fechamento & Transferência']],
  ['quero agendar',                                 ['Fechamento & Transferência']],
  ['gostei desse',                                  ['Fechamento & Transferência']],
  ['quero finalizar meu pedido',                    ['Fechamento & Transferência']],
  ['posso ir amanhã?',                              ['Fechamento & Transferência']],
  // ---- armadilhas de acento / \b (regressao) ----
  ['amanhã eu passo aí',                            ['Fechamento & Transferência']],
  ['vou na terça',                                  ['Fechamento & Transferência']],
  ['como faço pra rastrear meu pedido',             ['Institucional']],
  ['qual endereço?',                                ['Institucional']],
  ['quais opções de acessórios?',                   ['Catálogo & Links']],
  ['vocês tem vídeo?',                              ['Catálogo & Links']],
  ['tem em promoção?',                              ['Preço & Pagamento']],
  ['qual o preço?',                                 ['Preço & Pagamento']],
  ['é confiável comprar com vocês?',                ['Institucional']],
  ['que método vocês usam?',                        ['Serviços & Aplicação']],
  ['vocês fazem aplicação?',                        ['Serviços & Aplicação']],
  ['quero ver a repartição livre',                  ['Catálogo & Links']],
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
  console.log(`\n${CASES.length - fail}/${CASES.length} passaram | ${orphan} caso(s) sem nenhum modulo (cairiam no classificador de IA)`);
  await c.end();
}).catch(async e => { console.error('ERRO:', e.message); try { await c.end(); } catch {} process.exit(1); });
