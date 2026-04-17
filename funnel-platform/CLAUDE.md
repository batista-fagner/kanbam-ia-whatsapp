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
| Campaigns | 22 | ⚠️ Stub |
| Leads | 17 | ⚠️ Stub |
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

- [RapidAPI Instagram Analysis](https://rapidapi.com/) — 7 arquivos de referência inclusos
- [Resend Email API](https://resend.com/docs) — documentação necessária
- [Meta Ads API](https://developers.facebook.com/) — ads e pixel tracking
- [uazapi](https://docs.uazapi.com) — WhatsApp (R$ 29/mês)
- [Supabase](https://supabase.com/) — PostgreSQL gerenciado

---

## 🚀 Como Começar

### Setup local (Frontend)
```bash
cd funnel-platform/frontend
npm install
npm run dev  # Vite dev server na porta 5174
```

### Checklist antes de commitar
- [ ] Verificar se há `TESTE.JS` (7791 linhas!) — pode ser lixo acidental
- [ ] Validar componentes Tailwind (output)
- [ ] Testar páginas no navegador

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

**Branches:** 6 commits à frente de origin/main  
**Staged:** ~25k linhas de novo código (43 arquivos)  
**Pronto para:** Design review, integração de API, testes

---

**Última atualização:** 2026-04-14
