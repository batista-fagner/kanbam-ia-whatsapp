# fisio-secretary — Contexto para o Claude

## O que é este projeto

SaaS multi-tenant de secretária virtual com IA para clínicas e lojas. Recebe mensagens WhatsApp via uazapi, qualifica leads com IA, exibe Kanban em tempo real. Dois agentes: **Sofia** (fisioterapia) e **Lindona** (Cabelô / MegaHair). **Deployado em produção com ~10 clientes.**

---

## Stack

- **Backend:** NestJS 11, TypeORM, PostgreSQL (Supabase), Redis
- **Frontend:** React + Vite + shadcn/ui + Socket.io
- **IA:** Gemini 2.5 Flash via endpoint OpenAI-compatível. Pool de failover: `GEMINI_API_KEY` → `OPENAI_API_KEY` (gpt-4o-mini). Cache implícito ativo (~99% tokens cacheados). Lembrete: bloco variável (`buildDateBlock`) deve ficar no **final** do systemPrompt — se vier na frente quebra o cache.
- **STT:** OpenAI Whisper (via uazapi automático ou Meta manual)
- **TTS:** Google Cloud Text-to-Speech (voz pt-BR-Neural2-C)
- **WhatsApp:** Modular via `IWhatsAppProvider` — uazapi (`WHATSAPP_PROVIDER=uazapi`) ou Meta (`WHATSAPP_PROVIDER=meta`)
- **Infra:** Docker (apenas Redis); backend/frontend rodam local

---

## Arquitetura Multi-Tenant

- Um banco PostgreSQL; cada cliente = 1 linha em `whatsapp_config` com `id` (uuid)
- Todas as tabelas de dados levam `tenant_id` (FK → `whatsapp_config.id`)
- JWT contém `tenantId`; todas as queries filtram por ele automaticamente
- Webhook identifica tenant pela URL: `POST /webhooks/uazapi/:tenantId` (rota legada sem tenant para Wendel ainda existe)
- `agentType` na `whatsapp_config` define qual agente usar: `'fisio'` → Sofia, `'megahair'` → Lindona
- **`synchronize: false`** no `app.module.ts` — NUNCA reativar. Migrations em `backend/src/migrations/`
- Fluxo de migration: alterar entidade → `npm run migration:generate -- src/migrations/Nome` → revisar SQL → testar no dev → deploy roda `npm run migration:run`

### Auth
- JWT 7 dias, `JWT_SECRET` no `.env`
- Seed no boot via `SEED_ADMIN_EMAIL` + `SEED_ADMIN_PASSWORD` + `SEED_ADMIN_TENANT_ID`
- `role`: `admin` | `operator`; admin nunca é bloqueado mesmo com tenant suspenso
- `POST /auth/login`, `GET /auth/me`, `POST /auth/change-password`
- `@UseGuards(JwtAuthGuard)` em todos os controllers exceto webhooks uazapi/whatsapp e `GET /`

### Ambiente DEV isolado
- Postgres local via Docker porta 5433 (docker-compose serviço `postgres_dev`)
- `.env.development` (gitignored): `DATABASE_SSL=false`, seed `dev@local.com`/`dev123`
- `npm run start:dev:local` usa banco local. `npm run start:dev` usa prod (Supabase)
- ⚠️ Supabase Storage no dev aponta para bucket de prod

**Sincronizar banco local com prod:**
```bash
cd fisio-secretary && docker run --rm postgres:17-alpine pg_dump --no-owner --no-acl --clean --if-exists "postgresql://postgres.shnznailwrbpapkdfvyn:ip6tASAQZvhcTzeL@aws-1-us-east-1.pooler.supabase.com:5432/postgres" | docker exec -i fisio_postgres_dev psql -U fisio -d fisio_dev && echo "✅ Dump concluído!"
```
Garanta que `docker compose up -d` está rodando antes.

---

## Estrutura de pastas relevante

