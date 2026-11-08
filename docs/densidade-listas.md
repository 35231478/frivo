# Densidade e cancelados nas listas compartilhadas

Melhorias de densidade e de filtro nos componentes/listas compartilhados, no padrão do Conta Azul. Valem para todas as telas com esse padrão (Contas a Receber/Pagar, Orçamentos, OS, Notas, Estoque…) porque mexem nos **componentes compartilhados**, não tela por tela. 🟢 sem banco.

## Parte 1 — Densidade (só layout; nenhum dado, total, filtro ou comportamento muda)

| O quê | Onde | Mudança |
|---|---|---|
| Cards de resumo | `components/listagem/periodo-cards.tsx` (`CardResumo`) | Tile do Conta Azul: rótulo pequeno + ícone discreto numa linha, valor logo abaixo, quantidade miúda. Padding `px-3 py-2` (antes `p-3.5`), valor `text-base` (antes `text-lg`); grade `gap-2` |
| Barra de período/filtros | `periodo-cards.tsx` (`BarraPeriodo`), `barra-filtros.tsx`, `listagem-ui.tsx` (`CampoBusca`) | Altura `h-9` (antes `h-10`); card `p-2.5 sm:p-3`; busca `py-2` — período + Pesquisar + "Mais filtros" na mesma linha, mais baixa |
| Linhas da tabela | `lib/planilha.ts` (`PLANILHA`) | `td`/`th` com `py-1` (antes `py-1.5`), `align-middle`, `leading-tight` — cabe muito mais registro |
| Painel "Totais do período" | `components/listagem/painel-totais.tsx` | Fonte menor (`text-[13px]`/`text-[11px]`), `px-3 py-2`, quebra `gap-y-1`; rótulos secundários já no token de texto suave (`text-ink-muted`) |
| Contas a Receber: tirar "Perdas" do topo | `components/financeiro/contas-receber-view.tsx` | 5 cards (Vencidos, Vencem hoje, A vencer, Recebidos, Total); Perdas segue no botão do cabeçalho e no painel de totais |

Objetivo: mostrar o dobro ou mais de linhas na mesma tela, em todo o sistema, mantendo legível e com alvo de toque OK no celular (lá as listas viram cartões).

## Parte 2 — Esconder cancelados por padrão (todas as listas com status "cancelado")

Por padrão a lista **não mostra** os registros cancelados (nem os conta nos totais/contadores — eles já ficavam fora dos cards financeiros). Um filtro "Mostrar cancelados" em "Mais filtros" (`?cancelados=1`) os exibe quando o usuário quiser. **Nada de exclusão permanente**: o cancelado continua existindo (auditoria/fiscal), só sai da visão padrão. A exportação segue o filtro.

Comportamento compartilhado, nos where das listas:

| Lista | Antes | Agora |
|---|---|---|
| Contas a Receber (`whereContasReceber`) | mostrava os cancelados | esconde por padrão; o chip "Cancelado" ou "Mostrar cancelados" os traz |
| Contas a Pagar (`whereContasPagar`) | mostrava os cancelados | esconde por padrão; o status "Cancelado" ou "Mostrar cancelados" os traz |
| Notas (`whereNotas`, `lib/nfse/central.ts`) | mostrava as canceladas | esconde por padrão; o grupo "Canceladas" ou "Mostrar cancelados" as traz |
| Orçamentos (`whereOrcamentos`) | **já escondia** (via `inativos`) | mantém; passa a aceitar `cancelados=1` também |
| OS (`whereOrdens`) | **já escondia** (chip "Cancelada") | mantém |

Peças compartilhadas: `mostrarCancelados(sp)` (`lib/listas/filtros.ts`, aceita `cancelados=1` e o `inativos=1` legado) e o filtro `filtroCancelados(navegar)` / `FiltroCanceladosUrl` (`components/listagem/barra-filtros.tsx`).

## Testes

`ux4-financeiro` (Receber/Pagar escondem cancelados por padrão, o chip/filtro os traz, totais sem eles), `nfse-central` + `nfse-central-pg` (Notas), `receber-periodo-pg` / `pagar-periodo-pg` (lista, cards, exportação, `cancelados=1`), `contas-receber-gestao-ui` (5 cards, filtro "Mostrar cancelados"), `contas-pagar-ui`, `perda-estorno-ui` (Perdas fora do topo). Densidade: tabela/barra/painel seguem com os testes de UI existentes.
