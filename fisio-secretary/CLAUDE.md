# fisio-secretary — Contexto para o Claude

## O que é este projeto

Secretária virtual com IA (Sofia) para clínica de fisioterapia. Recebe mensagens WhatsApp via uazapi, qualifica leads automaticamente usando Claude, e exibe um Kanban em tempo real para o operador.

---

## Stack

- **Backend:** NestJS 11, TypeORM, PostgreSQL (Supabase), Redis
- **Frontend:** React + Vite + shadcn/ui + Socket.io
- **IA:** Anthropic Claude (claude-haiku-4-5-20251001)
- **STT:** OpenAI Whisper (transcrição via uazapi)
- **TTS:** Google Cloud Text-to-Speech (voz pt-BR-Neural2-C, feminina)
- **WhatsApp:** uazapi (API gerenciada, R$ 29/mês)
- **Infra:** Docker (apenas Redis), Backend/Frontend em localhost

---

## Estrutura de pastas relevante

```
fisio-secretary/
├── backend/src/
│   ├── evolution/
│   │   ├── evolution.controller.ts   ← webhook POST /webhooks/uazapi + processMessage() privado
│   │   ├── evolution.service.ts      ← sendTextMessage(), sendTypingIndicator(), sendAudioMessage(), transcribeAudio()
│   │   ├── message-queue.service.ts  ← debounce de 10s por phone, callback-based
│   │   └── evolution.module.ts
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

## Bugs corrigidos

**[30/03] Resposta sem JSON:** `buildUpdatedContext()` passou a salvar o JSON completo (`rawJson`) no histórico em vez do texto puro do `reply`. Impedia o Claude de "esquecer" o formato JSON nas mensagens seguintes.

**[31/03] Webhook duplicado:** Evolution API (Baileys) envia `messages.upsert` duas vezes para a mesma mensagem. Corrigido com `Set<messageId>` no controller (TTL de 5 min).

**[31/03] Data errada no agendamento:** IA calculava "sexta" como data passada. Corrigido injetando calendário com datas absolutas no prompt via `buildSystemPrompt()`.

**[31/03] Debounce com Promise:** implementação anterior usava Promise por webhook — segundo webhook pendurava forever, causando retry. Refatorado para callback.

**[31/03] IA esquecia contexto do lead:** após agendamento concluído, cliente mandando "oi" fazia Sofia perguntar nome/dor novamente. Corrigido injetando `buildLeadContext(lead)` no system prompt com os dados já coletados do banco.

**[31/03] Backend respondia mensagens antigas:** ao reiniciar o backend, Evolution API reenviava webhooks pendentes e a Sofia respondia mensagens velhas. Corrigido com filtro de timestamp (>5min = descartado).

**[11/04] Migração para uazapi:** Evolution API substituída por uazapi (R$ 29/mês, suporte, sem Docker). Adaptados endpoints de webhook, envio de texto/áudio, transcrição automática de áudio (eliminou necessidade de chamar Whisper manualmente).

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

# uazapi (WhatsApp)
UAZAPI_BASE_URL=https://free.uazapi.com
UAZAPI_TOKEN=...

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
OPENAI_API_KEY=...              # Transcrição (usado pela uazapi internamente)
GOOGLE_SERVICE_ACCOUNT_EMAIL=... # Google Cloud TTS
GOOGLE_PRIVATE_KEY="..."         # Google Cloud TTS
GOOGLE_CALENDAR_ID=...
```

---

## Docker Compose — serviços

| Serviço | Porta | Nota |
|---------|-------|------|
| Redis | 6379 | Container (gerenciado pelo Docker) |
| Backend NestJS | 3000 | Local (npm run start:dev) |
| Frontend React | 5173 | Local (npm run dev) |

**Observação:** PostgreSQL (Supabase), WhatsApp (uazapi) e Google Calendar são serviços externos (não Docker).