```
fisio-secretary/
├── backend/src/
│   ├── evolution/
│   │   ├── evolution.controller.ts    ← webhook + processMessage()
│   │   ├── evolution.service.ts       ← wrapper IWhatsAppProvider
│   │   ├── message-queue.service.ts   ← debounce 10s por phone
│   │   └── providers/
│   │       ├── whatsapp-provider.interface.ts
│   │       ├── uazapi.provider.ts     ← postWithRetry() (3x, 1.5s)
│   │       └── meta.provider.ts
│   ├── audio/audio.service.ts         ← transcribe() Whisper, textToSpeech() Google TTS
│   ├── ai/ai.service.ts               ← processMessage(), processMessageMegaHair(), generateFollowupSuggestion()
│   ├── leads/leads.service.ts         ← findOrCreate, saveMessage, updateStage, toggleAi
│   ├── media/                         ← upload Supabase Storage, findByName, rename, delete
│   ├── followup/                      ← schedule(), processDue() cron a cada minuto
│   ├── payments/                      ← Stripe (cartão) + Efí Bank (PIX)
│   ├── auth/                          ← JWT strategy, guards, users.service
│   ├── admin/admin.controller.ts      ← CRUD clientes, reset senha, billing, instâncias
│   ├── common/entities/               ← lead, conversation, message, appointment, media-file, etc.
│   └── app.module.ts
├── COMANDOS.md    ← comandos para rodar o projeto
├── .env
└── docker-compose.yml
```

---

## Claude Code Settings

- **Model:** Haiku 4.5 (`.claude/settings.local.json`) — econômico para git/operações rotineiras

---

## Fluxo do Webhook (uazapi)

```
POST /webhooks/uazapi/:tenantId
  → filtra msgs antigas (>5min) + deduplicação por messageId
  → se áudio → transcribeAudio() via uazapi
  → MessageQueueService.enqueue() → retorna {ok:true}
  → após 10s de silêncio → processMessage(tenantId, ...)
  → aiEnabled=false? → salva msg + notifica frontend (operador assume)
  → sendTypingIndicator()
  → aiService.processMessage() | processMessageMegaHair()
  → atualiza lead (stage, temperature, fields, tags)
  → se shouldIgnore=true → envia msg + aplica etiquetas + toggleAi(false)
  → se action=send_media → sendMediaByUrl() (Lindona)
  → se áudio → TTS → sendAudioMessage(ptt) | se texto → sendTextMessage()
  → salva msg outbound + emite WebSocket (sala tenant:{id})
```

**JSON da IA:**
```json
{
  "reply": "...", "stage": "qualificando", "temperature": "quente",
  "action": "schedule|cancel|reschedule|send_media|none",
  "appointmentDateTime": "2026-04-03T14:00:00",
  "mediaName": "nome-exato-do-banco",
  "tags": ["qualificado"], "shouldIgnore": false,
  "fields": { "name": "...", "symptoms": "...", "urgency": "alta" }
}
```

**Stages:** `novo_lead → qualificando → lead_quente | lead_frio → agendado → convertido | perdido`

---

## Agentes IA

### Sofia (fisioterapia — `agentType='fisio'`)
- Qualifica leads, agenda consultas, TTS/STT
- Injeção de contexto: `buildLeadContext(lead)` no system prompt + data real de consulta como par `user/assistant` antes do histórico
- Inativação automática: xingamento/fora de escopo/emergência → tags + `toggleAi(false)` permanente

### Lindona (MegaHair — `agentType='megahair'`)
- Identidade: vendedora afetiva da Cabelô, Salvador/BA
- Fluxo: boas-vindas → qualificação (já usa mega hair?) → envia vídeo → combina aplicação
- `action=send_media` + `mediaName` (id exato do banco) → `mediaService.findByName()` → `sendMediaByUrl()`
- Tag `qualificado` aplicada quando lead confirma que já usa mega hair
- `liteClient` (`gemini-2.5-flash-lite`) para geração de follow-up (mais barato)

---

## Funcionalidades Chave

