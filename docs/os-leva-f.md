# Leva F — Ordens de Serviço

Sete ajustes na lista e na central da OS, no sino e nas fotos.

> 🔵 **Banco — NÃO aplicado.** A legenda editável das fotos da execução e dos serviços adicionais precisa de uma coluna
> nova em duas tabelas. O SQL está em `prisma/sql/2027-02-10_legenda_fotos_os.sql`: só acrescenta (`ADD COLUMN IF NOT
> EXISTS legenda TEXT`), é idempotente e não muda nenhuma linha. Aplicar no Neon antes do merge.

## 1. Período da lista de OS

**O defeito.** Em `/ordens`, escolher "Este mês" deixava a tela em "Todo o período".

**A causa.** O mês atual era o padrão de outras telas. Por isso o atalho "Este mês" **tirava** o período da URL. Só que na lista de OS o padrão era "Todo o período", então a URL sem período voltava para "Todo o período".

**A correção.** O atalho "Este mês" agora grava o mês na URL (`?mes=AAAA-MM`), em todas as listas: a tela mostra o que está na URL, seja qual for o padrão dela. As setas ‹ › andam a partir dele (`lib/periodo.ts` › `urlDoAtalho`, `urlVizinho`).

**O padrão novo.** A lista de OS abre no **mês atual** (`lib/listas/filtros.ts` › `periodoOrdens`). Uma OS entra no mês quando ele contém uma destas datas: atividade agendada, data prevista, prazo ou abertura. "Todo o período" continua no seletor.

**Os links que apontam para um conjunto de OS** levam `periodo=todos`, para não esconderem OS de meses anteriores. São eles:
- do sino: chamados do portal, prazo de atendimento, OS atrasadas;
- do painel de pendências: OS sem técnico, OS atrasadas;
- do dashboard: Atrasadas;
- da rota antiga `/prazos`.

## 2. Filtros lembrados (todas as listas)

Ao sair de uma lista e voltar, ela abre como foi deixada: período, situação, técnico, busca, ordenação e itens por página. A página não volta: a lista sempre reabre na primeira.

**Onde está.** O hook único `components/listagem/use-filtros-lembrados.ts`, com a regra pura em `lib/listagem/filtros-lembrados.ts`. Ele é chamado por:
- `useListagemUrl`, que serve o `<ListaUrl>` de todas as listas do servidor;
- a lista de OS e a de contratos, que montam a URL própria.

Nenhuma lista desliga o lembrado (há um teste que confere).

**Por quem.** Fica guardado no navegador (`localStorage`), por **empresa e usuário**: dois logins no mesmo computador não se misturam. A chave é `frivo:filtros:<empresa>:<usuário>:<tela>`.

**Até quando.** Vale no **mesmo dia de Brasília**:
- No dia seguinte, a lista volta ao padrão, o que cobre o novo login depois de muito tempo.
- Um login curto no mesmo dia mantém o filtro.

**A URL manda.** O lembrado só entra quando a lista abre **sem parâmetros**. Um link com filtro (compartilhado, do sino, do painel) vence o lembrado e passa a ser o lembrado. "Limpar filtros" também é lembrado.

**Sem armazenamento.** Em modo privado ou com o armazenamento bloqueado, todas as leituras e gravações ficam em `try/catch`: a lista abre no padrão.

## 3. Lista de OS sem cartões

A escolha "Tabela / Cards" saiu de `/ordens`:
- No desktop fica a tabela.
- No celular ficam os cartões compactos, os mesmos de antes, numa coluna.
- O link antigo `?view=cards` abre a lista normalmente.

## 4. Lentidão ao entrar na tela de OS

**Como foi medido.** Num banco local com **20 ms de ida e volta** (um proxy TCP, como a rede até o Neon), com 17 OS, lendo o log de instruções do PostgreSQL:
- tempo de servidor;
- consultas e "ondas" (consultas que precisam esperar a anterior).

**O que havia.**
- **A lista em fila.** O Prisma busca cada relação de um `include` numa consulta separada, uma depois da outra. A lista de OS tinha oito: cliente, unidade, responsável, atividades, técnico, equipe, técnico da equipe e medições. A contagem ainda rodava antes, sozinha. Foram 12 ondas no total, e cada onda paga a latência da rede.
- **A sessão em fila.** A conferência da sessão (`lib/sessao-ativa.ts` › `lerUsuario`) roda em toda página e API. Ela lia usuário, perfil e empresa com a configuração aninhados: 3 ondas antes de qualquer outra consulta.
- **O sino.** Buscava o prazo de "orçamento vencendo" sozinho, antes das outras contagens.

**O que mudou.**
- **A lista em duas ondas** (`lib/os/lista-server.ts` › `carregarListaOs`):
  1. a contagem, a página e as opções dos filtros, em paralelo;
  2. as relações das OS da página, em paralelo, cada uma numa consulta plana com filtro por relação.

  O resultado é o mesmo: um teste no PostgreSQL compara linha a linha com a consulta antiga, em 13 combinações de filtro, ordem e página.
- **A sessão.** Usuário e empresa saem juntos; o perfil sai pelo id. O formato é o mesmo, e o teste compara com a consulta antiga.
- **O sino.** O prazo do orçamento vencendo entrou no lote paralelo.
- **Os links das linhas da lista.** Não pré-carregam a OS (`prefetch={false}`).

**Antes e depois.** Banco a 20 ms de ida e volta, 17 OS, mediana de 10 medidas. O instante em que a lista aparece foi anotado por um observador do DOM dentro da página:

