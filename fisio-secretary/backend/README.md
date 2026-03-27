# Fisio Secretary — Backend

Backend da secretária virtual para clínica de fisioterapia. Recebe mensagens do WhatsApp via Evolution API, processa com IA (Claude) e qualifica leads automaticamente.

## Stack

- **Framework:** NestJS + TypeScript
- **Banco de dados:** PostgreSQL (Supabase) via TypeORM
- **Cache:** Redis
- **WhatsApp:** Evolution API v2
- **IA:** Anthropic Claude (`claude-haiku-4-5-20251001`)
- **Real-time:** Socket.io

## Arquitetura

```
WhatsApp → Evolution API → POST /webhooks/evolution
                                     ↓
                            Cria/busca Lead + Conversa
                                     ↓
                            Salva mensagem (inbound)
                                     ↓
                            Claude AI processa histórico
                                     ↓
                            Atualiza Lead (stage, temperatura, campos)
                                     ↓
                            Envia resposta via Evolution API
                                     ↓
                            Salva mensagem (outbound)
```

## Módulos

### `EvolutionModule`
- Recebe webhooks do WhatsApp
- Filtra mensagens de grupos e do próprio bot
- Orquestra o fluxo lead → IA → resposta

### `LeadsModule`
- CRUD de leads e conversas
- Histórico de troca de estágio
- Armazena mensagens com direção (inbound/outbound)

### `AiModule`
- Integra com Anthropic SDK
- Mantém histórico de conversa no campo `aiContext` (JSONB) do Lead
- Retorna JSON estruturado com `reply`, `stage`, `temperature` e `fields`

## Estágios do Lead

```
novo_lead → qualificando → lead_quente → agendado → convertido
                        ↘ lead_frio  → perdido
```

**Temperatura:** `quente` | `morno` | `frio`

## Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/leads` | Lista todos os leads |
| GET | `/leads/:id` | Busca lead por ID |
| GET | `/leads/:id/conversation` | Conversa com mensagens |
| PATCH | `/leads/:id/stage` | Atualiza estágio do lead |
| POST | `/webhooks/evolution` | Webhook do WhatsApp |

## Configuração

### Variáveis de ambiente

Crie um arquivo `.env` na raiz de `fisio-secretary/` (o backend usa `../.env` por symlink):

```env
# Banco de dados (Supabase)
SUPABASE_DATABASE_URL=postgresql://postgres.[project]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
SUPABASE_DIRECT_URL=postgresql://postgres.[project]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres

# Redis
REDIS_PASSWORD=sua_senha_redis

# Evolution API (WhatsApp)
AUTHENTICATION_API_KEY=chave_32_caracteres
EVOLUTION_BASE_URL=http://evolution_api:8080
EVOLUTION_INSTANCE_NAME=fisio-secretary

# Anthropic (Claude)
ANTHROPIC_API_KEY=sk-ant-...

# Configurações da clínica (usadas no prompt da IA)
PHYSIO_CLINIC_NAME=Nome da Clínica
PHYSIO_THERAPIST_NAME=Nome do Fisioterapeuta
PHYSIO_CONSULTATION_PRICE=150
PHYSIO_AVAILABLE_SLOTS=Seg-Sex 8h-18h
PHYSIO_ADDRESS=Endereço da clínica
```

Consulte `.env.example` para a lista completa.

## Rodando localmente

### Pré-requisitos
- Node.js 20+
- Docker e Docker Compose (para Redis e Evolution API)

### 1. Instalar dependências

```bash
cd fisio-secretary/backend
npm install
```

### 2. Subir infraestrutura (Redis + Evolution API)

```bash
cd fisio-secretary
docker compose up -d
```

### 3. Iniciar o backend

```bash
# desenvolvimento (watch mode)
npm run start:dev

# produção
npm run start:prod
```

A API estará disponível em `http://localhost:3000`.

## Testes

```bash
# unit tests
npm test

# e2e tests
npm run test:e2e

# cobertura
npm run test:cov
```

## Build

```bash
npm run build
```

Output gerado em `dist/`.
