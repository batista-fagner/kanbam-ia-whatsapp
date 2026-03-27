# Secretária Virtual — Fisioterapeuta
## Arquitetura, Fluxos e Mapa do Sistema

---

## 1. Visão Geral — Componentes

```
┌─────────────────────────────────────────────────────────────────────┐
│                         DOCKER COMPOSE                              │
│                                                                     │
│  ┌──────────────┐    webhook     ┌──────────────────────────────┐   │
│  │              │ ─────────────► │                              │   │
│  │ Evolution API│                │     Backend NestJS           │   │
│  │  (Baileys)   │ ◄───────────── │     porta 3000               │   │
│  │  porta 8080  │   sendMessage  │                              │   │
│  └──────┬───────┘                │  ┌─────────────────────────┐ │   │
│         │                        │  │  EvolutionModule        │ │   │
│         │ QR Code                │  │  LeadsModule            │ │   │
│    ┌────▼────┐                   │  │  ConversationsModule    │ │   │
│    │WhatsApp │                   │  │  AiModule (Claude)      │ │   │
│    │ do Lead │                   │  │  SchedulerModule        │ │   │
│    └─────────┘                   │  │  AuthModule             │ │   │
│                                  │  └─────────────────────────┘ │   │
│                                  └──────┬───────────────┬────────┘   │
│                                         │               │            │
│                          ┌──────────────▼──┐    ┌───────▼──────┐    │
│                          │   PostgreSQL    │    │    Redis      │    │
│                          │   porta 5432    │    │   porta 6379  │    │
│                          └─────────────────┘    └──────────────┘    │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │              Frontend React — Kanban                          │  │
│  │              porta 5173                                       │  │
│  │  WebSocket ◄──────────────────────────────► Backend          │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

                              │
                              │ chama
                              ▼
                    ┌──────────────────┐
                    │   Claude API     │
                    │  (Anthropic)     │
                    │  EXTERNO         │
                    └──────────────────┘
```

---

## 2. Fluxo de uma Mensagem (ponta a ponta)

```
┌──────────┐        ┌─────────────┐        ┌────────────┐        ┌──────────┐
│  Lead    │        │ Evolution   │        │  Backend   │        │  Claude  │
│(WhatsApp)│        │   API       │        │  NestJS    │        │   API    │
└────┬─────┘        └──────┬──────┘        └─────┬──────┘        └────┬─────┘
     │                     │                     │                    │
     │  "Oi, tenho dor     │                     │                    │
     │   no joelho"        │                     │                    │
     │────────────────────►│                     │                    │
     │                     │  POST /webhooks/    │                    │
     │                     │  evolution          │                    │
     │                     │────────────────────►│                    │
     │                     │                     │ valida apikey      │
     │                     │                     │ extrai phone+texto │
     │                     │                     │                    │
     │                     │                     │ findOrCreate Lead  │
     │                     │                     │ (por telefone)     │
     │                     │                     │                    │
     │                     │                     │ salva msg inbound  │
     │                     │                     │                    │
     │                     │                     │ processMessage()   │
     │                     │                     │───────────────────►│
     │                     │                     │                    │
     │                     │                     │  retorna JSON:     │
     │                     │                     │  { reply,          │
     │                     │                     │    stage,          │
     │                     │                     │    temperature,    │
     │                     │                     │    fields }        │
     │                     │                     │◄───────────────────│
     │                     │                     │                    │
     │                     │                     │ atualiza Lead      │
     │                     │                     │ emite WebSocket    │
     │                     │                     │ salva msg outbound │
     │                     │                     │                    │
     │                     │  sendTextMessage()  │                    │
     │                     │◄────────────────────│                    │
     │  "Olá! Sou a Sofia, │                     │                    │
     │   me conta mais..." │                     │                    │
     │◄────────────────────│                     │                    │
     │                     │                     │                    │
```

---

## 3. Fluxo de Qualificação da IA — Máquina de Estados