| Funcionalidade | Onde |
|---|---|
| Follow-up agendado (manual, 1h/4h/24h) | `backend/src/followup/` + `LeadModal.jsx` |
| Envio em massa com filtro por etiqueta | `BulkMessagePage.jsx` + `bulk-message.service.ts` |
| Checkout PIX (Efí Bank) ✅ prod | `payments/` — `POST /payments/checkout` |
| Checkout Cartão (Stripe) ⏳ aguarda live creds | `payments/` — `createCardCheckout()` |
| Lembrete vencimento (cron 9h, 2 dias antes; PIX manda WhatsApp + e-mail com valor por cliente) | `BillingReminderService` — `BILLING_SENDER_TOKEN` |
| Painel admin (criar/suspender/reset senha) | `admin.controller.ts` + `AdminPage.jsx` |
| Mídias (upload Supabase, IA usa por nome) | `media/` + `MediaPage.jsx` |
| Busca de lead no Kanban | `KanbanPage.jsx` |

---

## Variáveis de ambiente (.env — principais)

```
# Banco
SUPABASE_DATABASE_URL=...
DATABASE_SSL=true   # false no .env.development

# WhatsApp
WHATSAPP_PROVIDER=uazapi
UAZAPI_BASE_URL=https://free.uazapi.com
UAZAPI_TOKEN=...          # fallback; tokens por-tenant ficam no banco

# IA
GEMINI_API_KEY=...        # primário
OPENAI_API_KEY=...        # fallback + Whisper STT
GOOGLE_SERVICE_ACCOUNT_EMAIL=...
GOOGLE_PRIVATE_KEY="..."

# Auth
JWT_SECRET=...
SEED_ADMIN_EMAIL=bbfagner2222@gmail.com
SEED_ADMIN_PASSWORD=...
SEED_ADMIN_TENANT_ID=2c562828-0fe9-43c8-bad0-77a931968afc

# Billing
BILLING_SENDER_TOKEN=...  # token uazapi do número 27996972230

# Pagamento
EFI_CLIENT_ID=...
EFI_CLIENT_SECRET=...
EFI_PIX_KEY=...
STRIPE_SECRET_KEY=...         # ⏳ live ainda não configurado
STRIPE_PRICE_ID_MONTHLY=...
STRIPE_WEBHOOK_SECRET=...

# Redis
REDIS_PASSWORD=...
```

---

## Docker Compose

| Serviço | Porta | Nota |
|---|---|---|
| Redis | 6379 | gerenciado pelo Docker |
| postgres_dev | 5433 | banco local de dev (isolado da prod) |
| Backend NestJS | 3000 | `npm run start:dev` |
| Frontend React | 5173 | `npm run dev` |

---

## Pendências Futuras

1. **Stripe Live** — configurar `sk_live_`, `STRIPE_PRICE_ID_MONTHLY`, `STRIPE_WEBHOOK_SECRET` no Railway. Código pronto em `PaymentsService`.
2. **Notificações WhatsApp ao vendedor** — campo `notificationPhone` em `whatsapp_config`; disparar quando stage muda para `lead_quente` / `agendado` / `shouldIgnore=true`. `AlertRulesPage.jsx` já existe no frontend.
3. **Lembrete de consulta 1 dia antes** — cron diário 9h; busca leads com `appointmentAt=amanhã`; envia mensagem + aguarda "sim/não".
4. **Follow-up automático por raia (cadência)** — configuração por raia + inatividade; base em `backend/src/followup/` já pronta (só falta gatilho automático).
5. **Meta CAPI (Andromeda)** — extrair `ctwaClid` do webhook; enviar evento `Lead` quando `stage=lead_quente`.
6. **Automação comentários Instagram** — copiar `backend/src/instagram-automation/` do funnel-platform; tokens por cliente no banco.
7. **UI trocar senha** para o cliente (endpoint `/auth/change-password` já existe; falta form na SettingsPage).
8. **Gemini Context Caching explícito** — cachear system prompt da Lindona via API (implementar quando billing ultrapassar free tier).
