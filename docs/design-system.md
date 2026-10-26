# Sistema de design do Frivo

Fase 1 entregue: fundação (tokens, fontes, componentes-base), o shell global e duas telas-vitrine
(a central da OS e a lista de OS). Fase 2 em lotes: a varredura das demais telas, um PR por lote
(ver "Fase 2" abaixo). Este guia vale para as próximas varreduras.

## Princípios

- **Base neutra e um acento só.** O petróleo marca a ação principal, o item ativo, o foco e os links.
- **A cor do status tem função.** Verde = OK, âmbar = atenção, vermelho = atrasado, cinza = previsto.
  A palavra sempre aparece junto; a cor só reforça.
- **Sem degradê, sem borda colorida à esquerda, sem emoji.** Respiro entre blocos: `gap-5`, `p-5`.
- **Acessível.** Contraste de 4.5:1 no texto, foco visível no teclado e `button`/`a`/`input` reais, com
  rótulo ligado ao campo.
- **Responsivo.** Toda tela é conferida em 390 px de largura.

## Tokens: fonte única em `lib/ui/tokens.ts`

O `tailwind.config.ts` lê os tokens desse arquivo e o `globals.css` usa via `theme()`. Não escreva hex
em componente.

| Papel | Token | Classe Tailwind |
|---|---|---|
| Fundo da página | `#F7F8FA` | `bg-surface-page` |
| Superfície (card, barra, campo) | `#FFFFFF` | `bg-white` |
| Borda | `#E4E7EC` | `border-surface-border` |
| Linha (divisória de lista) | `#EEF1F5` | `border-surface-linha`, `divide-surface-linha` |
| Texto | `#1A2230` | `text-ink` |
| Texto secundário | `#5B6472` | `text-ink-muted` |
| Suave (ícone, placeholder; **não** usar em texto para leitura, só tem 3.06:1) | `#8A94A6` | `text-ink-subtle` |
| Acento | `#0E7490` · hover `#0B5566` · claro `#E6F2F5` | `bg-acento`, `hover:bg-acento-hover`, `bg-acento-claro`, `text-acento` |
| OK | `#15803D` / `#E7F5EC` | `bg-ok-claro text-ok-texto`, `bg-ok` |
| Atenção | `#B45309` / `#FBF0E0` | `bg-atencao-claro text-atencao-texto` |
| Atrasado | `#B42318` / `#FBEAE8` | `bg-atrasado-claro text-atrasado-texto`, `bg-atrasado` |
| Previsto | `#475569` / `#EEF1F5` | `bg-previsto-claro text-previsto-texto` |

O **texto** das pílulas de OK e de atenção usa um tom um pouco mais escuro do mesmo matiz
(`#137A3A` e `#A14A07`). O motivo: as cores aprovadas sobre o próprio fundo claro dão 4.46:1, abaixo
de 4.5. A cor aprovada continua igual em ícone, barra e preenchimento sólido.

**Compatibilidade.** As escalas antigas (`primary-*`, `success-*`, `ink`, `surface`) foram mantidas como
nomes e remapeadas para a identidade nova (`primary-500` = acento, `success-500` = OK). Assim, o app
inteiro já herdou o acento. Em código novo, prefira os nomes semânticos.

**Forma.**
- Raio: `rounded-card` (14px) em cards; `rounded-lg` (10px) em botões e campos.
- Sombra: `shadow-card` (levíssima), `shadow-card-hover`, `shadow-elevated` (menus, modais, gavetas).

**Tipografia.**
- Archivo 600/700 (`font-display`) em títulos (`h1`/`h2` já usam), números e KPIs.
- Inter 400/500/600 (`font-sans`) no corpo e nos dados.
- Números alinhados: `tabular-nums`.

## Componentes-base

