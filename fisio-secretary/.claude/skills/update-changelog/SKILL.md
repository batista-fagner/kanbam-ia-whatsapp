---
name: update-changelog
description: Registra no "Status do projeto" (frontend/src/pages/AdminChangelogPage.jsx) qualquer implementação, correção de bug ou pendência feita no fisio-secretary. Use sempre que terminar uma mudança de código neste projeto, antes do commit final.
---

# Atualizar Status do projeto (fisio-secretary)

Toda mudança de código real neste projeto (feature, fix, ajuste de prompt em produção, etc.)
precisa ficar registrada em `frontend/src/pages/AdminChangelogPage.jsx` — é a página estática
que o admin lê pra saber o que mudou, sem precisar vasculhar o histórico de commits ou o chat.

## Quando usar

- Depois de qualquer mudança de código no fisio-secretary (backend ou frontend) que já vai
  ser commitada/enviada — implementação nova, correção de bug, ajuste de prompt em produção.
- Não usar para trabalho puramente exploratório/investigativo que não gerou mudança nenhuma.

## Como fazer

1. Abra `frontend/src/pages/AdminChangelogPage.jsx`.
2. Adicione um item **no topo** do array correto:
   - `DONE` — feature/fix já implementado e enviado. Campos: `title`, `date` (DD/MM/AAAA,
     data de hoje), `detail` (1-3 frases: o que mudou, por que, e o que quebrava antes —
     mesmo estilo dos itens existentes, sem jargão de código que o usuário não usa).
   - `BUGS` — se a mudança corrigiu um bug real (não só uma melhoria), adicione também aqui:
     `title`, `detail` (o sintoma observado), `status: 'corrigido'`.
   - `PENDING` — se ficou alguma pendência conhecida decorrente do trabalho (ex: falta testar
     em produção, falta um caso não coberto), adicione um item curto aqui.
3. Escreva pro usuário (Fagner), não pra outro dev — ele lê essa página pra lembrar o que foi
   feito, então nomeie o cliente/tenant afetado quando fizer sentido (ex: "(S&A Cabelos
   Naturais)", "(Telma/Marcele Blz Hair)") do jeito que os itens existentes já fazem.
4. Rode `npm run build` no frontend pra garantir que não quebrou nada (é só JS/JSX puro,
   raramente quebra, mas é rápido de conferir).
5. Inclua esse arquivo no mesmo commit da mudança de código (ou num commit `docs:` separado
   logo em seguida) — nunca deixe a mudança de código subir sem o changelog atualizado.

## O que NÃO fazer

- Não vire isso num changelog técnico de commit — é pra ficar legível pro usuário sem contexto
  de código.
- Não remova itens antigos do array — a página cresce com o tempo, isso é esperado.
- Não busque sincronizar isso com nenhum banco/API — a página é propositalmente estática
  (ver comentário no topo do arquivo).
