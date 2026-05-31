# fisio-secretary — Contexto para o Claude

## ✅ Multi-Tenant SaaS — CONCLUÍDO (31/05/2026)

**Objetivo:** transformar o sistema (hoje 1 cliente) em SaaS pronto pra ~10 clientes com isolamento total. ✅ IMPLEMENTADO E DEPLOYADO.

**⚠️ ARQUITETURA DE ISOLAMENTO:** Um banco PostgreSQL (Supabase), cada cliente é uma linha em `whatsapp_config` com `id` único. Todas as tabelas de dados levam `tenant_id` (FK pra whatsapp_config.id). Cada requisição HTTP filtra automaticamente: `SELECT * FROM leads WHERE tenant_id = '{JWT.tenantId}'`. JWT contém o tenantId, garante isolamento no backend.

**Tenant atual (único cliente):** Wendel da Cabelô → `whatsapp_config.id = 2c562828-0fe9-43c8-bad0-77a931968afc`
**Decisão de arquitetura:** `tenantId` = `whatsapp_config.id`. Webhook identifica tenant pela **URL** (`POST /webhooks/uazapi/:tenantId`) — Opção A escolhida.

### ✅ JÁ FEITO (local, sem commit)

**Autenticação JWT (login real, hardcode removido) — FUNCIONANDO, testado local:**
- Backend: `backend/src/auth/` (auth.module, auth.service, auth.controller, users.service, jwt.strategy, jwt-auth.guard, current-user.decorator)
- Entidade `User` (`backend/src/common/entities/user.entity.ts`): email, passwordHash (bcryptjs), name, **tenantId**, role (admin|operator), isActive
- `POST /auth/login` → retorna `{ access_token, user }`; `GET /auth/me` (protegido) reidrata sessão
- JWT expira em 7 dias, secret = `JWT_SECRET` do .env
- Seed idempotente no boot (`UsersService.onApplicationBootstrap`): cria admin a partir de `SEED_ADMIN_EMAIL` + `SEED_ADMIN_PASSWORD` (+ `SEED_ADMIN_TENANT_ID`) se não existir
- `AuthModule` registrado no `app.module.ts` + `User` no array de entities
- Frontend: `frontend/src/context/AuthContext.jsx` (token no localStorage, persiste no refresh via /auth/me), `authFetch` exportado de `services/api.js` (injeta Bearer + trata 401 → /login), `LoginPage.jsx` real (sem demo), `App.jsx` com AuthProvider + rotas protegidas + Navigate, Layout já tinha `onLogout`
- `api.js` (23 chamadas), `MediaPage.jsx` e `SettingsPage.jsx` → todas usam `authFetch`
- Deps instaladas: `@nestjs/jwt @nestjs/passport passport passport-jwt bcryptjs @types/passport-jwt`
- **.env já configurado:** `SEED_ADMIN_EMAIL=bbfagner2222@gmail.com`, `SEED_ADMIN_PASSWORD=12345`, `SEED_ADMIN_TENANT_ID=2c562828-...` (⚠️ senha fraca, trocar antes de prod)
- **Tabela `users` já criada no banco de PROD** (synchronize rodou no teste local) + admin seedado

**Item 1 — Fase 1 (schema, parcial):**
- `tenant_id` (uuid, nullable) adicionado em: `Lead`, `Campaign`, `MediaFile`, `DeletedLead` (entidades)
- `MediaFile.name` e `Lead.phone` são unique GLOBAL hoje → viram compostos `(tenant_id, X)` na Fase 3
- Conversation/Message/LeadStageHistory/Appointment NÃO levam tenant_id (isolamento transitivo via lead_id)
- SQL de backfill + constraints pronto em: `backend/migrations/multi-tenant-phase2-3.sql` (NÃO rodado ainda)

### ✅ A) Login fechado — rotas protegidas (FEITO 30/05, testado runtime)
`@UseGuards(JwtAuthGuard)` em leads/media/bulk-message/appointments/admin/instance (classe) e em `/webhooks/manual` + `/manual-media` (método). Webhooks uazapi/whatsapp e `GET /` ficam abertos. Testado: GET /leads sem token → 401, com token → 200, webhook → 201.

### ✅ B) Isolamento por tenant (FEITO 30/05, compila + build ok)
- `evolution.controller`: rota `POST /webhooks/uazapi/:tenantId`, fila/`lastMessageWasAudio` com chave `${tenantId}:${phone}`, `processMessage(tenantId,...)`, **token da instância do tenant em TODOS os envios** (sendText/sendMedia/typing/transcribe/applyTags). Meta webhook usa tenant default via `get()`.
- `whatsapp-config.service`: `getByTenant(tenantId)` + `getTokenByTenant(tenantId)`; webhook URL agora `/webhooks/uazapi/{id}` (createNewInstance + setupAfterConnect salvam record primeiro pra ter o id)
- `leads.service`: `findOrCreate(phone, tenantId, ...)`, todas queries de coleção filtradas (findAll/findByPhones/findDeleted/getDashboard); métodos por-id com `tenantId` opcional + `assertLeadTenant`
- `media.service`, `bulk-message.service`, `appointments.service`: scopados por tenant; `Appointment` ganhou `tenant_id`
- Controllers frontend (leads/media/bulk-message/appointments/instance) leem `@CurrentUser('tenantId')`
- `LeadsGateway`: salas por tenant (`tenant:{id}`), socket autentica via JWT no handshake; frontend `useLeads.js` manda `auth.token`. AuthModule exporta JwtModule, LeadsModule importa AuthModule.

**🔴 PASSOS OPERACIONAIS CRÍTICOS ao rodar/deployar este código:**
1. **BACKFILL JÁ FEITO ✅** (30/05 via REST): leads=58, campaigns=8, media_files=7, deleted_leads=52, appointments=14 → todos no tenant Wendel. Zero NULL. (Se criar tabela nova/ambiente novo, rodar `multi-tenant-phase2-3.sql` Fase 2.)
2. **Rota de webhook de compatibilidade ADICIONADA ✅**: `POST /webhooks/uazapi` (sem tenant) continua existindo e resolve o tenant default → **deploy NÃO quebra as mensagens do Wendel** (a uazapi dele posta na URL antiga e funciona). Rota nova `POST /webhooks/uazapi/:tenantId` para instâncias novas. Reconfigurar o webhook do Wendel pra URL com tenant é opcional/sem pressa.
3. Appointments: `synchronize` adiciona `tenant_id` no boot (já sincronizado no teste local).
4. Antes do deploy: trocar a senha fraca `12345` do admin + garantir `SEED_*` e `JWT_SECRET` no Railway. O admin `bbfagner2222@gmail.com` já existe no banco de prod (seed rodou no teste local).

### ⏳ FALTA FAZER

**Refinamentos B (menor prioridade):** admin.controller (createNewInstance) ainda usa `get()`; deleteRecord/markDisconnected/setupAfterConnect operam no config único (ok p/ 1 tenant, revisar no onboarding multi-tenant).

### ✅ Ambiente de DEV isolado (FEITO 30/05)
- Postgres local via Docker: serviço `postgres_dev` no docker-compose (porta **5433**, isolado da prod)
- `.env.development` (raiz + symlink em backend/, gitignored): `SUPABASE_DATABASE_URL=postgresql://fisio:fisio_dev@localhost:5433/fisio_dev`, `DATABASE_SSL=false`, seed `dev@local.com`/`dev123`, `SEED_ADMIN_TENANT_ID` vazio
- `app.module.ts`: `envFilePath: process.env.ENV_FILE || '.env'` + SSL condicional (`DATABASE_SSL==='false'` → sem SSL)
- Script `npm run start:dev:local` (ENV_FILE=.env.development, banco local). `npm run start:dev` continua na PROD.
- Fix seed: `SEED_ADMIN_TENANT_ID` vazio → `null` (coluna uuid rejeita "")
- **Fluxo de trabalho:** desenvolve/testa no dev → valida → aplica em prod. NUNCA testar migration direto em prod.
- ⚠️ Mídia (Supabase Storage) no dev ainda aponta pro bucket de prod (banco isolado, Storage não)