| Componente | Uso |
|---|---|
| `Button` (`components/ui/button.tsx`) | `primary` = acento sólido · `secondary` = borda · `ghost` = só texto · `outline` = borda com texto no acento · `danger` = atrasado. Foco: `focus-visible:ring-acento`. |
| Classes `.btn-primary/.btn-secondary/.btn-ghost/.btn-danger` | Mesmas regras para `<Link>`/`<a>` com cara de botão. |
| `Card`, `CardTitulo` (`card.tsx`) | Superfície branca, borda, raio 14px, sombra levíssima, `p-5`. Título em caixa-alta pequena. |
| `StatusPill` (`status-pill.tsx`) | Pílula por **tom**: `ok`, `atencao`, `atrasado`, `previsto`, `acento`, `ok-solido`, `atrasado-solido`. Mapas prontos: `TOM_ESTAGIO_OS`, `TOM_PRIORIDADE`, `TOM_PRAZO`. Classes CSS equivalentes: `.pill-ok`, `.pill-atencao`… e os `.badge-*` antigos já apontam para elas. |
| `Stepper` (`stepper.tsx`) | Andamento em etapas: feitos e atual no acento, futuros neutros; `<ol>` com `aria-current="step"`. |
| `Kpi` (`kpi.tsx`) | Número-chave com rótulo pequeno e valor em Archivo; vira `<button>` quando tem ação. |
| `Tabs` (`tabs.tsx`) | Sublinhado no acento, `aria-current`. |
| `Input`/`Select`/`Textarea`/`FormField` | Borda neutra, foco no acento, erro em atrasado; o `FormField` liga o `label` ao campo. |
| `Modal`/`Drawer` | Superfície branca, borda e `shadow-elevated`; cabeçalho branco com título em Archivo. A gaveta deixou o navy. |
| `ToggleSwitch` | Ligado = acento. |
| Tabelas (`.table-base`) | Cabeçalho em `bg-surface-page`, linhas separadas pela "linha", sem zebra. |

## O que foi restilizado nesta fase

- **Shell**: menu lateral claro (item ativo em acento claro, sem barrinha colorida, um tema só para
  Operacional e Financeiro), cabeçalho, menu inferior do celular, gaveta do celular, logo sólido.
- **Central da OS** (`/ordens/[id]`): cabeçalho, stepper, KPIs, ajuste manual, as 6 abas (Resumo,
  Atividades, Comercial, Materiais, Financeiro, Relatórios) e o bloco de serviços adicionais.
- **Lista de OS** (`/ordens`): navegação por data, busca, filtros (com rótulos ligados), chips,
  tabela, cartões, paginação e a barra de ações em massa.
- **Base**: todos os componentes de `components/ui` e a infraestrutura de listas
  (`components/listagem`), que as demais listas compartilham.

## Fase 2: varredura por lotes

Cada lote troca as cores soltas pelos tokens, tira degradê, emoji e borda colorida à esquerda e entra
na guarda do teste `tests/unit/design-system.test.ts` (lista `VARRIDAS`). A guarda reprova, nas pastas
varridas: classe de cor da paleta do Tailwind, degradê, `border-l-*` colorido, navy (`bg-sidebar`),
emoji e hex usado para pintar.

**Decisões que valem para todos os lotes**
- Categoria não é status: avatar, tipo de interação e afins usam acento ou neutro (previsto), nunca
  verde/âmbar/vermelho.
- Cor cadastrada pelo usuário (tipo de OS, equipe) aparece como **ponto** dentro de uma pílula neutra,
  nunca como fundo de texto branco (não dá para garantir contraste com uma cor qualquer).
- Linha de tempo com traço neutro à esquerda é permitida; faixa colorida não.
- O "✓" tipográfico (U+2713) não é emoji e pode ficar.

**Lote 1: uso diário** (feito)
- Execução da OS no escritório (`components/os/*`, `app/(dashboard)/ordens`), incluindo QR e checklist.
- App do técnico (`components/tecnico/*`, `app/tecnico`): cabeçalho branco no lugar do navy, barra de
  ações sem degradê, indicador de sincronização em pílulas claras, "Concluída" com ícone em vez de emoji.
- Calendário (mês, semana, gaveta de solicitações): o cartão mostra o status por ponto e a prioridade
  por ícone (antes: fundo tingido + borda colorida à esquerda); legenda refeita.
- Dashboard e Dashboard financeiro (`components/dashboard/*`, `app/(dashboard)/financeiro/page.tsx`),
  Nova OS, Prazos e SLA.