| O quê | ANTES | DEPOIS |
|---|---|---|
| Lista na tela, abrindo `/ordens` direto (mês atual) | 470 ms | 277 ms |
| Lista na tela, abrindo `/ordens` direto (todo o período) | 321 ms | 261 ms |
| Lista na tela, pelo menu | 341 ms | 326 ms |
| Idas ao banco em fila ao montar `/ordens` | 12 ondas | 5 ondas |
| Sino | 323 ms | ~275 ms |

Não era N+1 nem falta de índice: cada consulta leva menos de 1 ms no banco. O tempo era a fila de idas pela rede.

## 5. Sino: tocar marca como lido e leva ao item certo

**O defeito.** Antes, tocar num aviso só abria a tela. O número continuava igual, porque a maioria dos avisos é uma situação ("3 etapas vencidas") que só some quando alguém resolve.

**Como funciona agora.**
- O toque **marca o aviso como lido**. O número do sino cai na hora e a marca é gravada em `/api/alertas/lidos`, com `keepalive`.
- O aviso lido continua na lista, apagado, com o porquê no tooltip.

**Por quanto tempo vale o lido** (`lib/alertas/lidos.ts`). A regra é a mesma para todos os avisos: o lido vale enquanto o aviso for o mesmo **e** no dia em que foi lido.
- "O mesmo aviso" é a assinatura: a contagem e o registro mais recente, quando há.
- Se chegar um novo, o aviso volta a contar.
- No outro dia, com o aviso ainda de pé, também volta a contar.

**Onde fica guardado.** Por usuário, em `preferencias_usuario`, na chave `sino:lidos`: vale em qualquer aparelho. Não precisa de tabela nova.

**O número.** `/api/alertas` devolve:
- `total`: o número do sino, só o não lido;
- `totalGeral`: todos, para a lista não virar "Nenhum alerta" quando tudo foi lido;
- `lidos`.

Os avisos que entram no número estão numa lista só, `AVISOS_DO_NUMERO`; o total do sino é a soma deles.

**Destinos corrigidos.**

| Aviso | Antes | Agora |
|---|---|---|
| Chamados do portal | todas as OS do portal | as solicitações pendentes (`URL_SOLICITACOES`) |
| Compras pendentes | todos os pedidos | só os abertos (`?abertos=1`, os mesmos status da contagem) |
| Veículos em manutenção | todos os veículos | `?status=manutencao` |
| Respostas de orçamentos | a lista | uma só: abre o orçamento |
| Prazo de atendimento, OS atrasadas | o mês atual (padrão novo) | todo o período |

## 6. Cabeçalho da OS ao rolar

**O defeito.** O cabeçalho inteiro ficava preso no topo:
- número, cliente, barra de andamento e os quatro números-chave, quase um terço da tela;
- o fundo era translúcido;
- sobrava uma fresta de 24 px acima, onde o conteúdo aparecia por cima.

**A correção** (`components/os/central/cabecalho-os.tsx`). Só a **linha da OS** fica presa no desktop: número, situação, cliente, prazo e ações.
- O fundo é sólido.
- O topo é negativo (`md:-top-6`), para encostar na borda da área que rola.

A barra de andamento e os números-chave rolam com o conteúdo. No celular nada fica preso: a tela é curta e o rodapé de navegação já ocupa a base.

## 7. Legenda da foto editável (aba Relatórios)

Toda foto da galeria da OS tem um lápis **Editar legenda**, nas três origens: execução, serviço adicional e foto enviada.

**Quem pode** (`lib/os/galeria.ts` › `motivoSemEditarLegenda`):
- **Escritório**, com "OS › Editar": **sempre**, também com a OS concluída, porque a legenda é o texto do relatório.
- **Técnico** no app: nas "Fotos do serviço" da atividade dele, enquanto a OS não estiver concluída ou cancelada. Vale também com a atividade concluída. A edição sobe pela fila offline (operação `fotoOsLegenda`).

**Uma ação só para as duas portas:** `lib/os/legenda-foto-server.ts` › `editarLegendaFoto`.
- O escritório entra por `PATCH /api/ordens/[id]/fotos/[fotoId]?origem=`.
- O app entra pela sincronização.

**Trilha.** O histórico da OS guarda "Legenda da foto alterada", com a de antes e a nova, e marca "(app do técnico)" quando veio do app. Repetir a mesma legenda não grava nada.

**Onde a legenda nova aparece:** na galeria, no relatório da OS (PDF e link do cliente) e na foto copiada para um orçamento. Sem legenda escrita, continua a do sistema ("Antes do serviço", "Checklist: …", "Serviço adicional: …").

## Testes

| Frente | Testes |
|---|---|
| Período | `periodo-atalhos`, `ordens-periodo`, `ordens-lista-barra-ui` e as listas com período |
| Filtros lembrados | `filtros-lembrados` (regra), `filtros-lembrados-ui` (hook na tela, dia seguinte, outro usuário, link vence, sem armazenamento, nenhuma lista desliga) |
| Lista sem cartões | `ordens-lista-barra-ui` |
| Lentidão | `os-lista-desempenho-pg` (o novo é igual ao antigo, no PostgreSQL) |
| Sino | `sino-lidos` (regra), `sino-lidos-ui` (toque, número, apagado, destinos), `pendencias-pg` (rota de verdade: lido, novo, outro dia, outra pessoa) |
| Cabeçalho | `os-central-ui` |
| Legenda | `galeria-os` (regra e fila offline), `os-fotos-anexos-ui` (modal), `app-tecnico-ui` (app), `os-legenda-foto-pg` (as três origens, permissões, OS concluída, trilha, relatório, cópia), `sql-legenda-fotos-os` (o SQL rodado de verdade) |
