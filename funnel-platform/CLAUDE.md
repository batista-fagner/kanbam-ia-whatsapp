# CLAUDE.md — funnel-platform

## 📋 Visão Geral do Projeto

**funnel-platform** é um SaaS de gerenciamento de funil de vendas com automação completa:

```
Ads (Meta) → VSL (vídeo + pixel) → Formulário → Scoring → Email Automation → Dashboard
```

**Tech Stack:**
- Backend: NestJS 11, TypeORM, PostgreSQL (Supabase), Redis (Bull Queue)
- Frontend: React 18 + Vite + shadcn/ui + Tailwind
- Integrações: Meta Ads API, Resend (email), uazapi (WhatsApp), RapidAPI (Instagram)

---

## 🏗️ Estrutura

```
funnel-platform/
├── ARCHITECTURE.md      # Detalhes completos
├── ROADMAP.md          # Fases MVP → Completo
├── backend/            # NestJS (não incluído ainda)
└── frontend/           # React 18 + Vite
    ├── src/
    │   ├── pages/      # Dashboard, Campaigns, Forms, Leads, Analytics, etc
    │   ├── components/ # Layout, reutilizáveis
    │   ├── App.jsx
    │   └── main.jsx
    ├── public/         # Favicon, ícones
    ├── vite.config.js
    └── tailwind.config.js
```

---

## 🎯 Páginas Implementadas (Frontend)

| Página | Linhas | Status |
|--------|--------|--------|
| Dashboard | 125 | ✅ Estrutura base |
| Forms | 365 | ✅ Form builder UI |
| FormPublic | 274 | ✅ Página pública para leads |
| **Leads** | **480** | **✅ Completa com mensagens + email de leads IG** |
| **InstagramLeads** | **200** | **✅ Análise IA + Card insights** |
| **WhatsAppLeads** | **152** | **✅ Envio de mensagens** |
| **InstagramAutomation** | **490** | **✅ Automação completa comentários → DM → Lead** |
| Campaigns | 22 | ⚠️ Stub |
| EmailSequences | 22 | ⚠️ Stub |
| Analytics | 17 | ⚠️ Stub |
| Settings | 39 | ⚠️ Stub |

---

## 🔧 Ferramentas & Configuração

**Modelo recomendado:** Claude Opus 4.6 ou Sonnet 4.6 (projetos complexos)  
**Para operações git/rápidas:** Claude Haiku 4.5

**Permissões essenciais (em settings.local.json):**
- ✅ `npm create` — scaffolding
- ✅ `npm install` — dependências
- ✅ `npx vite` — dev server
- ✅ `WebFetch(domain:docs.uazapi.com)` — API docs
- ✅ `git add` — staging

---

## 📝 Referências Externas