```
                    ┌─────────────────┐
                    │   NOVO LEAD     │  ← primeiro contato
                    └────────┬────────┘
                             │ IA envia saudação
                             ▼
                    ┌─────────────────┐
                    │  QUALIFICANDO   │  ← IA está fazendo perguntas
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │  4 etapas sequenciais        │
              │                              │
         ┌────▼────┐                    ┌────▼────┐
         │ETAPA 1  │                    │ETAPA 2  │
         │Sintomas │                    │Urgência │
         │"O que   │                    │"Há quan-│
         │sente?"  │                    │to tempo?"│
         └────┬────┘                    └────┬────┘
              │                              │
         ┌────▼────┐                    ┌────▼────┐
         │ETAPA 3  │                    │ETAPA 4  │
         │Disponi- │                    │Fecha-   │
         │bilidade │                    │mento    │
         │"Quais   │                    │"Valor + │
         │horários?"│                   │agenda"  │
         └─────────┘                    └────┬────┘
                                             │
                    ┌────────────────────────┼────────────────────────┐
                    │                        │                        │
               ┌────▼────┐             ┌─────▼────┐             ┌────▼────┐
               │  QUENTE │             │  MORNO   │             │  FRIO   │
               │  🔥     │             │  ☀️       │             │  🧊     │
               │score≥70 │             │score40-69│             │score<40 │
               └────┬────┘             └─────┬────┘             └────┬────┘
                    │                        │                        │
                    ▼                        │                        ▼
            ┌───────────────┐               │              ┌──────────────────┐
            │   AGENDADO    │               │              │   LEAD FRIO      │
            │  📅           │               │              │  nurturing futuro│
            └───────┬───────┘               │              └──────────────────┘
                    │                       │
          ┌─────────┴──────────┐            │
          │                    │            │
     ┌────▼────┐          ┌────▼────┐       │
     │CONVERTIDO│         │ PERDIDO │◄──────┘
     │   ✅     │         │   ❌    │  (lead desistiu)
     └──────────┘         └─────────┘
```

---

## 4. Kanban — Colunas e Regras

```
┌────────────┬─────────────┬─────────────┬───────────┬──────────────┬────────────┬─────────┐
│            │             │             │           │              │            │         │
│ NOVO LEAD  │QUALIFICANDO │LEAD QUENTE  │ LEAD FRIO │  AGENDADO    │ CONVERTIDO │ PERDIDO │
│            │             │    🔥       │    🧊     │    📅        │    ✅       │   ❌    │
│ ─────────  │ ─────────   │ ─────────   │ ───────── │ ─────────    │ ─────────  │─────────│
│ ┌────────┐ │ ┌────────┐  │ ┌────────┐  │ ┌───────┐ │ ┌─────────┐ │ ┌────────┐ │┌───────┐│
│ │João    │ │ │Maria   │  │ │Ana     │  │ │Pedro  │ │ │Carlos   │ │ │Laura   │ ││Marcos ││
│ │🔥 85pts│ │ │☀️ 55pts│  │ │🔥 92pts│  │ │🧊epts │ │ │seg 14h  │ │ │Conver- │ ││Sem    ││
│ │joelho  │ │ │coluna  │  │ │pós-op  │  │ │curiosi│ │ │fisio    │ │ │tido    │ ││inte-  ││
│ │há 2 min│ │ │há 5 min│  │ │há 1h   │  │ │dade   │ │ │postural │ │ │        │ ││resse  ││
│ └────────┘ │ └────────┘  │ └────────┘  │ └───────┘ │ └─────────┘ │ └────────┘ │└───────┘│
│            │             │             │           │              │            │         │
│  Quem move │  Quem move  │  Quem move  │ Quem move │  Quem move   │ Quem move  │Q. move  │
│  Sistema   │  IA         │  IA         │ IA        │  IA/Operador │ Operador   │Operador │
│            │             │             │           │              │            │  /IA    │
└────────────┴─────────────┴─────────────┴───────────┴──────────────┴────────────┴─────────┘

  ← drag-and-drop manual pelo operador em qualquer coluna →
```

---

## 5. Sistema de Score (Lead Temperature)

