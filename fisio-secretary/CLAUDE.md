# fisio-secretary — Contexto para o Claude

## O que é este projeto

Secretária virtual com IA (Sofia) para clínica de fisioterapia. Recebe mensagens WhatsApp via Evolution API, qualifica leads automaticamente usando Claude, e exibe um Kanban em tempo real para o operador.

---

## Stack

- **Backend:** NestJS 11, TypeORM, PostgreSQL (Supabase), Redis
- **Frontend:** React + Vite + shadcn/ui + Socket.io
- **IA:** Anthropic Claude (claude-haiku-4-5-20251001)
- **WhatsApp:** Evolution API v2 (Baileys)
- **Infra:** Docker Compose

---

## Estrutura de pastas relevante

```
fisio-secretary/
├── backend/src/
│   ├── evolution/
│   │   ├── evolution.controller.ts   ← webhook POST /webhooks/evolution
│   │   ├── evolution.service.ts      ← sendTextMessage() para Evolution API
│   │   └── evolution.module.ts
│   ├── ai/
│   │   ├── ai.service.ts             ← processMessage(), buildUpdatedContext()
│   │   └── ai.module.ts
│   ├── leads/
│   │   ├── leads.service.ts          ← findOrCreate, saveMessage, updateStage
│   │   ├── leads.controller.ts       ← GET /leads, GET /leads/:id/conversation
│   │   └── leads.module.ts
│   ├── common/entities/
│   │   ├── lead.entity.ts
│   │   ├── conversation.entity.ts
│   │   ├── message.entity.ts
│   │   ├── lead-stage-history.entity.ts
│   │   └── appointment.entity.ts
│   └── app.module.ts
├── .env                              ← variáveis de ambiente
└── docker-compose.yml
```

---

## Fluxo atual (já implementado)

```
Webhook recebe msg → extrai phone + texto → findOrCreate Lead
  → salva msg inbound → processMessage() IA
  → atualiza Lead (stage, temperature, fields)
  → sendTextMessage() → salva msg outbound
```

A IA (Sofia) responde JSON:
```json
{
  "reply": "...",
  "stage": "qualificando",
  "temperature": "quente",
  "fields": { "symptoms": "...", "urgency": "alta", ... }
}
```

Stages: `novo_lead → qualificando → lead_quente | lead_frio → agendado → convertido | perdido`

Score de temperatura: urgência alta (+40), orçamento ok (+30), disponibilidade em 3 dias (+20), nome (+10) → ≥70 quente, 40-69 morno, <40 frio

---

## Status das fases

- **Fase 1:** ✅ Concluída — Docker Compose, infra, Evolution conectado ao WhatsApp
- **Fase 2:** ✅ Concluída — Backend core, webhook, leads, eco bot
- **Fase 3:** ⚠️ Implementada, pendente de testes — IA Sofia integrada com Claude, fluxo de qualificação precisa ser testado com mais profundidade (especialmente a máquina de estados de qualificação)
- **Fase 4:** 🚧 MVP parcial — Frontend Kanban feito com dados mockados, sem integração com backend, sem WebSocket
- **Fase 5:** ❌ Não implementada — Toggle IA, envio manual pelo operador, histórico de stages, stats no header

---

## Funcionalidades pendentes (implementar na ordem abaixo)

### 1. Fila com Debounce de Mensagens

**Problema:** usuário manda 3 msgs seguidas → Sofia responde 3 vezes.
**Solução:** acumular msgs do mesmo lead por 3s de inatividade, depois processar tudo de uma vez.

**Arquivos a criar/modificar:**
- `src/evolution/message-queue.service.ts` ← **novo** — Map<phone, {messages, timer}>; `enqueue()` reinicia timer de 3s; quando dispara, concatena e emite evento
- `src/evolution/evolution.controller.ts` — trocar chamada direta por `messageQueue.enqueue()`; retornar `{ok:true}` imediatamente
- `src/evolution/evolution.module.ts` — registrar `MessageQueueService`

**Dependências:** `@nestjs/bull` + `bull` (Redis já disponível no docker-compose)

### 2. Indicador de Digitação ("...")

**Problema:** usuário não sabe que Sofia está processando.
**Solução:** chamar endpoint da Evolution API para mostrar "digitando..." antes de enviar resposta.

**Arquivos a modificar:**
- `src/evolution/evolution.service.ts` — adicionar `sendTypingIndicator(phone, durationMs)`
  - Endpoint: `POST /chat/sendPresence/{instanceName}`
  - Body: `{ number: phone, options: { presence: "composing", delay: durationMs } }`
- Chamar logo antes de `processMessage()` quando o timer de debounce disparar

### 3. Mensagens de Áudio

**Regra:** recebeu áudio → responde em áudio. Recebeu texto → responde em texto.

**3a. STT — transcrever áudio recebido:**
- `src/audio/audio.service.ts` ← **novo** — `transcribe(buffer): Promise<string>` via Whisper (OpenAI API)
- `src/evolution/evolution.controller.ts` — detectar `message.message.audioMessage`, extrair base64, chamar `audioService.transcribe()`

**3b. TTS — gerar áudio para resposta (ElevenLabs):**
- `src/audio/audio.service.ts` — adicionar `textToSpeech(text): Promise<Buffer>` via ElevenLabs SDK
- `src/evolution/evolution.service.ts` — adicionar `sendAudioMessage(phone, buffer)`
  - Endpoint: `POST /message/sendMedia/{instanceName}`
  - Body: `{ number: phone, mediatype: "audio", media: base64(buffer) }`
- `src/audio/audio.module.ts` ← **novo**

**Variáveis de ambiente a adicionar ao .env:**
```
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...
OPENAI_API_KEY=...
```

---

## Variáveis de ambiente (.env)

```
SUPABASE_DATABASE_URL=...
SUPABASE_DIRECT_URL=...
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
REDIS_PASSWORD=...
AUTHENTICATION_API_KEY=...   # Evolution API
SERVER_URL=http://localhost:8080
DATABASE_ENABLED=true
DATABASE_PROVIDER=postgresql
DATABASE_CONNECTION_URI=...
CACHE_REDIS_ENABLED=true
CACHE_REDIS_URI=redis://:REDIS_PASSWORD@fisio_redis:6379/1
EVOLUTION_BASE_URL=http://localhost:8080
EVOLUTION_INSTANCE_NAME=Kanbam
ANTHROPIC_API_KEY=...
JWT_SECRET=...
WEBHOOK_SECRET=...
```

---

## Docker Compose — serviços

| Serviço | Porta | Nome interno |
|---------|-------|-------------|
| Evolution API | 8080 | `evolution_api` |
| Backend NestJS | 3000 | `backend` |
| Frontend React | 5173 | `frontend` |
| PostgreSQL | 5432 | `fisio_postgres` |
| Redis | 6379 | `fisio_redis` |

Todos na rede `fisio_net`.