**Lote 2: cadastros** (feito)
- Cliente: ficha em abas (dados, contatos, endereços, comunicação, faturamento, contratos, portal,
  documentos, relacionamento) e lista. O "Salvar" passou a ser o botão primário (acento), não o verde.
  No celular, os botões do cabeçalho quebram linha em vez de sair da tela.
- Contratos: lista, formulário em abas, documentos e relatório de manutenções. A periodicidade é
  categoria e ficou neutra.
- Equipamentos: lista, perfil, formulário (sem degradê), cadastro por foto, tipo de equipamento e selos.
  O status da OS no histórico usa os mesmos tons da central.
- Colaboradores, equipes (montador sem emoji), frota (formulário, selos, CRLV por foto sem degradê,
  checklist), cadastros no padrão e os editores, orçamentos (lista, itens e envio).
- Hex em classe arbitrária (`bg-[#F8FAFC]`) também entrou na guarda.

## Varredura seguinte: o que falta

Inventário pelo código, com o número de classes de cor fora do sistema (`gray-*`, `red-*`, `blue-*`…),
degradês e emojis. Essas telas já herdam o acento, as fontes e os componentes-base; falta trocar as
cores soltas pelos tokens e conferir respiro e status.

**Prioridade 1: telas de uso diário** (feito no lote 1)
1. Execução da OS no escritório: `components/os/execucao-equipamento.tsx` (65), `atividade-execucao.tsx` (32), `scanner-qr.tsx`.
2. App do técnico: casca/cabeçalho próprios, `components/tecnico/*` (Meu dia, execução, equipamento; tem degradê e emoji).
3. Calendário: `components/calendario/calendario-grid.tsx`, `solicitacoes-gaveta.tsx`.
4. Dashboard (`components/dashboard/*`) e Dashboard financeiro (`app/(dashboard)/financeiro/page.tsx`).
5. Nova OS / Editar OS (`app/(dashboard)/ordens/nova`).

**Prioridade 2: cadastros e formulários** (feito no lote 2; o documento e a aprovação pública do
orçamento passaram para o lote 4)
6. Cliente: `components/forms/cliente-form.tsx` (52), `unidades-manager` (42), `unidades-local` (31), `contatos-*`, `interacoes-manager`, `anexos-*`, `cliente-contratos`.
7. Contratos: `contrato-form` (45), `contratos-lista-client` (38), `contrato-documentos`, `relatorio-contratos-client`.
8. Equipamentos: `tipo-equipamento` (36), `cadastro-por-foto` (32), `equipamento-perfil` (29), `equipamento-form` (degradê), `selos`.
9. Colaboradores/Equipes: `colaboradores-lista-client` (27), `montador-equipes` (emoji), `tecnico-form`, `colaborador-form`.
10. Frota: `veiculo-form`, `veiculos/selos`, `crlv-por-foto` (degradê), `checklist-preenchimento`, `veiculos-lista-client`.
11. Cadastros no padrão: `cadastros/cadastro-padrao`, editores (`tipo-equipamento`, `tabela-preco`).

**Prioridade 3: financeiro, estoque e configurações**
12. Contas a receber/pagar (ações), medições (`components/medicao/*`, degradê), compras/notas (`conciliacao-nota`), estoque.
13. Configurações: `configuracoes-client`, `configuracoes/formularios`, Inter, QR, perfil (degradê).
14. Leads do site, QR codes, importação de planilha, folha.

**Prioridade 4: fora do painel**
15. Login, esqueci/definir senha: fundo em degradê navy → base neutra.
16. Portal do cliente (`app/(portal)`, `components/portal`): degradê e emoji.
17. Páginas públicas (orçamento, medição, relatório, QR) e o documento do relatório da OS: cabeçalho navy (`bg-sidebar`) e degradê.
18. Offline, splash do PWA e `manifest.json` (`theme_color`/`background_color` ainda navy).

Para medir o progresso, conte as classes de cor fora do sistema que sobraram em `app/` e
`components/` (a proteção do teste `design-system` cobre as telas já restilizadas):

```bash
grep -rEo "\b(bg|text|border|ring|divide)-(gray|slate|red|amber|orange|yellow|green|emerald|blue|sky|cyan|indigo|violet|purple|pink|rose|teal|lime)-[0-9]{2,3}\b" app components | wc -l
```