```
┌─────────────────────────────────────────────────────────┐
│                  CÁLCULO DO SCORE                       │
├─────────────────────────────┬───────────────────────────┤
│  Critério                   │  Pontuação                │
├─────────────────────────────┼───────────────────────────┤
│  Urgência ALTA              │  +40 pts                  │
│  Urgência MÉDIA             │  +20 pts                  │
│  Urgência BAIXA             │  +5 pts                   │
│  Orçamento informado e OK   │  +30 pts                  │
│  Disponibilidade em 3 dias  │  +20 pts                  │
│  Nome informado             │  +10 pts                  │
├─────────────────────────────┼───────────────────────────┤
│  RESULTADO                  │                           │
├─────────────────────────────┼───────────────────────────┤
│  Score ≥ 70                 │  🔥 QUENTE                │
│  Score 40 – 69              │  ☀️  MORNO                │
│  Score < 40                 │  🧊 FRIO                  │
└─────────────────────────────┴───────────────────────────┘
```

---

## 6. Banco de Dados — Diagrama de Entidades

```
┌─────────────────────────────────────┐
│              leads                  │
├─────────────────────────────────────┤
│ id               UUID PK            │
│ phone            VARCHAR UNIQUE      │◄── "5511999999999"
│ name             VARCHAR            │
│ stage            VARCHAR            │◄── novo_lead | qualificando |
│ temperature      VARCHAR            │    lead_quente | lead_frio |
│ qualification_score INTEGER         │    agendado | convertido | perdido
│ symptoms         TEXT               │
│ urgency          VARCHAR            │◄── alta | media | baixa
│ availability     VARCHAR            │
│ budget           VARCHAR            │
│ qualification_step INTEGER          │◄── 0 a 4
│ ai_context       JSONB              │◄── histórico p/ Claude
│ appointment_at   TIMESTAMP          │
│ last_message_at  TIMESTAMP          │
│ created_at       TIMESTAMP          │
└─────────────────┬───────────────────┘
                  │ 1
                  │
                  │ 1
┌─────────────────▼───────────────────┐
│           conversations             │
├─────────────────────────────────────┤
│ id               UUID PK            │
│ lead_id          UUID FK            │
│ ai_enabled       BOOLEAN            │◄── operador pode desligar IA
│ created_at       TIMESTAMP          │
└─────────────────┬───────────────────┘
                  │ 1
                  │
                  │ N
┌─────────────────▼───────────────────┐
│             messages                │
├─────────────────────────────────────┤
│ id               UUID PK            │
│ conversation_id  UUID FK            │
│ evolution_id     VARCHAR            │◄── ID da msg no Evolution (dedup)
│ direction        VARCHAR            │◄── inbound | outbound
│ sender           VARCHAR            │◄── 'ai' | 'operator' | phone
│ content          TEXT               │
│ message_type     VARCHAR            │◄── text | audio | image
│ created_at       TIMESTAMP          │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│        lead_stage_history           │◄── auditoria de movimentações
├─────────────────────────────────────┤
│ id               UUID PK            │
│ lead_id          UUID FK            │
│ from_stage       VARCHAR            │
│ to_stage         VARCHAR            │
│ changed_by       VARCHAR            │◄── 'ai' | 'operator' | 'system'
│ created_at       TIMESTAMP          │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│           appointments              │
├─────────────────────────────────────┤
│ id               UUID PK            │
│ lead_id          UUID FK            │
│ scheduled_at     TIMESTAMP          │
│ duration_min     INTEGER            │
│ service_type     VARCHAR            │
│ status           VARCHAR            │◄── scheduled | confirmed |
│ notes            TEXT               │    completed | cancelled
│ created_at       TIMESTAMP          │
└─────────────────────────────────────┘
```

---

## 7. Módulos NestJS — Mapa de Dependências