- [OpenAI GPT-4o-mini](https://openai.com/api/) — ✅ Análise IA de leads + geração de mensagens
- [RapidAPI Instagram Analysis](https://rapidapi.com/) — ✅ 7 arquivos de referência inclusos
- [uazapi](https://docs.uazapi.com) — ✅ WhatsApp automático (R$ 29/mês)
- [Resend Email API](https://resend.com/docs) — documentação necessária
- [Meta Ads API](https://developers.facebook.com/) — ads e pixel tracking
- [Supabase](https://supabase.com/) — PostgreSQL gerenciado

---

## 🚀 Como Começar

### Setup Backend
```bash
cd funnel-platform/backend
npm install
npm start  # NestJS na porta 3001
```

### Setup Frontend
```bash
cd funnel-platform/frontend
npm install
npm run dev  # Vite dev server na porta 5173
```

### Usar o Sistema
1. **Form público:** http://localhost:5173/f/default
   - Preencher: Nome, Email, Telefone, Instagram
   - Lead é criado e enriquecido automaticamente
   - Mensagem é enviada ao WhatsApp em ~10 segundos

2. **Dashboard de Leads:** http://localhost:5173/leads
   - Visualizar todas as mensagens enviadas
   - Ver análise completa da IA
   - Copiar mensagem para reutilizar

3. **Instagram Leads:** http://localhost:5173/instagram
   - Análise completa do Instagram
   - Insights de nicho, engajamento, público
   - Card visual com ângulo de venda

4. **Instagram Automação:** http://localhost:5173/instagram-auto
   - Cria automações: post → palavra-chave → DM automático
   - Fluxo conversacional: confirmação (Sim/Não) + captura de email
   - Leads salvos automaticamente no banco ao capturar email
   - Ver perfis que dispararam cada automação

### Variáveis de Ambiente (`.env`)
```env
OPENAI_API_KEY=sua_chave_aqui
OPENAI_MODEL=gpt-4o-mini
RAPIDAPI_KEY=sua_chave_rapidapi
RAPIDAPI_HOST=instagram120.p.rapidapi.com
UAZAPI_BASE_URL=https://labsai.uazapi.com
UAZAPI_TOKEN=seu_token_uazapi
```

---

## 🎯 Workflow com Claude Code

### Quando pedir algo:
1. Especifique: frontend, backend, ou full-stack
2. Cite a página/módulo exato (ex: "Campaigns.jsx line 12")
3. Se for API: qual endpoint está envolvido?

### O que evitar:
- Não fazer commits sem validação manual
- Não mudar stack (React, Tailwind, Vite) sem avisar
- Não deixar arquivos de teste (TESTE.JS) no stash ou commit

---

## 📚 Documentação Local

- **ARCHITECTURE.md** — 646 linhas, arquitetura completa
- **ROADMAP.md** — 222 linhas, fases MVP → Completo
- **rapidApi/** — 7 arquivos de referência de respostas da API Instagram

---

## ⚡ Status Atual

### Fluxo Implementado (✅ Testado e Funcionando)

**Opção 1: Formulário público**
```
Lead preenche form (/f/default)
  ↓
Instagram enriquecido (RapidAPI)
  ↓
IA analisa: nicho, engajamento, público, oportunidades
  ↓
Mensagem personalizada gerada (OpenAI GPT-4o-mini)
  ↓
Mensagem enviada via WhatsApp (uazapi) em ~10 segundos
  ↓
Dashboard mostra todas as mensagens
```

**Opção 2: Landing Page (leadscomia) + WhatsApp direto**
```
Ad (Meta) → LP (leadscomia) → Dados coletados
  ↓
POST /api/forms/capture (com fbclid + UTMs)
  ↓
Lead salvo + IA enriquece + msg gerada
  ↓
WhatsApp automático disparado em ~10 segundos
  ↓
Dashboard mostra todas as mensagens
```

**Payload esperado em /api/forms/capture:**
```json
{
  "name": "João Silva",
  "email": "joao@email.com",
  "phone": "11999999999",
  "instagram": "joaosilva",
  "fbclid": "IwAR...",
  "utmSource": "facebook",
  "utmMedium": "publico-frio",
  "utmCampaign": "janeiro-2025",
  "utmContent": "ad-id-123"
}
```

### Status Geral
**Implementado:**
- ✅ Análise de Instagram com IA (RapidAPI + OpenAI)
- ✅ Envio automático de WhatsApp (uazapi)
- ✅ Dashboard de Leads com mensagens enviadas
- ✅ Card visual com insights da IA
- ✅ Form público + enriquecimento automático
- ✅ Facebook Conversions API — eventos Lead e Purchase (SHA256)
- ✅ Meta Pixel no form — PageView + Lead browser-side
- ✅ Captura de fbclid e UTMs (source, medium, campaign, content) da URL
- ✅ Dashboard com origem do anúncio + botão "Marcar como Convertido"
- ✅ Modal com imagem real do criativo em alta resolução via Marketing API
- ✅ URLs de API via VITE_API_URL (pronto para produção)
- ✅ Instagram Automação de Comentários — comentário → DM automático
- ✅ Fluxo conversacional no DM: confirmação (Quick Replies Sim/Não) → captura de email → salva Lead → envia link
- ✅ Botão clicável no DM (template button com URL)
- ✅ Resposta pública no comentário após disparo
- ✅ Normalização de keywords (maiúsculas, acentos, minúsculas)
- ✅ Edição de automações existentes
- ✅ Modal com perfis que dispararam cada automação (username, email, status da conversa)
- ✅ Leads do Instagram DM aparecem na página /leads com email visível
- ✅ Paginação na página /leads (6 leads por página, botões anterior/próximo/números)
- ✅ Filtros por origem na página /leads: Todos / Instagram DM / Tráfego Pago
- ✅ Integração leadscomia → /api/forms/capture com fbclid + UTMs capturados da URL

### Integrações Instagram (app CRM-CLAUDE-IG)
- **Token:** IGAAX — usa `graph.instagram.com` (NÃO `graph.facebook.com`)
- **IG_USER_ID:** 26565250533125084
- **IG_WEBHOOK_VERIFY_TOKEN:** funnel-platform-ig-2026
- **Webhook campos ativos:** `comments` + `messages`
- **App modo:** Ao vivo (Live) — funciona para qualquer usuário
- **Tabelas criadas:** `ig_automations`, `ig_conversations`
- **Fluxo de steps em ig_conversations:** `waiting_confirmation` → `waiting_email` → `completed`

### Integrações Facebook
- **FB_PIXEL_ID** — Pixel do Meta Ads (964343959626807)
- **FB_ACCESS_TOKEN** — Token do Conversions API (curta duração, específico para envio de eventos)
- **FB_ADS_TOKEN** — Token do app CRM-IA com ads_read, ads_management, business_management (✅ renovado 60 dias em 2026-04-21)
- **FB_AD_ACCOUNT_ID** — act_690814526400981 (conta "Lançamento")

### 🏷️ Identificação de Origem dos Leads

Os leads são classificados por origem com base nos campos `utmSource`, `utmMedium` e `fbclid` salvos no banco.

| Origem | Critério | Como é setado |
|---|---|---|
| **Instagram DM** | `utmSource = 'instagram'` AND `utmMedium = 'dm-automation'` | Automático pelo `instagram-automation.service.ts` ao salvar lead via DM |
| **Tráfego Pago** | `fbclid IS NOT NULL` OR `utmSource IN ('facebook', 'leadscomia')` | Capturado da URL quando lead vem de anúncio Meta Ads |
| **Sem origem** | Nenhum dos campos acima | Lead veio de form direto sem rastreamento |

**Filtros disponíveis na página `/leads`:**
- **Todos** — sem filtro
- **Instagram DM** — leads captados pela automação de comentários → DM
- **Tráfego Pago** — leads com fbclid (clicaram em anúncio) ou utmSource facebook/leadscomia

**Fluxo de cada origem:**
```
Instagram DM:
  Comentou no post → automação dispara → DM conversacional → captura email
  → salva Lead com utmSource='instagram', utmMedium='dm-automation'

Tráfego Pago:
  Ad Meta → LP (leadscomia) com ?fbclid=...&utm_source=facebook
  → lead preenche modal → POST /api/forms/capture
  → salva Lead com fbclid + UTMs da URL
```

### ⚠️ Pendências
- [x] **Renovar FB_ADS_TOKEN para token de longa duração (60 dias)** — ✅ CONCLUÍDO em 2026-04-21
- [x] **Renovar IG_TOKEN (IGAAX) para 60 dias** — ✅ CONCLUÍDO em 2026-04-20 (renovado ontem)
- [x] **DEMO_LEAD no Leads.jsx** — ℹ️ Mantido propositalmente para ajudar no desenvolvimento

---

**Última atualização:** 2026-04-21 (FB_ADS_TOKEN renovado para 60 dias ✅)