### ✅ C) Migrations — synchronize desligado (FEITO 30/05, validado no DEV)
- `backend/data-source.ts`: DataSource do CLI (lê `ENV_FILE` via dotenv, `migrations: ['src/migrations/*.ts']`, synchronize false)
- Scripts: `migration:generate`, `migration:run`, `migration:revert` (via `typeorm-ts-node-commonjs`)
- `app.module.ts`: **`synchronize: false`** 🔴 (nunca reativar em prod)
- Migrations criadas em `backend/src/migrations/`:
  - `InitialSchema` — schema completo (baseline)
  - `TenantConstraints` — Fase 3: `SET NOT NULL` em tenant_id (leads/campaigns/media_files/deleted_leads) + DROP unique global de phone/name + CREATE unique composto `(tenant_id,phone)` e `(tenant_id,name)`
- Validado no dev: banco vazio → `migration:run` constrói tudo → app sobe + login OK
- Entidades atualizadas: `Lead`/`MediaFile` com `@Index(unique)` composto + tenantId não-nullable; Campaign/DeletedLead tenantId não-nullable (Appointment segue nullable)

**🔴 APLICAR EM PROD (abordagem A — baseline; fazer no deploy, NÃO antes):**
1. `pg_dump "<SUPABASE_DIRECT_URL>" > backup-prod-AAAA-MM-DD.sql` (backup local — funciona no free tier)
2. **NÃO rodar InitialSchema em prod** (schema já existe). Marcar como aplicada inserindo o registro:
   `INSERT INTO migrations (timestamp, name) VALUES (<timestamp-do-arquivo>, 'InitialSchema<timestamp>');`
   (criar a tabela `migrations` antes se não existir — `migration:run` cria, mas com a InitialSchema já marcada ele pula pra próxima)
3. Rodar **só a TenantConstraints** em prod (`migration:run`) — backfill já feito ✅, então NOT NULL + unique composto passam
4. Deploy do backend com `synchronize: false` + release command `migration:run`
5. Fluxo futuro: alterou entidade → `migration:generate -- src/migrations/Nome` → revisa SQL → testa no dev → deploy roda em prod

**(Antigo) C) Item 3 — migrations:**
- Desligar `synchronize: true` no `app.module.ts:30` → `false`
- Criar datasource.ts + migrations TypeORM, rodar `migration:run` no deploy do Railway
- Rodar o SQL `multi-tenant-phase2-3.sql` (backfill + unique composto + NOT NULL) — fazer backfill ANTES de trocar constraint

### ✅ D1) Onboarding via painel admin (FEITO 30/05, backend validado no DEV)
Modelo de negócio: site com planos → paga (Stripe/Kiwify, a decidir) → cria conta. R$800 de implementação assistida (Fagner conecta WhatsApp + prompt + overview). Só quem pagou acessa.
- **Backend:**
  - `AdminGuard` (`auth/admin.guard.ts`) — exige `role==='admin'`. Usar `@UseGuards(JwtAuthGuard, AdminGuard)`
  - `WhatsappConfigService.createTenant(name)` — cria linha NOVA (não reusa get()) + `setActive` + `updateBilling`
  - `admin.controller` (guard admin): `POST /admin/clients` (cria tenant+user), `GET /admin/clients` (lista + status/leads/users count), `PATCH /admin/clients/:id/active` (suspende/reativa), `PATCH /admin/clients/:id/billing`
  - `auth.service.validateUser`: bloqueia login se tenant `isActive=false` (admin nunca é bloqueado) → "Conta suspensa"
  - `POST /auth/change-password` (usuário troca a própria senha)
  - Campos novos em `whatsapp_config`: `display_name`, `is_active` (default true), `next_payment_date`, `billing_phone` → migration `ClientManagement` (rodada no dev)
- **Frontend:** `AdminPage.jsx` (rota `/admin`, item "Clientes" no menu só p/ role=admin): lista clientes, criar (mostra credenciais p/ repassar), suspender/reativar, editar data de vencimento (badge "vence em Xd" destacado ≤5 dias). API em `api.js` (getClients/createClient/setClientActive/updateClientBilling/changePassword).
- **Decisões aplicadas:** (A) admin define senha inicial + cliente troca depois; (B) suspensão MANUAL pelo admin + `nextPaymentDate` com alerta visual no painel; (C) `bbfagner2222` segue tenant=Wendel.
- ✅ Testado no dev: criar cliente → login do cliente (board vazio/isolado) → suspender (login 401) → reativar → trocar senha.
- ✅ **Instância uazapi por-tenant (fechado 30/05):** `createNewInstance(name,...,tenantId)`, `setupAfterConnect/markDisconnected/deleteRecord(tenantId)` todos tenant-scoped. Novo `POST /instance` (per-tenant, cria instância pro tenant logado + webhook `/webhooks/uazapi/{tenantId}`). instance.controller passa token do tenant em connect/status/disconnect/reset. SettingsPage "Criar conexão" agora chama `POST /instance` (não mais `/admin/instance`). **Cadeia de conversa completa pra cliente novo** — só testável em PROD (uazapi externa + webhook precisa alcançar o servidor; NÃO testar "Criar conexão" no dev pois usa as keys reais da uazapi).

### ✅ D1a) Reset de Senha do Admin (FEITO 31/05)
- **Backend:** `PATCH /admin/clients/:id/reset-password` → reseta senha de TODOS os usuários do tenant (exige admin + body: `{ newPassword }`)
- **Frontend:** `AdminPage.jsx` → botão KeyRound em cada cliente card → modal com input de nova senha
- **Fluxo:** admin define nova senha → cliente recebe via credencial inicial → cliente troca depois em `/auth/change-password`
- **Testado:** reset funcionando no dev, frontend builda ok

### ✅ D1b) Lembrete de Vencimento Mensal (FEITO 31/05)
- **Campo novo:** `billingDay` (1-31) em `whatsapp_config` → Migration `AddBillingDay`
- **Cron:** `BillingReminderService` roda diário às 9h (SP) → verifica se hoje é 5 dias antes do próximo vencimento mensal → envia WhatsApp
  - Ex: `billingDay=5` (vence dia 5) → lembrete no dia 31 do mês anterior (5 dias antes) às 9h
  - Calcula corretamente meses curtos + próximos meses quando dia já passou
- **Envio:** do seu número (`27996972230`, via instância do tenant admin) para o `billingPhone` do cliente
- **Frontend:** campo "Vence dia X de cada mês" (input 1-31) + badge com próxima data + dias restantes (amarelo ≤5d)
- **Teste:** `POST /admin/billing/test-reminder` dispara manualmente (só admin), testado e recebeu mensagem no celular ✅
- **Variáveis de env:** `BILLING_SENDER_TENANT_ID=dd9afde1-...` (seu tenant), `BILLING_SENDER_TOKEN=...` (override token, só pro dev)

**⏳ FALTA NO D1 (muito pequeno):**
1. **UI de trocar senha** pro cliente (endpoint `/auth/change-password` pronto; falta um form, ex: na SettingsPage — pode ir num card de conta/perfil)

**D2) Pagamento (depois):** site de planos → checkout Kiwify/Stripe → webhook cria/libera conta + suspende quem não paga (usa o `isActive` já pronto). Ver [[project-kiwify-checkout]].

### ✅ Veredito pra 10 clientes
**A+B+C+D1 — ✅ TUDO PRONTO E DEPLOYADO (31/05/2026):**
- ✅ Dados isolados por tenant (tenant_id FK)
- ✅ Login JWT real (sem hardcode)
- ✅ Admin painel: criar clientes, suspender, reset de senha, lembrete de vencimento
- ✅ Instância uazapi por cliente + webhook próprio
- ✅ Migrations aplicadas (synchronize=false)
- ✅ Dev isolado funcionando (postgres_dev local)

**Próximo:** D2 (pagamento via Stripe/Kiwify) automatiza a entrada de novos clientes e suspensão por inadimplência (usa isActive já pronto).