```
                        ┌────────────────┐
                        │   AppModule    │
                        └───────┬────────┘
                                │ importa
          ┌─────────────────────┼──────────────────────┐
          │                     │                      │
   ┌──────▼──────┐    ┌─────────▼──────────┐   ┌──────▼──────┐
   │DatabaseModule│    │    AuthModule      │   │ RedisModule │
   │(TypeORM+PG) │    │ (JWT para o painel)│   │ (ioredis)   │
   └──────┬───────┘    └────────────────────┘   └──────┬──────┘
          │                                            │
          │ todas as entidades                         │
          │                                            │
   ┌──────▼───────────────────────────────────────────▼──────┐
   │                   EvolutionModule                        │
   │  EvolutionController  POST /webhooks/evolution           │
   │  EvolutionService     sendTextMessage(), getQrCode()     │
   └──────────────────────────────┬───────────────────────────┘
                                  │ chama
          ┌───────────────────────┼───────────────────────┐
          │                       │                       │
   ┌──────▼──────┐    ┌───────────▼──────────┐   ┌───────▼──────┐
   │ LeadsModule │    │ ConversationsModule   │   │  AiModule    │
   │             │    │                      │   │              │
   │ CRUD leads  │    │ histórico mensagens   │   │ Claude API   │
   │ WebSocket   │    │ salvar in/out         │   │ system prompt│
   │ gateway     │    │                       │   │ parse JSON   │
   └─────────────┘    └──────────────────────┘   └──────────────┘
          │
   ┌──────▼──────┐
   │SchedulerMod │
   │agendamentos │
   └─────────────┘
```

---

## 8. Frontend — Mapa de Telas

```
┌─────────────────────────────────────────────────────────────────────┐
│                         HEADER                                      │
│  [🟢 WhatsApp Conectado]  Novo Lead: 3  Quente: 5  Agendado: 2     │
│                                               [Ver Agenda do Dia]   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│                    KANBAN BOARD (tela principal)                    │
│                                                                     │
│  [Novo Lead(3)] [Qualificando(4)] [Quente(5)] [Frio(2)] ...        │
│      card           card             card        card               │
│      card           card             card                           │
│      card                                                           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

         ▼ clica em um card

┌─────────────────────────────────────────────────────────────────────┐
│  MODAL — Detalhe do Lead                             [X fechar]    │
├────────────────────────┬────────────────────────────────────────────┤
│                        │                                            │
│  DADOS DE QUALIFICAÇÃO │  CONVERSA                                 │
│                        │                                            │
│  Nome: João Silva      │  ┌──────────────────────────────────────┐ │
│  Telefone: 5511...     │  │  João: "Oi, tenho dor no joelho"     │ │
│  Score: 85 pts 🔥      │  │                                      │ │
│  Stage: Lead Quente    │  │    Sofia: "Olá João! Sou a Sofia..." │ │
│                        │  │         [IA] 14:32                   │ │
│  Sintomas:             │  │                                      │ │
│  dor no joelho ao      │  │  João: "Há 3 semanas, dói bastante"  │ │
│  subir escadas         │  │  14:33                               │ │
│                        │  │                                      │ │
│  Urgência: ALTA ⚠️     │  │    Sofia: "Entendo, deve ser..."    │ │
│  Disponib: ter/qui 18h │  │         [IA] 14:33                   │ │
│  Orçamento: R$180 ok   │  │                                      │ │
│                        │  └──────────────────────────────────────┘ │
│  [IA ativa  ●──]       │                                            │
│                        │  ┌──────────────────────────────────┐     │
│  HISTÓRICO DE STAGES   │  │  Mensagem manual...       [Enviar]│    │
│  14:30 novo_lead→qual. │  └──────────────────────────────────┘     │
│  14:33 qual.→quente    │                                            │
│                        │                                            │
└────────────────────────┴────────────────────────────────────────────┘
```

---

## 9. Resposta JSON da IA (contrato entre Claude e Backend)

```json
{
  "reply": "Entendo, dor no joelho há 3 semanas pode ser bem limitante! 😕 Me conta: isso está te impedindo de fazer suas atividades do dia a dia?",
  "stage": "qualificando",
  "temperature": "quente",
  "qualification_step": 2,
  "fields": {
    "symptoms": "dor no joelho ao subir escadas há 3 semanas",
    "urgency": "alta",
    "availability": null,
    "budget": null
  },
  "appointment": {
    "requested": false,
    "suggested_time": null,
    "service_type": null
  }
}
```

---

## 10. Infraestrutura Docker — Rede Interna

