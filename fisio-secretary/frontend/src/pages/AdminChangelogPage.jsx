import { CheckCircle2, Clock, Bug } from 'lucide-react'

// Página estática de status — não puxa dado nenhum do backend de propósito:
// é um resumo curado do que foi feito/decidido, não uma lista que precisa
// ficar sincronizada automaticamente com o banco. Atualizar manualmente
// conforme o trabalho avança (mesma lógica do CLAUDE.md "Pendências Futuras").

const DONE = [
  {
    title: 'Admin pode editar módulo dinâmico de qualquer cliente sem logar como ele',
    date: '03/09/2026',
    detail: 'Nova rota /admin/prompt-modules/:tenantId (guardada por AdminGuard) + edição inline na tela Prompts. Também corrigido: card de módulos e o menu "Módulos (beta)" só apareciam em localhost ou pra uma lista fixa de e-mails de teste — agora aparecem em produção pra qualquer tenant já em prompt_engine=dynamic_modules (afetava a Joelma/Charm\'s Cabelos, que editava o prompt monólito antigo sem efeito nenhum).',
  },
  {
    title: 'Link + QR Code de pagamento na aba Checkout do admin',
    date: '02/09/2026',
    detail: 'Pra divulgar em lives: QR Code (qrcode.react) + botão de copiar link, ambos apontando pro checkout público (app.converthair.com.br/checkout). QR pode ser baixado como PNG.',
  },
  {
    title: 'Limite de vídeo até 40MB liberado só pra Telma (Marcele Blz Hair)',
    date: '01/09/2026',
    detail: 'Catálogo dela tinha vídeos de até 31MB falhando silenciosamente na entrega pelo WhatsApp ("não consegui visualizar"). Limite de upload sobe de 30MB pra 40MB só nesse tenant até o catálogo ser comprimido.',
  },
  {
    title: 'Prompt do Ricardo/Ingrid Hair: handoff pra Ingrid acontecia cedo demais',
    date: '02/09/2026',
    detail: '"Quero fazer um orçamento" (mensagem padrão de anúncio) disparava handoff imediato pra Ingrid, sem qualificar nada — 100% dos leads recentes caíram nisso. Agora essa frase sozinha vira saudação normal; antes de encaminhar, a IA pergunta o método de colocação e pede as 3 fotos (molhado, frente, trás) que a Ingrid sempre acabava pedindo depois.',
  },
  {
    title: 'Soraia Dias Mega Hair: migração pro motor de módulos dinâmicos',
    date: '27/08/2026',
    detail: 'Os 5 agentes do multiagente (Recepção, Avaliação, Preço, Agendamento, Institucional) viraram 1 bloco fixo (Core) + 4 módulos por palavra-chave — mesmo motor já usado pelo S&A e pela Joelma. Conteúdo revisado trazendo correções já validadas em outros clientes: proibição total de cálculo de preço pela IA (o risco dela é "R$ 8,37 por grama" e o adiantamento de 35% — a IA nunca multiplica, sempre remete pra avaliação), ajuste pra "vou confirmar com a equipe" não encerrar mais o atendimento sozinho (antes perguntas simples como "aceita cartão?" desligavam a IA do lead), e regra explícita dizendo que a IA não vê fotos/links enviados pela cliente. Testado com 59 casos de roteamento de palavra-chave + 29 cenários de conversa completa (preço, agendamento, institucional, foto, link, tentativa de manipulação, cliente rude) antes de ativar. Já ativo no WhatsApp real dela — rollback é 1 update no banco.',
  },
  {
    title: 'Áudio visível/tocável no Kanban + foto de perfil do WhatsApp',
    date: '26/08/2026',
    detail: 'Áudio (do lead e do operador) ficava invisível no CRM — só o texto transcrito aparecia, o arquivo original nunca era persistido. Agora o áudio do lead é baixado em paralelo à transcrição e salvo no R2 (toca com player no Kanban); novo botão de microfone grava e envia áudio do operador como nota de voz. Foto de perfil do WhatsApp também passou a ser buscada uma vez e persistida (a URL da uazapi expira em poucos dias). Todos os tenants são beneficiados, sem configuração.',
  },
  {
    title: 'Reconhecimento de imagem desativado (tenant admin/Cabelô)',
    date: '26/08/2026',
    detail: 'Admin relatou que a IA reconhece textura e cor na foto, mas não a origem do cabelo (Brasileiro/Vietnamita/Indiano) — essa origem é rótulo de fornecedor, não característica visual, então nenhum ajuste de prompt resolveria de verdade. Voltou pro fluxo padrão: "ainda não consigo ver imagens, descreve pra mim".',
  },
  {
    title: 'Preço: legenda da mídia vira fonte de verdade (S&A Cabelos Naturais)',
    date: '26/08/2026',
    detail: 'A legenda do vídeo (o que a cliente lê na tela) agora entra no prompt junto com o preço. Antes só o nome do arquivo ia pro prompt, então a IA anunciava um preço no vídeo e cotava outro no texto — chegou a emprestar o preço de um produto pra outro parecido.',
  },
  {
    title: 'Preço: motor de cálculo determinístico por gramatura (S&A Cabelos Naturais)',
    date: '26/08/2026',
    detail: 'A IA errava a própria conta em ~20% das cotações (multiplicação/soma de tela, cartão, desconto). Agora ela só identifica produto/gramatura/forma de pagamento — quem calcula é código, nunca o modelo. Validado com 18 testes unitários + 35/35 turnos corretos contra a API real. Opt-in por tenant (tabela price_configs) — só o S&A usa hoje, sem efeito nos outros clientes.',
  },
  {
    title: 'Agendamento manual por tenant (handoff humano) — Ricardo Alves de Souza',
    date: '25/08/2026',
    detail: 'Switch em Configurações pra desativar o agendamento automático da IA e sempre encaminhar pra humano quando o lead sinalizar agendamento — a IA primeiro entende o dia, depois faz o handoff.',
  },
  {
    title: 'Prompt do S&A: fluxo de colocação sem pergunta redundante',
    date: '25/08/2026',
    detail: 'Lead que já usa mega hair (intenção de colocação) não é mais perguntado "você já usa mega hair?" — vai direto pra oferta de método. Avaliação (online ou presencial) agora faz handoff direto pra Ingrid, sem pedir foto do cabelo.',
  },
  {
    title: 'Envio em massa: placeholder {{nome}} (convertHairCRM)',
    date: '26/08/2026',
    detail: 'Mensagens de campanha/follow-up manual agora aceitam {{nome}} no texto — substitui pelo primeiro nome do lead (o mesmo que aparece no Kanban). Sem nome salvo, cai pra "tudo bem".',
  },
]