---

## O que é este projeto

Secretária virtual com IA (Sofia) para clínica de fisioterapia. Recebe mensagens WhatsApp via uazapi, qualifica leads automaticamente usando Claude, e exibe um Kanban em tempo real para o operador.

---

## Stack

- **Backend:** NestJS 11, TypeORM, PostgreSQL (Supabase), Redis
- **Frontend:** React + Vite + shadcn/ui + Socket.io
- **IA (chat/funil — Lindona):** Google Gemini 2.5 Flash (`gemini-2.5-flash`) via endpoint OpenAI-compatível — billing ativo (30/05/2026). Pool de failover em runtime: `GEMINI_API_KEY` → `OPENAI_API_KEY` (gpt-4o-mini). Cache implícito ativo: ~99% dos tokens de input são cacheados (75% desconto) → custo ~R$41/mês pra 2.000 leads. Branches alternativas preservadas: `feat/gemini` (Gemini isolado), `feat/openrouter` (Qwen 2.5 72B + Llama 3.3 70B).
- **IA (Claude):** removida em 29/05/2026 — agente Sofia/fisioterapia removido, apenas Lindona (MegaHair) permanece.
- **STT:** OpenAI Whisper (transcrição automática via uazapi OU manual via Meta API)
- **TTS:** Google Cloud Text-to-Speech (voz pt-BR-Neural2-C, feminina)
- **WhatsApp:** Modular via `IWhatsAppProvider` interface — uazapi (R$ 29/mês) OU Meta Official API (badge verde + compliance)
  - Switching em runtime via `WHATSAPP_PROVIDER` env var (sem recompilação)
  - Strategy Pattern + Factory pattern em NestJS
- **Infra:** Docker (apenas Redis), Backend/Frontend em localhost

---

## Estrutura de pastas relevante

```
fisio-secretary/
├── backend/src/
│   ├── evolution/
│   │   ├── evolution.controller.ts                 ← webhook POST /webhooks/{uazapi,whatsapp} + processMessage() privado
│   │   ├── evolution.service.ts                    ← wrapper para IWhatsAppProvider (sendTextMessage, sendAudioMessage, etc)
│   │   ├── message-queue.service.ts                ← debounce de 10s por phone, callback-based
│   │   ├── providers/
│   │   │   ├── whatsapp-provider.interface.ts      ← interface abstrata para qualquer provider
│   │   │   ├── uazapi.provider.ts                  ← implementação uazapi
│   │   │   └── meta.provider.ts                    ← implementação Meta Official API
│   │   └── evolution.module.ts                     ← factory que seleciona provider via WHATSAPP_PROVIDER env
│   ├── audio/
│   │   ├── audio.service.ts          ← transcribe() via Whisper, textToSpeech() via Google Cloud TTS
│   │   └── audio.module.ts
│   ├── ai/
│   │   ├── ai.service.ts             ← processMessage(), buildUpdatedContext(), buildSystemPrompt()
│   │   └── ai.module.ts
│   ├── leads/
│   │   ├── leads.service.ts          ← findOrCreate, saveMessage, updateStage, toggleAi, getAiEnabled
│   │   ├── leads.controller.ts       ← GET /leads, GET /leads/:id/conversation, PATCH /leads/:id/ai
│   │   └── leads.module.ts
│   ├── common/entities/
│   │   ├── lead.entity.ts
│   │   ├── conversation.entity.ts    ← campo aiEnabled (boolean, default true)
│   │   ├── message.entity.ts
│   │   ├── lead-stage-history.entity.ts
│   │   └── appointment.entity.ts
│   └── app.module.ts
├── COMANDOS.md                       ← comandos para rodar o projeto
├── .env                              ← variáveis de ambiente
└── docker-compose.yml
```

---

## Configuração do projeto

### Claude Code Settings (`.claude/settings.local.json`)
- **Model:** Haiku 4.5 para todas as operações (mais econômico para git operations)
  - Quando você pedir em linguagem natural para subir alterações ("commit e push", "suba as mudanças", etc), Claude usa Haiku automaticamente para processar e executar

---

## Fluxo atual (implementado e testado)

```
Webhook recebe msg (texto ou áudio)
  → filtra msgs antigas (>5min ignoradas)
  → deduplicação por messageid
  → se áudio (type=media + mediaType in [audio,ptt,myaudio]): transcribeAudio() via uazapi → enfileira texto
  → MessageQueueService.enqueue() → retorna {ok:true} imediatamente
  → após 10s de silêncio: callback dispara processMessage()
  → getAiEnabled() — se false, salva msg e notifica frontend (operador assume)
  → sendTypingIndicator() — mostra "digitando..." no WhatsApp
  → AiService.processMessage() com buildSystemPrompt(lead)
  → atualiza Lead (stage, temperature, fields)
  → se última msg era áudio: AudioService.textToSpeech() → sendAudioMessage(type=ptt)
  → se última msg era texto: sendTextMessage()
  → salva msg outbound → emite WebSocket
```

A IA (Sofia) responde JSON:
```json
{
  "reply": "...",
  "stage": "qualificando",
  "temperature": "quente",
  "action": "schedule|cancel|reschedule|none",
  "appointmentDateTime": "2026-04-03T14:00:00",
  "fields": { "name": "...", "symptoms": "...", "urgency": "alta", ... }
}
```

Stages: `novo_lead → qualificando → lead_quente | lead_frio → agendado → convertido | perdido`

Score de temperatura: urgência alta (+40), orçamento ok (+30), disponibilidade em 3 dias (+20), nome (+10) → ≥70 quente, 40-69 morno, <40 frio

---

## Status das fases

- **Fase 1:** ✅ Concluída — Docker Compose, infra, WhatsApp conectado
- **Fase 2:** ✅ Concluída — Backend core, webhook, leads, eco bot
- **Fase 3:** ✅ Concluída e testada — IA Sofia integrada com Claude, fluxo de qualificação e agendamento funcionando
- **Fase 4:** ✅ Concluída — Frontend Kanban integrado com backend e WebSocket
- **Fase 5:** ✅ Concluída — Toggle IA por lead, envio manual pelo operador, histórico de stages, stats no header
- **Fase 6:** ✅ Concluída — Mensagens de áudio: STT via uazapi + TTS via Google Cloud (voz pt-BR-Neural2-C)
- **Fase 7:** ✅ Concluída — Migração Evolution API → uazapi (11/04/2026)
- **Fase 8:** ✅ Concluída — Envio em Massa com Sidebar (11/04/2026)
- **Fase 9:** ✅ Concluída — Meta Official API modular + provider switching (29/04/2026)
- **Fase 10:** ✅ Concluída — Migração LLM para Gemini 2.5 Flash + pool de failover + cache implícito (29-30/05/2026)

---

## Funcionalidades implementadas (29-30/05/2026 — Fase 10)

### Pool de LLMs com Failover em Runtime

**Arquitetura (`ai.service.ts`):**
- `LlmProvider` interface: `{ name, client, model, isGemini }`
- Lista `providers[]` montada no constructor pelos env vars presentes
- `callLLM(systemPrompt, messages)` — tenta providers em ordem; se um falha (429/5xx/timeout), passa pro próximo na mesma requisição. Cliente nunca vê erro.
- `reasoning_effort: 'none'` aplicado só quando `isGemini=true` (gpt-4o-mini rejeita esse param)
- `response_format: { type: 'json_object' }` em todos os providers

**Pool atual (main):** `GEMINI_API_KEY` → `OPENAI_API_KEY` (gpt-4o-mini)
**Branches alternativas:**
- `feat/gemini` — Gemini isolado (estado antes do OpenRouter)
- `feat/openrouter` — Qwen 2.5 72B + Llama 3.3 70B (testado, custo ~R$187/mês, encoding PT-BR do Llama problemático em prompts grandes)

**Trocar providers:** basta comentar/descomentar as env vars no `.env` e Railway. Sem recompilação.

---

### Cache Implícito do Gemini 2.5 Flash