```
                         fisio_net (bridge)
  ┌──────────────────────────────────────────────────────────┐
  │                                                          │
  │  ┌──────────┐   POST http://backend:3000/webhooks/      │
  │  │evolution │──────────────────────────────────────────►│
  │  │:8080     │                                           │
  │  └──────────┘   GET http://evolution:8080/message/...  │
  │       ▲◄─────────────────────────────────────────────── │
  │       │                                                  │
  │  ┌────┴─────┐          ┌──────────┐   ┌──────────────┐  │
  │  │          │          │          │   │              │  │
  │  │ backend  │─────────►│postgres  │   │    redis     │  │
  │  │ :3000    │          │ :5432    │   │    :6379     │  │
  │  │          │─────────►│          │   │              │  │
  │  └──────────┘          └──────────┘   └──────────────┘  │
  │       ▲                                                  │
  │       │ WebSocket                                        │
  │  ┌────┴─────┐                                           │
  │  │ frontend │   (acessado pelo operador via browser)    │
  │  │ :5173    │                                           │
  │  └──────────┘                                           │
  │                                                          │
  └──────────────────────────────────────────────────────────┘

  Portas expostas ao host:
  - 8080 → Evolution API (admin/QR Code)
  - 3000 → Backend API
  - 5173 → Frontend
  - 5432 → Postgres (opcional, só dev)
```

---

## 11. Fluxo de Nutrição — Lead Frio

```
                    ┌─────────────────┐
                    │   LEAD FRIO 🧊  │  ← score < 40
                    └────────┬────────┘
                             │
                             │ SchedulerModule agenda sequência
                             ▼
          ┌──────────────────────────────────────────┐
          │           SEQUÊNCIA DE NUTRIÇÃO          │
          │                                          │
          │  D+3   Toque de empatia                  │
          │  "Ei, tudo bem? Sei que é difícil        │
          │   conviver com dor. Se quiser conversar  │
          │   sobre opções, estou aqui 😊"           │
          │                                          │
          │  D+7   Conteúdo educativo                │
          │  "Você sabia que dor crônica no joelho   │
          │   pode piorar sem tratamento? A fisiote- │
          │   rapia age antes de virar cirurgia 🦵"  │
          │                                          │
          │  D+15  Prova social / depoimento         │
          │  "A Maria, que tinha dor parecida com a  │
          │   sua, fez 8 sessões e voltou a caminhar │
          │   sem dor. Posso te contar mais?"        │
          │                                          │
          │  D+30  Oferta com urgência leve          │
          │  "Temos uma avaliação gratuita essa      │
          │   semana. Quer aproveitar? São só 30min" │
          └──────────────────┬───────────────────────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
     Lead responde positivo        Lead não responde
     ou abre qualquer msg               (silêncio)
              │                             │
              ▼                             ▼
     ┌─────────────────┐         ┌──────────────────────┐
     │  REQUALIFICANDO │         │  D+60 Última tentativa│
     │                 │         │  "Vou deixar de       │
     │  IA retoma fluxo│         │   incomodar, mas se   │
     │  de qualificação│         │   mudar de ideia é    │
     │  do zero        │         │   só me chamar 🙏"    │
     └────────┬────────┘         └──────────┬───────────┘
              │                             │
              ▼                             ▼
     ┌─────────────────┐         ┌──────────────────────┐
     │  fluxo normal   │         │      ARQUIVADO       │
     │  (qualificando  │         │  nutrição encerrada  │
     │   → quente →    │         │  lead fica no banco  │
     │   agendado)     │         │  para campanha futura│
     └─────────────────┘         └──────────────────────┘
```

### Regras da Nutrição

```
┌─────────────────────────────────────────────────────────┐
│               REGRAS DO SCHEDULER                       │
├──────────────────────────────┬──────────────────────────┤
│  Regra                       │  Detalhe                 │
├──────────────────────────────┼──────────────────────────┤
│  Horário de envio            │  08h–18h dias úteis      │
│  Máx. mensagens na sequência │  4 toques                │
│  Parar se lead responder     │  imediatamente           │
│  Parar se lead pedir         │  "não quero mais msgs"   │
│  Re-score ao reengajar       │  recalcula temperatura   │
│  Operador pode pausar        │  toggle no modal do lead │
├──────────────────────────────┼──────────────────────────┤
│  Campo novo em leads         │                          │
│  nurture_step   INTEGER      │  0 a 4 (toque atual)    │
│  nurture_paused BOOLEAN      │  operador pausou?        │
│  next_nurture_at TIMESTAMP   │  próximo envio agendado  │
└──────────────────────────────┴──────────────────────────┘
```