const PENDING = [
  { title: 'Provisionar Redis em produção + ligar as filas (BullMQ)', detail: 'Código já deployado, mas QUEUE_ENGINE=legacy-cron em prod por falta de Redis no Railway.' },
  { title: 'Webhook Efí Bank com mTLS', detail: 'Substituiria o polling de PIX por confirmação instantânea — precisa de proxy mTLS de entrada (Nginx/Caddy ou Cloudflare) na frente do Railway.' },
  { title: 'Stripe Live (cartão)', detail: 'Falta configurar credenciais sk_live_, price ID e webhook secret no Railway — código já pronto.' },
  { title: 'Notificações WhatsApp ao vendedor', detail: 'Campo notificationPhone já existe; falta disparar quando stage muda pra lead_quente/agendado/shouldIgnore=true.' },
  { title: 'Lembrete de consulta 1 dia antes (Sofia)', detail: 'Cron diário buscando leads com consulta amanhã, perguntando "sim/não".' },
  { title: 'Follow-up automático por cadência (sem gatilho manual)', detail: 'Base em backend/src/followup/ já pronta — falta o gatilho automático por inatividade.' },
  { title: 'Meta CAPI (Andromeda)', detail: 'Extrair ctwaClid do webhook e enviar evento Lead quando stage=lead_quente.' },
  { title: 'UI de troca de senha pro cliente', detail: 'Endpoint /auth/change-password já existe; falta o formulário em Configurações.' },
  { title: 'Fechar brecha residual do motor de preço (S&A)', detail: 'A IA ainda pode mencionar de forma livre um valor de acréscimo (ex: "no cartão fica +R$75") fora do placeholder — observado correto até agora, mas não é garantido pelo motor. Reforçar prompt se acontecer de novo.' },
  { title: 'Guard-rail de mídia ausente (Niltoncabelos)', detail: 'IA disse "não tenho" pra item sem vídeo mas existente na loja — fix de prompt aplicado; guard-rail em código só se voltar a acontecer.' },
]