**Como funciona:**
- Gemini cacheia automaticamente prefixos de prompt que se repetem entre chamadas
- 75% de desconto nos tokens cacheados
- Não requer código extra — acontece automaticamente quando o mesmo prefixo é enviado

**Resultado em produção:** 99% dos tokens de input cacheados → custo ~R$41/mês pra 2.000 leads/mês

**Condição crítica para o cache funcionar:** o bloco variável (`buildDateBlock` — muda toda hora) deve ficar no **final** do systemPrompt, não no início. Se ficar na frente, quebra o prefixo e o cache não funciona.

```typescript
// CORRETO — estático na frente, variável no final:
const systemPrompt = `${basePrompt}\n\n${mediaInstructions}${JSON_FORMAT}\n\n${buildDateBlock()}`;

// ERRADO — variável na frente quebra o cache:
const systemPrompt = `${buildDateBlock()}\n\n${basePrompt}...`;
```

**Log de cache hit no Railway:**
```
[LINDONA] 💰 Cache hit: 4992 tokens cacheados de 5059 input (99% do input)
```

---

### Correções críticas do Gemini 2.5 Flash

**3 ajustes obrigatórios que o Gemini exige (gpt-4o-mini não precisava):**
1. `response_format: { type: 'json_object' }` — Gemini retorna texto livre sem isso
2. `reasoning_effort: 'none'` — Gemini gasta tokens "pensando" antes da saída, estourava `max_tokens` e truncava o JSON. Desativar resolve (tarefa de extração não precisa de raciocínio)
3. Catálogo de mídia sem `formatDisplay` — Gemini é mais "criativo" e inventava nomes de mídia. Prompt mostra nomes do banco diretamente. `findByName` tem fallback case-insensitive

---

### Saudação por Período do Dia

**Problema:** prompt customizado do banco tinha `"Bom dia/Boa tarde/Boa noite"` como exemplo. Gemini copiava literalmente com as barras.

**Solução em `buildDateBlock()`:**
```typescript
const currentHour = parseInt(new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', hour12: false }).format(now), 10);
const greeting = currentHour < 12 ? 'Bom dia' : currentHour < 18 ? 'Boa tarde' : 'Boa noite';
// Injetado no buildDateBlock:
// SAUDAÇÃO CORRETA AGORA: "Boa noite" — use EXATAMENTE "Boa noite". NUNCA escreva as três com barras.
```

**Instrução pro prompt customizado:** usar `[SAUDAÇÃO CORRETA AGORA]` como placeholder em vez de hardcodar as três opções.

---

### Retry no Envio uazapi

**Problema:** uazapi retornava `"host not mapped"` (HTTP 404) intermitentemente por instabilidade de roteamento. Mensagem era perdida.

**Solução (`uazapi.provider.ts`):** método `postWithRetry()` — tenta até 3x com 1.5s entre tentativas em erros transitórios (`host not mapped`, 5xx, 429, timeout/rede). Aplicado em `sendTextMessage`, `sendAudioMessage` e `sendMediaByUrl`. Erros não-transitórios (401/403) falham na hora.

---

### Sanitização de Null Bytes

**Problema:** alguns modelos (Llama, Qwen) geravam bytes nulos (`\x00`) na resposta. PostgreSQL rejeita com `invalid byte sequence for encoding "UTF8": 0x00`.

**Solução:**
- `ai.service.ts`: `raw = raw.replace(/\x00/g, '')` antes de parsear + `parsed.reply = parsed.reply.replace(/\x00/g, '')`
- `leads.service.ts` → `saveMessage()`: `content?.replace(/\x00/g, '') ?? ''`

---

### Busca de Lead no Kanban

**Implementado em `KanbanPage.jsx`:**
- Input de busca no header (por número ou nome)
- Lead encontrado destacado com borda teal + ring
- Leads não encontrados ficam opacos (opacity 0.3)
- Badge mostra em qual raia o lead está
- Botão "Ver lead" abre modal para mover de raia
- Busca por telefone: normaliza dígitos, só busca por número se a query tiver dígitos (evita false positives com string vazia)

---

## Funcionalidades implementadas (29/04/2026 — Fase 9)

### Meta Official API — Integração Modular
- **Objetivo:** Oferecer alternativa à uazapi com badge verde no WhatsApp + compliance oficial
- **Arquitetura:** Strategy Pattern com `IWhatsAppProvider` interface
  - `UazapiProvider` — implementação existente (sem modificações)
  - `MetaProvider` — implementação nova para Meta Official API
  - Factory pattern em `evolution.module.ts` — seleciona provider via `WHATSAPP_PROVIDER` env var
- **Switching em tempo de execução:** `WHATSAPP_PROVIDER=meta` ou `WHATSAPP_PROVIDER=uazapi` no `.env`
  - Muda ALL operations: webhooks, envio de texto/áudio, transcrição, indicador de digitação
  - Sem recompilação necessária
- **MetaProvider endpoints:**
  - Webhook verificação: `GET /webhooks/whatsapp` (desafio Meta com hub.challenge)
  - Webhook mensagens: `POST /webhooks/whatsapp` (recebe whatsapp_business_account events)
  - Envio de texto: `POST /v20.0/{phoneNumberId}/messages` com estrutura `messaging_product: whatsapp`
  - Envio de áudio: 2 passos (upload media → enviar com media_id)
  - Transcrição manual: via OpenAI Whisper (Meta não auto-transcribe como uazapi)
- **Normalização de telefone brasileiro:** Bug descoberto — Meta retorna `wa_id` com 12 dígitos para Brasil (ex: `557192867765`) mas requer 13 dígitos (ex: `5571992867765`) com o 9 do celular após DDD. Implementado `normalizePhone()` method que detecta automaticamente
- **Typing indicator:** `sendTypingIndicator()` é no-op para Meta (não suporta)
- **Credenciais (modo teste — expiram em 24h):**
  ```
  WHATSAPP_PROVIDER=meta
  WHATSAPP_TOKEN=<token_teste_24h>
  WHATSAPP_PHONE_NUMBER_ID=1120226561170130
  WHATSAPP_BUSINESS_ACCOUNT_ID=2225551044850204
  WHATSAPP_VERIFY_TOKEN=my_webhook_verify_token_kanbam
  ```
- **Próximos passos para produção:**
  1. Comprar número brdid (R$ 28,30/mês) → recebe código de verificação no painel
  2. Registrar número no painel Meta → gera novo WHATSAPP_PHONE_NUMBER_ID
  3. Criar System User em business.facebook.com (token permanente — não expira em 24h)
  4. Gerar token permanente do System User → atualiza WHATSAPP_TOKEN
  5. Assinar webhook WABA via API: `curl -X POST "https://graph.facebook.com/v20.0/{WABA_ID}/subscribed_apps"`
  6. Testar com número real — qualquer pessoa pode mandar mensagem

---

## Funcionalidades implementadas (11/04/2026 — Fase 8)

### Envio em Massa com Sidebar
- **Layout.jsx:** sidebar colapsável com navegação principal (Kanban + Envio em Massa)
  - Logo Sofia no header
  - Items com ícones (LayoutDashboard, Send)
  - Botão logout no rodapé
  - Transição suave ao recolher (w-16 vs w-56)
- **BulkMessagePage.jsx:** sistema completo de envio em massa com 3 abas
  - **Aba Manual:** lista de números (um por linha), interpolação de variáveis {telefone}
  - **Aba Leads do Sistema:** filtro por stage + temperatura, seleção individual/em massa, interpolação com {nome} e {telefone}
  - **Aba Histórico:** polling a cada 5s, status detalhado (scheduled/sending/paused/done), preview da mensagem, modal com detalhes por destinatário
- **BulkMessageService:** integração completa com uazapi
  - `POST /sender/advanced` — envia campanha com delay 5-15s entre mensagens
  - `GET /sender/listfolders` — sincroniza status de campanhas ativas
  - `POST /sender/listmessages` — retorna detalhes por destinatário (número, status, timestamp)
  - `POST /sender/edit` — controla campanha (stop/continue/delete)