### JSON da IA para Mensagem de Nutrição

```json
{
  "nurture_message": "Ei, tudo bem? Sei que conviver com dor no dia a dia é cansativo. Se em algum momento quiser entender melhor suas opções de tratamento, é só me chamar 😊",
  "nurture_step": 1,
  "next_step_days": 7,
  "end_sequence": false
}
```

---

## 13. Funcionalidades Avançadas de Mensagens

### 13.1 Fila com Debounce de Mensagens

**Problema:** usuário envia mensagens em sequência rápida ("oi" → "queria marcar" → "uma consulta") e Sofia responde 3 vezes separadamente.

**Solução:** acumular mensagens do mesmo lead por uma janela de **3 segundos de inatividade**, depois processar tudo concatenado como uma única mensagem.

```
Webhook recebe msg → enqueue(phone, text) → retorna { ok: true }
                                ↓ (3s sem nova msg do mesmo número)
                     concatena textos → processa IA → envia resposta
```

**Arquivos:**

| Arquivo | Ação |
|---------|------|
| `src/evolution/message-queue.service.ts` | **Criar** — `Map<phone, { messages[], timer }>`, método `enqueue()`, EventEmitter2 |
| `src/evolution/evolution.controller.ts` | Substituir chamada direta à IA por `messageQueue.enqueue()` |
| `src/evolution/evolution.module.ts` | Registrar `MessageQueueService` + `BullModule.registerQueue` |

**Dependências:** `@nestjs/bull` + `bull` (usa o Redis já existente)

---

### 13.2 Indicador de Digitação ("...")

**Problema:** usuário não sabe que Sofia está processando — parece que a mensagem sumiu.

**Solução:** chamar endpoint da Evolution API para mostrar "digitando..." antes de enviar a resposta.

```
Timer de 3s dispara
  → sendTypingIndicator(phone, 4000)   ← "digitando..." aparece no WhatsApp
  → processMessage() via IA            ← processamento real
  → sendTextMessage() ou sendAudio()   ← envia resposta
```

**Arquivos:**

| Arquivo | Ação |
|---------|------|
| `src/evolution/evolution.service.ts` | Adicionar `sendTypingIndicator(phone, durationMs)` |

**Endpoint Evolution:** `POST /chat/sendPresence/{instanceName}`
```json
{ "number": "phone", "options": { "presence": "composing", "delay": 4000 } }
```

---

### 13.3 Mensagens de Áudio (STT + TTS)

**Regra de negócio:**
- Recebeu **texto** → responde em **texto**
- Recebeu **áudio** → transcreve (STT) → processa IA → responde em **áudio** (TTS)

#### STT — Transcrição de áudio recebido

- Evolution API fornece o áudio em base64 via webhook
- `AudioService.transcribe(buffer)` chama **Whisper (OpenAI)** → retorna texto
- Texto entra no fluxo normal da IA

#### TTS — Geração de áudio para resposta

- `AudioService.textToSpeech(text)` chama **ElevenLabs** com a voz configurada para Sofia
- Retorna buffer MP3/OGG
- `EvolutionService.sendAudioMessage(phone, buffer)` envia via Evolution API

**Lógica de decisão no controller:**
```
se messageType === 'audio':
  inputText = transcrever(audioData)
  responseMode = 'audio'
senão:
  inputText = message.conversation
  responseMode = 'text'

... processamento IA ...

se responseMode === 'audio':
  audioBuffer = textToSpeech(aiResponse.reply)
  sendAudioMessage(phone, audioBuffer)
senão:
  sendTextMessage(phone, aiResponse.reply)
```

**Arquivos:**

| Arquivo | Ação |
|---------|------|
| `src/audio/audio.service.ts` | **Criar** — `transcribe()` (Whisper) + `textToSpeech()` (ElevenLabs) |
| `src/audio/audio.module.ts` | **Criar** — registra e exporta `AudioService` |
| `src/evolution/evolution.service.ts` | Adicionar `sendAudioMessage(phone, audioBuffer)` |
| `src/evolution/evolution.controller.ts` | Lógica de decisão texto/áudio |
| `src/evolution/evolution.module.ts` | Importar `AudioModule` |

