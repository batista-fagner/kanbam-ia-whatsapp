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
| **Leads** | **480** | **✅ Completa com mensagens** |
| **InstagramLeads** | **200** | **✅ Análise IA + Card insights** |
| **WhatsAppLeads** | **152** | **✅ Envio de mensagens** |
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

```
Lead preenche form
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

### Integrações Facebook
- **FB_PIXEL_ID** — Pixel do Meta Ads (964343959626807)
- **FB_ACCESS_TOKEN** — Token do Conversions API (curta duração, específico para envio de eventos)
- **FB_ADS_TOKEN** — Token do app CRM-IA com ads_read, ads_management, business_management (expira em ~1-2h, ver pendências)
- **FB_AD_ACCOUNT_ID** — act_690814526400981 (conta "Lançamento")

### ⚠️ Pendências
- [ ] **Renovar FB_ADS_TOKEN para token de longa duração (60 dias)** — token atual expira em ~1-2h. Fazer via Graph API: `GET /oauth/access_token?grant_type=fb_exchange_token&client_id={app_id}&client_secret={app_secret}&fb_exchange_token={token_curto}`

---

**Última atualização:** 2026-04-20