- **Campaign entity:** tabela `campaigns` para histórico
  - Fields: `campaignName`, `message`, `mode` (manual|system), `totalRecipients`, `folderId`, `status`
  - Polling automático sincroniza status com uazapi a cada requisição
- **Enriquecimento com nomes:** 
  - `LeadsService.findByPhones()` busca leads por múltiplos telefones com regex (ignora formatação +55, espaços, traços)
  - `getCampaignMessages()` injeta `leadName` para cada destinatário (best-effort para leads do sistema)
- **Lead.entity normalizePhone():** hook `@BeforeInsert/@BeforeUpdate` normaliza phone para dígitos (ex: `+55 27 98879-1829` → `5527988791829`)
- **Otimistic UI:** envio de mensagens manual no modal do Kanban
  - Mensagem aparece imediatamente na conversa (com opacidade 60% enquanto envia)
  - Se API falhar, remove otimistic e volta o texto pro campo
  - Melhora drasticamente a percepção de responsividade

---

## Funcionalidades implementadas (01/04/2026)

### Mensagens de Áudio (Fase 6)
- **Regra:** recebeu áudio → responde em áudio. Recebeu texto → responde em texto.
- `lastMessageWasAudio` Map no controller rastreia o tipo por phone — o último tipo recebido define o formato da resposta
- **STT:** `EvolutionService.transcribeAudio(messageId)` — transcrição via uazapi `/message/download` com `transcribe: true` (usa OpenAI Whisper internamente)
- **TTS:** `AudioService.textToSpeech(text)` — gera MP3 via Google Cloud TTS (voz `pt-BR-Neural2-C`, feminina, Neural2)
- **Pré-processamento do texto para TTS:**
  - Remove emojis e símbolos Unicode especiais
  - Converte datas `dd/mm/aaaa` → "4 de abril de 2026"
  - Converte datas `dd/mm` → "4 de abril"
  - Converte horas `14h30` / `14:30` → "14 horas e 30 minutos"
  - Converte valores `R$150,00` → "150 reais"
  - Remove caracteres especiais restantes, normaliza espaços
- **SSML:** texto processado é embrulhado em `<speak><prosody rate="medium">` para fala natural
- **Fallback:** se TTS falhar, envia como texto e loga o erro com status HTTP
- `evolution.service.ts` — `transcribeAudio(messageId)` e `sendAudioMessage(phone, buffer)`
  - Endpoint transcrição: `POST /message/download` com `id, transcribe: true`
  - Endpoint envio: `POST /send/media` com `type: "ptt"`, `file: base64`

---

## Funcionalidades implementadas (31/03/2026)

### Fila com Debounce (10s)
- `message-queue.service.ts` — acumula mensagens do mesmo número por 10s de silêncio, concatena e dispara callback
- Webhook retorna `{ok:true}` imediatamente — sem retry da Evolution API
- Deduplicação por `message.key.id` — evita duplo processamento de webhooks duplicados

### Indicador de Digitação
- `evolution.service.ts` — `sendTypingIndicator(phone, durationMs)`
- Endpoint: `POST /message/presence` com body `{ number, presence: "composing", delay }`
- Disparado antes do `processMessage()`, em paralelo (void)

### Toggle de IA por Lead
- Campo `aiEnabled` na entidade `Conversation` (default: `true`)
- `PATCH /leads/:id/ai` — ativa/desativa a IA para um lead específico
- Quando desativada: mensagem salva + WebSocket emitido, Sofia não responde
- Frontend: switch "IA ativa" no modal do lead; input de envio manual liberado quando IA off

### Datas corretas no agendamento
- `buildSystemPrompt()` injeta a data de hoje + calendário dos próximos 7 dias no prompt
- A IA não calcula datas — consulta a lista pronta (evita erros como "sexta = data passada")
- Confirmação obrigatória: Sofia mostra data completa (ex: "03/04, às 14h") e aguarda confirmação antes de `action="schedule"`

### Contexto do lead injetado no system prompt
- `buildLeadContext(lead)` gera um bloco com nome, stage, sintomas, urgência, disponibilidade, orçamento, score e consulta agendada
- Injetado no final do system prompt a cada chamada — Sofia nunca esquece quem está atendendo mesmo que o cliente some e volte
- Evita regressão de contexto (ex: pedir nome de lead já qualificado)

### Filtro de mensagens antigas
- Webhook verifica `message.messageTimestamp` — mensagens com mais de 5 minutos são descartadas
- Evita que o backend responda mensagens antigas acumuladas quando volta do ar após queda

---

## Funcionalidades implementadas (07/05/2026 — Fase 10)

### Camadas de Segurança — Inativação Automática de Leads

**4 camadas implementadas no prompt da Sofia (`ai.service.ts` → `buildSystemPrompt()`):**

| Situação | Resposta | Etiquetas | IA |
|----------|----------|-----------|-----|
| Desrespeito / xingamento | 1x educada | `inativo` + `desrespeitoso` | Desativada |
| Fora de escopo total (genital, cirurgia, psicologia) | 1x educada | `inativo` + `fora-de-escopo` | Desativada |
| Emergência médica (acidente, hemorragia, perda de consciência) | Alerta urgente (192 / pronto-socorro) | `inativo` + `emergencia` | Desativada |
| Fora de escopo parcial (dor abdominal, gastrite) | Educada + sugere especialista | *(sem etiqueta)* | **Continua ativa** |

**Resposta JSON da IA agora inclui:**
```json
{ "tags": ["inativo", "desrespeitoso"], "shouldIgnore": true }
```

**Fluxo no backend (`evolution.controller.ts`):**
1. IA retorna `shouldIgnore=true`
2. Backend envia a mensagem de despedida UMA VEZ
3. Aplica etiquetas na uazapi via `POST /chat/labels` (add_labelid)
4. Cria etiquetas se não existirem via `POST /label/edit`
5. Salva etiquetas no banco (`lead.labels` — campo JSONB)
6. Chama `toggleAi(lead.id, false)` — IA desativada permanentemente
7. Lead nunca mais é respondido

**Cores das etiquetas na uazapi:**
- Vermelho: `inativo`, `desrespeitoso`, `emergencia`
- Azul: `fora-de-escopo`

**Frontend (`LeadCard.jsx`):**
- Etiquetas exibidas no card com ícone + cor
  - 🚫 inativo (vermelho), ⛔ desrespeitoso (vermelho), 🚨 emergencia (vermelho), 📵 fora-de-escopo (azul)

**Correção crítica na ordem de verificação (`evolution.controller.ts`):**
- `aiEnabled` é verificado ANTES de reiniciar lead perdido
- Lead com `aiEnabled=false` nunca é reativado mesmo mandando nova mensagem

---

### Fix: IA Inventando Data de Consulta

**Problema:** Sofia ignorava `appointmentAt` do banco e inventava datas.

**Solução (`ai.service.ts` → `processMessage()`):**
- Antes de chamar a IA, injeta par de mensagens `user/assistant` no início do histórico com a data real do banco
- A IA "parte do fato já confirmado" e não consegue inventar outra data
- Se data já passou: injeta aviso "DATA JÁ PASSOU" + instrução para oferecer reagendamento

**Código:**
```typescript
appointmentFacts.push({ role: 'user', content: '[Sistema] A consulta está confirmada para DD/MM/YYYY às HHh' });
appointmentFacts.push({ role: 'assistant', content: 'Entendido. Vou confirmar para DD/MM/YYYY às HHh.' });
// Injetado ANTES do histórico da conversa
messages = [...appointmentFacts, ...history, { role: 'user', content: incomingText }]
```

**Importante:** Ao testar datas de consulta, apagar o lead e começar do zero — histórico anterior com data errada influencia a IA.

---

### Etiquetas uazapi — Endpoints

```bash
# Criar/editar etiqueta
POST /label/edit
{ "labelid": "new", "name": "inativo", "color": 4, "delete": false }

# Buscar todas etiquetas
GET /labels

# Associar etiqueta ao contato (usar APENAS um dos três campos)
POST /chat/labels
{ "number": "5511999999999", "add_labelid": "id_da_etiqueta" }
# ou "remove_labelid" para remover
# ou "labelids": ["id1","id2"] para definir todas de uma vez
```