**Endpoint Evolution para envio de áudio:** `POST /message/sendMedia/{instanceName}`
```json
{ "number": "phone", "mediatype": "audio", "media": "<base64>" }
```

---

### 13.4 Novas Variáveis de Ambiente (Fase 6)

```bash
# ElevenLabs (TTS)
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...    # ID da voz da Sofia

# OpenAI (Whisper STT)
OPENAI_API_KEY=...
```

---

### 13.5 Ordem de Implementação (Fase 6)

```
FASE 6 — Mensagens Avançadas
  ├── MessageQueueService: debounce 3s por número
  ├── Indicador de digitação (sendTypingIndicator)
  ├── AudioModule: STT com Whisper
  └── AudioModule: TTS com ElevenLabs + sendAudioMessage
```

**Critérios de verificação:**
- Enviar 3 mensagens rápidas → Sofia responde 1 única vez com contexto completo
- "digitando..." aparece no WhatsApp antes da resposta
- Enviar áudio → Sofia transcreve → processa → responde em áudio
- Enviar texto → Sofia responde em texto (fluxo atual preservado)

---

## 14. Ordem de Construção

```
FASE 1 — Infraestrutura
  ├── docker-compose.yml
  ├── .env com todas as variáveis
  ├── Subir postgres + redis + evolution
  └── Escanear QR Code → WhatsApp conectado ✅

FASE 2 — Backend Core
  ├── Scaffold NestJS
  ├── TypeORM + migrations (criar tabelas)
  ├── EvolutionModule: receber webhook
  ├── LeadsModule: criar/buscar lead por telefone
  └── Eco bot: recebe msg → responde "recebi: {msg}" ✅

FASE 3 — IA
  ├── AiModule com Claude API
  ├── System prompt da Sofia
  ├── Parsing do JSON de resposta
  ├── Integrar na pipeline (replace eco bot)
  └── Testar fluxo completo de qualificação ✅

FASE 4 — Frontend
  ├── Scaffold React + Vite + shadcn/ui
  ├── LeadsService (chamadas REST)
  ├── KanbanBoard com dados estáticos
  ├── useWebSocket hook (Socket.io)
  ├── Cards se movem em tempo real
  └── LeadDetailModal com conversa ✅

FASE 5 — Polish
  ├── Página de QR Code (para parear WhatsApp)
  ├── Stats no header (contadores por coluna)
  ├── Toggle IA por lead
  ├── Envio manual pelo operador
  └── Histórico de movimentações de stage ✅

FASE 6 — Mensagens Avançadas
  ├── MessageQueueService: debounce 3s por número
  ├── Indicador de digitação (sendTypingIndicator)
  ├── AudioModule: STT com Whisper
  └── AudioModule: TTS com ElevenLabs + sendAudioMessage
```

---

## 15. Variáveis de Ambiente

```bash
# Banco
POSTGRES_USER=fisio_user
POSTGRES_PASSWORD=senha_forte_aqui
POSTGRES_DB=fisio_secretary

# Cache
REDIS_PASSWORD=senha_redis_aqui

# Evolution API
EVOLUTION_API_KEY=chave_32_chars_aqui
EVOLUTION_INSTANCE_NAME=fisio-secretary

# IA
ANTHROPIC_API_KEY=sk-ant-...

# Segurança
JWT_SECRET=secret_64_chars_aqui
WEBHOOK_SECRET=secret_webhook_aqui

# Config da fisioterapeuta (usada no prompt da Sofia)
PHYSIO_CLINIC_NAME="Clínica Silva Fisioterapia"
PHYSIO_THERAPIST_NAME="Dra. Ana Silva"
PHYSIO_SPECIALTIES="Ortopedia, Pós-operatório, Dor crônica, RPG"
PHYSIO_CONSULTATION_PRICE="R$ 180,00"
PHYSIO_AVAILABLE_SLOTS="Segunda a Sexta 8h-19h, Sábado 8h-13h"
PHYSIO_ADDRESS="Rua das Flores, 123 - São Paulo/SP"
PHYSIO_INSURANCE_PLANS="Unimed, Bradesco Saúde, Particular"

# ElevenLabs (TTS — Fase 6)
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...

# OpenAI Whisper (STT — Fase 6)
OPENAI_API_KEY=...
```