const BUGS = [
  {
    title: 'Módulo dinâmico ativo mas sem tela de edição em produção (Joelma)',
    detail: 'Admin editava o prompt "Lindona (Mega Hair)" em Configurações, mas esse campo é ignorado quando prompt_engine=dynamic_modules — dava impressão de "não salvar". Card de módulos e menu ficavam ocultos em produção.',
    status: 'corrigido',
  },
  {
    title: 'Vídeo grande falha silenciosa no envio (Telma/Marcele Blz Hair)',
    detail: 'sendMediaByUrl engolia erro da uazapi sem lançar exceção — vídeo de 21MB era registrado como "enviado" no banco mesmo sem tocar no celular da cliente.',
    status: 'corrigido',
  },
  {
    title: 'Notificação de agendamento disparava mesmo com handoff só por intenção de compra (S&A)',
    detail: 'notifyAppointmentScheduled() ignorava o switch schedulingHandoffEnabled — cliente recebia aviso de "novo agendamento" toda vez que a IA auto-agendava.',
    status: 'corrigido',
  },
  {
    title: 'Preço emprestado de outro produto (S&A Cabelos Naturais)',
    detail: 'Pelo menos 2 leads no mesmo dia (25-26/08) receberam preço de um cabelo diferente do que estava sendo anunciado no vídeo — chegou a acontecer da IA dizer que o preço do próprio anúncio "não corresponde" quando a cliente contestou.',
    status: 'corrigido',
  },
  {
    title: 'Erro aritmético da IA em cotações de gramatura (S&A Cabelos Naturais)',
    detail: 'Multiplicação/soma de preço×gramas, tela, cartão e desconto saindo errada em ~20% dos casos medidos (ex: 389,90×1,5 = 583,35 em vez de 584,85).',
    status: 'corrigido',
  },
  {
    title: 'Follow-up agendado não disparava (raia "qualificado")',
    detail: 'Checkbox por etapa em Alertas estava desmarcado mesmo com o toggle geral ligado — o disparo dependia dos dois.',
    status: 'corrigido',
  },
  {
    title: 'Créditos da OpenAI esgotados (convertHairCRM / convertHairCrmMarcel)',
    detail: 'Chat ao vivo e follow-up pararam de responder por falta de crédito na conta OpenAI — cliente adicionou crédito, confirmado funcionando nos dois projetos.',
    status: 'corrigido',
  },
]

function Section({ icon: Icon, iconClass, title, count, children }) {
  return (
    <section className="mb-8">
      <div className="flex items-center gap-2 mb-3">
        <Icon className={`w-5 h-5 ${iconClass}`} />
        <h2 className="text-base font-semibold text-gray-800">{title}</h2>
        <span className="text-xs text-gray-400 font-medium">({count})</span>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

export default function AdminChangelogPage() {
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Status do projeto</h1>
        <p className="text-sm text-gray-500 mt-1">Resumo curado — implementações feitas, pendências e bugs encontrados. Atualizado manualmente.</p>
      </div>

      <Section icon={CheckCircle2} iconClass="text-emerald-600" title="Implementado" count={DONE.length}>
        {DONE.map((item, i) => (
          <div key={i} className="bg-white border border-gray-100 rounded-lg p-4">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-sm font-semibold text-gray-800">{item.title}</h3>
              <span className="text-xs text-gray-400 whitespace-nowrap">{item.date}</span>
            </div>
            <p className="text-sm text-gray-500 mt-1">{item.detail}</p>
          </div>
        ))}
      </Section>

      <Section icon={Clock} iconClass="text-amber-600" title="Pendente" count={PENDING.length}>
        {PENDING.map((item, i) => (
          <div key={i} className="bg-white border border-gray-100 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-800">{item.title}</h3>
            <p className="text-sm text-gray-500 mt-1">{item.detail}</p>
          </div>
        ))}
      </Section>

      <Section icon={Bug} iconClass="text-red-600" title="Bugs encontrados" count={BUGS.length}>
        {BUGS.map((item, i) => (
          <div key={i} className="bg-white border border-gray-100 rounded-lg p-4">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-sm font-semibold text-gray-800">{item.title}</h3>
              <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-emerald-100 text-emerald-700 whitespace-nowrap">
                {item.status}
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-1">{item.detail}</p>
          </div>
        ))}
      </Section>
    </div>
  )
}