---

## Checklist de Testes — Sofia

### ✅ Testado e aprovado (07/05/2026)
- [x] Xingamento → etiqueta `desrespeitoso` + `inativo` + IA desativada + msg respeitosa
- [x] Data de consulta passada → informa que passou + oferece reagendamento

### ⏳ Pendente de teste
- [ ] **Emergência** — "tive um acidente", "estou passando muito mal, tontura e hemorragia"
- [ ] **Fora de escopo total** — "estou com problema no pênis" → etiquetar + inativar
- [ ] **Fora de escopo parcial** — "estou com dor de barriga" → responder educadamente, NÃO inativar
- [ ] **Consulta futura** — agendar consulta → perguntar quando é → deve informar data correta do banco
- [ ] **Reagendamento** — data passada → confirmar passou → reagendar → verificar Google Calendar
- [ ] **Áudio + emergência** — mandar áudio de emergência → Sofia deve responder em áudio com alerta

---

## Bugs corrigidos

**[30/03] Resposta sem JSON:** `buildUpdatedContext()` passou a salvar o JSON completo (`rawJson`) no histórico em vez do texto puro do `reply`. Impedia o Claude de "esquecer" o formato JSON nas mensagens seguintes.

**[31/03] Webhook duplicado:** Evolution API (Baileys) envia `messages.upsert` duas vezes para a mesma mensagem. Corrigido com `Set<messageId>` no controller (TTL de 5 min).

**[31/03] Data errada no agendamento:** IA calculava "sexta" como data passada. Corrigido injetando calendário com datas absolutas no prompt via `buildSystemPrompt()`.

**[31/03] Debounce com Promise:** implementação anterior usava Promise por webhook — segundo webhook pendurava forever, causando retry. Refatorado para callback.

**[31/03] IA esquecia contexto do lead:** após agendamento concluído, cliente mandando "oi" fazia Sofia perguntar nome/dor novamente. Corrigido injetando `buildLeadContext(lead)` no system prompt com os dados já coletados do banco.

**[31/03] Backend respondia mensagens antigas:** ao reiniciar o backend, Evolution API reenviava webhooks pendentes e a Sofia respondia mensagens velhas. Corrigido com filtro de timestamp (>5min = descartado).

**[11/04] Migração para uazapi:** Evolution API substituída por uazapi (R$ 29/mês, suporte, sem Docker). Adaptados endpoints de webhook, envio de texto/áudio, transcrição automática de áudio (eliminou necessidade de chamar Whisper manualmente).

**[07/05] IA inventava data de consulta:** Sofia ignorava `appointmentAt` do banco e calculava/inventava datas. Corrigido injetando fato da consulta como par `user/assistant` no início do histórico antes de chamar a IA.

**[07/05] Lead inativado continuava recebendo respostas:** `shouldIgnore=true` desativava apenas aquela mensagem mas não persistia. Corrigido chamando `toggleAi(lead.id, false)` que persiste no banco. Verificação de `aiEnabled` movida para ANTES do reinício de lead perdido.

---

## Variáveis de ambiente (.env)

```
# Supabase
SUPABASE_DATABASE_URL=...
SUPABASE_DIRECT_URL=...
SUPABASE_URL=...
SUPABASE_ANON_KEY=...

# Redis
REDIS_PASSWORD=...

# WhatsApp Provider — trocar entre 'uazapi' e 'meta'
WHATSAPP_PROVIDER=uazapi

# uazapi (WhatsApp)
UAZAPI_BASE_URL=https://free.uazapi.com
UAZAPI_TOKEN=...

# Meta Official API (WhatsApp Business)
WHATSAPP_TOKEN=...                           # 24h test token ou System User token permanente
WHATSAPP_PHONE_NUMBER_ID=...                 # ID do número de telefone (Meta)
WHATSAPP_BUSINESS_ACCOUNT_ID=...             # ID da conta de negócios (Meta)
WHATSAPP_VERIFY_TOKEN=my_webhook_verify_token_kanbam

# Backend
SERVER_URL=http://localhost:3000
DATABASE_ENABLED=true
DATABASE_PROVIDER=postgresql
DATABASE_CONNECTION_URI=...
CACHE_REDIS_ENABLED=true
CACHE_REDIS_URI=redis://:REDIS_PASSWORD@fisio_redis:6379/1

# IA e APIs
ANTHROPIC_API_KEY=...
JWT_SECRET=...
WEBHOOK_SECRET=...
OPENAI_API_KEY=...              # Transcrição (uazapi internamente ou Meta manual)
GROQ_API_KEY=...                # Se presente: usa Llama 3.1 8B para chat (3x mais barato). Se ausente: usa gpt-4o-mini.
GOOGLE_SERVICE_ACCOUNT_EMAIL=... # Google Cloud TTS
GOOGLE_PRIVATE_KEY="..."         # Google Cloud TTS
GOOGLE_CALENDAR_ID=...
ELEVENLABS_API_KEY=...           # TTS alternativo (não usado atualmente)
ELEVENLABS_VOICE_ID=...
```

---

## Docker Compose — serviços

| Serviço | Porta | Nota |
|---------|-------|------|
| Redis | 6379 | Container (gerenciado pelo Docker) |
| Backend NestJS | 3000 | Local (npm run start:dev) |
| Frontend React | 5173 | Local (npm run dev) |

**Observação:** PostgreSQL (Supabase), WhatsApp (uazapi OU Meta Official API), Google Calendar e Google Cloud TTS são serviços externos (não Docker).

---

## Funcionalidades implementadas (14/05/2026 — Fase 11)

### SaaS Multi-Instância — Criação e Gestão via Plataforma

**Objetivo:** Cliente cria e conecta a própria instância uazapi pelo CRM, sem tocar em .env.

**Arquitetura:**
- `UazapiProvider` injeta `@InjectRepository(WhatsappConfig)` → `resolveToken(token?)` busca token no banco (fallback para `UAZAPI_TOKEN` env)
- `WhatsappConfigService` — novos métodos: `createNewInstance(name)`, `getActiveToken()`, `updateConfig(fields)`, `deleteRecord()`, `listAll()`
- `AdminController` (`/admin/*`) — uso interno:
  - `POST /admin/instance` → cria instância via uazapi + configura webhook automaticamente + salva token no banco
  - `GET /admin/instances` → lista todas as instâncias
  - `POST /admin/global-webhook` → configura webhook global
- `InstanceController` melhorias:
  - `DELETE /instance` — wrappado em try/catch: deleta no uazapi E no banco mesmo se uazapi retornar 401
  - `PATCH /instance/config` → atualiza campos (ex: agentType) no banco

**Campo `agentType` em `WhatsappConfig`:**
- `@Column({ name: 'agent_type', default: 'fisio' }) agentType: string`
- Roteamento no webhook: `agentType='fisio'` → `aiService.processMessage()`, `agentType='megahair'` → `aiService.processMessageMegaHair()`

**Fluxo de criação:**
1. Frontend chama `POST /admin/instance { name }`
2. Backend chama `uazapi.createInstance(name)` com `admintoken` header → retorna token da instância
3. Backend configura webhook: `uazapi.configureWebhook(webhookUrl, instanceToken)` com o novo token explícito
4. Salva `instanceToken` no banco (`WhatsappConfig`)

---

### Sistema de Mídias (Imagens e Vídeos) para a IA

**Backend (`backend/src/media/`):**
- `MediaFile` entity — tabela `media_files`: id, name (unique), url, storagePath, mimeType, size, createdAt, updatedAt
- `MediaService`:
  - `upload(file, name)` → verifica unicidade, sobe para Supabase Storage, salva no banco
  - `findByName(name)` → usado pela IA para resolver nome → URL pública
  - `rename(id, newName)` → atualiza só o nome no banco (arquivo no Storage não muda)
  - `delete(id)` → remove do Storage e do banco (continua mesmo se Storage falhar)
- `MediaController`:
  - `POST /media/upload` — multipart, limite 50MB, campo `file` + campo `name`
  - `GET /media` — lista todas ordenadas por data
  - `PATCH /media/:id/rename` — renomeia (body: `{ name }`)
  - `DELETE /media/:id`

**Correção crítica — endpoint uazapi de envio de mídia:**
- Payload correto: `{ number, file: url, type, text: caption, delay }`
- ⚠️ Estava errado: `{ number, url, type, caption }` → 500 na uazapi

**Frontend (`MediaPage.jsx`):**
- Drag & drop + file picker + nome obrigatório
- Grid com preview: imagem → `<img>`, vídeo → ícone Play
- Clique → modal com `<video autoPlay controls>` ou `<img>` em tela cheia
- Renomear inline: lápis aparece no hover → input + Enter/Check/Esc para confirmar/cancelar
- Delete com modal de confirmação

---

### Agente MegaHair — "Lindona"

**Novo método `processMessageMegaHair(lead, incomingText, availableMediaNames[])` em `ai.service.ts`**

**Identidade:**
- Nome: Lindona, trabalha na Cabelô
- Tom: afetivo, usa "vc", "minha lindona", "amorzinho", como uma amiga
- Loja: Rua Clóvis Spínola, nº 40 - Shopping Orixás Center, Politeama, Salvador/BA
- Entrega Correios para todo o Brasil
- Cabelos 100% humanos vietnamitas

**Fluxo:**
1. Boas-vindas + nome + o que está procurando
2. Pergunta se já usa mega hair
   - JÁ USA → tag `qualificado` aplicada + stage `lead_quente` → vai para apresentação
   - NUNCA USOU → pergunta o que quer mudar
3. Oferece vídeo proativamente (action=none nesta msg)
4. Quando cliente confirma → envia vídeo (action=send_media), reply é a LEGENDA, não uma nova pergunta
5. Pós-vídeo → pergunta se quer ver outro ou combinar aplicação

**Formatação de nomes de mídia:**
- `formatDisplay("vietnamita-01")` → `"Vietnamita"` (remove partes puramente numéricas, capitaliza)
- `formatDisplay("cacheado-60cm")` → `"Cacheado 60cm"`
- Na conversa: exibe nome formatado. Em `mediaName` do JSON: usa id exato do banco
- Prompt mostra mapeamento: `"Vietnamita → "vietnamita-01""`

**Seleção de vídeo:**
- 1 vídeo disponível → envia direto
- Vários → lista opções e pergunta qual quer ver
- Quando cliente escolhe → identifica id exato → `action="send_media"`, `mediaName="id-exato"`

**Envio no `evolution.controller.ts`:**
```typescript
if (aiResponse.action === 'send_media' && aiResponse.mediaName) {
  const mediaFile = await this.mediaService.findByName(aiResponse.mediaName);
  if (mediaFile) {
    const type = mediaFile.mimeType?.startsWith('video/') ? 'video' : 'image';
    await this.uazapiProvider.sendMediaByUrl(phone, mediaFile.url, type, aiResponse.reply);
    await this.leadsService.saveMessage(conversation.id, 'outbound', 'ai', `[mídia: ${mediaFile.name}] ${aiResponse.reply}`);
    return;
  }
}
```

---

### Tags em Respostas Normais (não apenas shouldIgnore)

**Problema anterior:** tags só eram processadas quando `shouldIgnore=true` (leads sendo silenciados).

**Correção (`evolution.controller.ts`):**
```typescript
const normalTags = (aiResponse.tags ?? []).filter(t => t);
if (normalTags.length > 0) {
  const existingLabels: string[] = lead.labels ?? [];
  const newTags = normalTags.filter(t => !existingLabels.includes(t));
  if (newTags.length > 0) {
    await this.applyTagsToLead(phone, newTags);
    const mergedLabels = Array.from(new Set([...existingLabels, ...newTags]));
    await this.leadsService.update(lead.id, { labels: mergedLabels } as any);
  }
}
```

**Fix token em `applyTagsToLead`:**
- Estava usando `configService.get('UAZAPI_TOKEN')` → 401 porque token veio do env, não do banco
- Corrigido para `await this.whatsappConfigService.getActiveToken()`

**Tag `qualificado` (verde, color=5):**
- Aplicada automaticamente quando lead diz que já usa mega hair
- Visível no kanban + filtrável no Envio em Massa para follow-up

---

### Filtro por Etiquetas no Envio em Massa

**`BulkMessagePage.jsx` — nova seção ETIQUETAS nos filtros:**
- Exibe todas as etiquetas únicas presentes nos leads (`leads.flatMap(l => l.labels ?? [])`)
- Botões roxos com prefixo 🏷
- Lógica: **etiqueta tem prioridade** sobre stage/temperatura
  - Lead com etiqueta selecionada → sempre aparece (independente de stage/temp)
  - Lead sem etiqueta → aplica filtros de stage e temperatura normalmente
- Uso típico: clicar em "qualificado" → lista todos que já usam mega hair → selecionar todos → enviar follow-up

---

### SettingsPage — Fluxo de Criação de Instância

**Novo fluxo de inicialização:**
1. Tenta buscar `GET /instance/config`
2. Se null (sem instância) → exibe formulário de criação com campo nome
3. `POST /admin/instance { name }` → cria + configura webhook automaticamente
4. Se instância existe → comportamento normal (connect/disconnect/status)

**Seleção de agente por instância:**
- Card "Tipo de Agente": botões Fisioterapia / Mega Hair
- Salva via `PATCH /instance/config { agentType: 'fisio'|'megahair' }`
- Roteamento no webhook usa este campo para decidir qual prompt usar

---

## Pendências Futuras

### 0. Envio de Vídeo na Conversa com a IA
**Status:** ✅ Implementado (14/05/2026)  
Ver seção "Sistema de Mídias" e "Agente MegaHair" acima.

---

### 1. Lembrete de Consulta 1 Dia Antes
**Status:** ⏳ Pendente  
**Objetivo:** Enviar lembrete automático 1 dia antes da consulta e coletar confirmação do paciente  
**Implementação Necessária:**
- **Job/Scheduler:**
  - Bull Queue ou cron diário (ex: 09:00)
  - Busca leads com `appointmentAt` = amanhã
  - Envia mensagem de lembrete
  - Flag `reminderSent` para não enviar 2x
- **Fluxo de resposta:**
  - Se paciente responder "sim" → salva `reminderConfirmed=true` → consulta mantida
  - Se responder "não" (ou algo diferente de "sim") → remove do Google Calendar → limpa `appointmentAt` → responde "Quer agendar para outro dia?" → volta stage de agendamento
- **Opção de implementação:**
  - ✅ Simples: resposta por texto ("sim" ou "não")
  - 🔲 Com Quick Reply buttons: uazapi suporta botões no WhatsApp (avaliar depois se vale a pena)
- **Mensagem modelo:** "Oi {nome}! 👋 Lembrando que sua consulta está marcada para amanhã às {hora}. Confirma que vai dar?"

---

### 2. Otimização do Prompt de Venda com SPIN Selling
**Status:** ⏳ Pendente  
**Objetivo:** Melhorar a qualificação de leads e conversão de vendas para nicho específico (Fisioterapia)  
**Estratégia:** Implementar framework SPIN Selling (Situation, Problem, Implication, Need-Payoff) no system prompt
- Refatorar `buildSystemPrompt()` para injeta estrutura SPIN na qualificação
- Treinar Sofia para fazer perguntas de diagnóstico baseadas em SPIN
- Aumentar temperatura (lead_quente) baseado em respostas de implicação
- Testar com leads reais antes/depois

### 2. Follow-up Automático de 7 Dias de Cadência
**Status:** ⏳ Pendente  
**Objetivo:** Re-engajar leads que não avançaram (lead_frio) com série de 7 mensagens em cadência automática  
**Implementação Necessária:**
- Adicionar campo `nurtureCadenceDay` em `Conversation` (0-7, incrementa a cada dia)
- Job/scheduler (Bull Queue ou cron) que roda diariamente e identifica leads elegíveis (`lead_frio` + `lastMessageAt` > 24h)
- Template de 7 mensagens SPIN progressivas (escalação de interesse)
- Mensagem 1 (dia 1): Reengagement + pergunta Situation
- Mensagem 2-3: Problem discovery (perguntas de dor)
- Mensagem 4-5: Implication (consequências)
- Mensagem 6-7: Need-Payoff (benefícios da consulta)
- Webhook de reativação: se lead responder durante cadência, reseta contador e volta para qualificação ativa
- Métricas: taxa de reativação por dia, por template

---

### 3. Desativar `synchronize: true` e migrar para Migrations do TypeORM
**Status:** ⏳ Pendente — **CRÍTICO antes de virar SaaS multi-tenant**
**Risco atual:** `app.module.ts` está com `synchronize: true` em produção (Railway). Qualquer alteração em entidade (`@Column`, `@Entity`, etc) altera o schema do banco automaticamente no deploy — pode causar perda de dados ou inconsistências.

**Implementação Necessária:**
- Trocar `synchronize: true` → `synchronize: false` em `app.module.ts`
- Criar `datasource.ts` na raiz do backend para CLI do TypeORM
- Gerar migration inicial com o schema atual: `typeorm migration:generate -d datasource.ts InitialSchema`
- Adicionar scripts no `package.json`:
  - `migration:generate` — gera migration baseada nas mudanças das entidades
  - `migration:run` — aplica migrations pendentes
  - `migration:revert` — desfaz última migration
- Configurar deploy no Railway para rodar `migration:run` antes de subir o backend
- Documentar fluxo: alterar entidade → gerar migration → revisar SQL → commit → deploy roda migration

**Por que é crítico para SaaS:**
- Multi-tenant exige controle absoluto do schema (alterações precisam ser auditáveis e reversíveis)
- Sem migrations, não dá pra fazer rollback de mudanças de schema
- Quando tiver vários clientes, alterar schema sem controle pode quebrar produção

---

## 🎯 Feature Planejada: MQL → Meta CAPI (Andromeda)

**Contexto:** Anúncios Click to WhatsApp (CTWA) — lead clica no anúncio, abre WhatsApp, conversa com Sofia. Não há formulário, então nenhum evento é enviado ao Meta no clique. O evento só faz sentido quando o lead qualifica.

**Como funciona:**
- Meta gera um `ctwaClid` (Click to WhatsApp Click ID) na primeira mensagem do lead
- Esse ID fica no payload do webhook: `message.referral.ctwaClid`
- Quando Sofia classifica o lead como `lead_quente`, dispara evento `Lead` no CAPI com o `ctwaClid`
- A IA do Meta (Andromeda) atribui a conversão ao anúncio correto e aprende o perfil de quem qualifica
- Resultado: Meta passa a entregar o anúncio para perfis similares aos leads que qualificam (MQL), não a qualquer pessoa que clica

**Fluxo técnico:**
```
Clique no anúncio (Meta gera ctwaClid)
  → Primeira mensagem chega no webhook Evolution/uazapi
  → Extrair referral.ctwaClid + referral.sourceId do payload
  → Salvar ctwaClid no lead (campo novo na entidade)
  → Sofia qualifica → stage = lead_quente
  → CAPI envia evento "Lead" com ctwaClid + phone hash + email hash
  → Andromeda atribui e otimiza ✅
```

**O que implementar:**
- [ ] Extrair `ctwaClid` da primeira mensagem em `evolution.controller.ts`
- [ ] Adicionar campo `ctwaClid` na entidade Lead
- [ ] Criar migration para o novo campo
- [ ] Quando stage mudar para `lead_quente` → chamar `FacebookService.sendLeadEvent()` com ctwaClid
- [ ] `FacebookService` aceitar ctwaClid como parâmetro de atribuição (substitui fbclid)

**Valor como feature SaaS:**
- Diferencial competitivo forte: integração CAPI + MQL automático via IA
- Reduz CPL (custo por lead) treinando o Meta com sinais de qualidade
- Pode ser vendido como "Integração Andromeda" — aumenta inteligência do anúncio do cliente
- Aplicável a qualquer nicho que use Click to WhatsApp + qualificação por IA

---

## 🎯 Feature Planejada: Automação de Comentários do Instagram (copiar do funnel-platform)

**Contexto:** Funcionalidade já implementada e funcionando no funnel-platform. Precisa ser copiada para o fisio-secretary (e futuramente para o converthair). Resolve o problema de não conseguir responder todos os comentários em reels.

**Fluxo:**
```
Alguém comenta no reel do cliente
  ↓
Bot responde publicamente no comentário (ex: "Verifica na sua DM! 😉")
  ↓
Bot envia DM automático (ex: "Manda seu WhatsApp que a Sofia entra em contato")
  ↓
Paciente manda o número
  ↓
Sistema cria lead → Sofia assume no WhatsApp
```

**O que copiar do funnel-platform:**
- `backend/src/instagram-automation/` — módulo completo (service, controller, entity, ig-conversation.entity)
- `frontend/src/pages/InstagramAutomation.jsx` — UI de criação de automações com seleção de posts/reels
- Tabelas necessárias: `ig_automations`, `ig_conversations`

**Credenciais necessárias por cliente (salvar no banco, não no .env):**
- `IG_TOKEN` — Long-Lived Token do Instagram (60 dias, renovar via cron)
- `IG_USER_ID` — ID da conta Instagram (obtido automaticamente na primeira chamada)
- `IG_WEBHOOK_VERIFY_TOKEN` — token secreto para validar webhook

**Processo de setup por cliente (fase manual — sem App Review):**
1. Entrar em developers.facebook.com → app → App Roles → Add Testers → adicionar conta Facebook do cliente
2. Cliente aceita o convite
3. Abrir Graph API Explorer → cliente loga com Facebook dele → autoriza permissões (`instagram_basic`, `instagram_manage_messages`, `pages_show_list`)
4. Copiar token → converter para Long-Lived Token (60 dias) via endpoint Meta
5. Colar token no painel admin do sistema

**Limitações fase atual (sem App Review):**
- Máximo ~25 testadores por app
- Cada novo cliente: setup manual de ~15-20 min (pode ser feito remotamente com o cliente logado)
- Suficiente para até ~20 clientes

**Quando pedir App Review (Meta):**
- A partir de ~10 clientes pagantes
- Submeter vídeo demonstrando o fluxo + política de privacidade
- Aprovação: 1-4 semanas
- Após aprovação: qualquer cliente conecta via OAuth sem intervenção manual

**Arquitetura multi-tenant (preparar desde o início):**
- Tokens por cliente salvos no banco (tabela `clinic_ig_config` ou campo em `whatsapp_configs`)
- Webhook único recebe eventos de todos os clientes — roteia pelo `ig_user_id`
- Não usar env vars para tokens de Instagram de clientes

---

## 🎯 Feature Planejada: Gemini Context Caching — System Prompt (29/05/2026)

**Status:** ⏳ Pendente

**Objetivo:** Cachear o system prompt da Lindona no Gemini para reduzir ~70% dos tokens de input em todas as conversas.

**Como funciona:**
- O system prompt (~3.500 tokens) é idêntico para todos os leads
- Um único cache criado na inicialização do servidor serve para todas as conversas simultaneamente
- Tokens cacheados custam $0.0375/1M em vez de $0.15/1M (75% de desconto)
- Histórico individual de cada conversa continua sendo enviado fresco (não cacheável)

**Implementação necessária (`ai.service.ts`):**
1. No constructor do `AiService` → criar cache via API Gemini com o system prompt base
2. Em `processMessageMegaHair()` → passar `cachedContent` ID em vez do system prompt completo
3. TTL: ~60 minutos com renovação automática
4. Só ativar quando `GEMINI_API_KEY` presente (não afeta fallback OpenAI/Groq)

**Quando implementar:** quando o volume ultrapassar o free tier e o custo de tokens começar a aparecer na fatura. Por enquanto no free tier não há ganho financeiro.
