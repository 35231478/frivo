# Padronização de telas — leva 5

**Operação: ordens de serviço, calendário, prazos e PMOC.** As levas 1 a 4 já estão no ar. Esta reusa
o que elas deixaram pronto (`TabelaPro` e os componentes de lista, `Dica`, `SelectCadastroRapido` com
criar e editar no contexto, toast e confirmação próprios) — nada paralelo.

**Não tem alteração de banco (🟢).** Nenhum arquivo em `prisma/sql/`, nenhuma mudança de schema: tudo
aqui é regra pura, fiação de tela e permissão.

Fora do escopo, de propósito: a tela de execução da atividade do técnico
(`/ordens/[id]/atividades/[atividadeId]/executar`) é do app do técnico, com padrão próprio de celular.

## Prioridade nº 1 — o que grava só aparece para quem pode

O servidor já recusava tudo com 403; o que faltava era a tela não oferecer.

| Onde | Botão / gesto | Permissão | O que o servidor exige |
|---|---|---|---|
| `/calendario` | "Nova OS neste dia" (o + do dia, o clique no dia, o botão do diálogo do dia) | Ordens › criar | `POST /api/ordens` |
| `/calendario` | arrastar o cartão para outro dia (reagendar) | Ordens › editar | `PATCH /api/ordens/[id]` |
| `/calendario` | ~~"Gerar OS recorrentes do mês"~~ — o botão saiu: as OS dos contratos nascem na rotina diária (`docs/calendario.md`) | — | — |
| `/ordens/[id]` | "Editar" no cabeçalho da OS | Ordens › editar | `PUT /api/ordens/[id]` |
| `/pmoc` | Novo PMOC, lápis, Inativar / Reativar, configuração | PMOC › criar / editar / excluir | as rotas de `pmocs` (já era) |

Detalhes que valem registro:

- **Sem Ordens › editar, o arrasto não existe**: os sensores do dnd-kit não são nem registrados, o
  cartão não fica "agarrável" (sem `cursor-grab`) e o handler recusa. Três camadas, porque o
  dnd-kit tem caminhos próprios de teclado e toque.
- **O cadeado do cartão continua significando só "OS concluída"**, não falta de permissão. Quem não
  pode reagendar vê os cartões normais — só não arrasta. (Antes do ajuste final, a falta de permissão
  acendia o cadeado em todos: ficava parecendo que todas as OS estavam concluídas.)
- **A gaveta solicitações** (aceitar / recusar chamado do portal) já estava certa desde a leva do
  aceite: Ordens › editar para aceitar, Ordens › excluir para recusar.

## O conserto: o botão "Editar" da OS era morto

**Como era.** O "Editar" no cabeçalho da OS apontava para `/ordens/[id]/editar`. Essa rota existia e
só fazia `redirect(/ordens/[id])` — ou seja, o botão recarregava a mesma tela. Os campos próprios da
OS (responsável, previsão de conclusão, prioridade, descrição e observações) **não tinham tela
nenhuma**: a central da OS edita o que é de cada aba (atividades, equipamentos, materiais, cobrança),
nunca os campos da OS em si.

**Como ficou.** O botão abre a gaveta **"Editar OS"** (`components/os/central/editar-os.tsx`), com
esses cinco campos. Ela manda **só o que mudou** para o mesmo `PUT /api/ordens/[id]` que o resto da
central usa, dá toast em caso de sucesso e, se o servidor recusa, **fica aberta com o que foi
digitado** e mostra o motivo — a tela não finge que salvou. Salvar sem mexer em nada não chama o
servidor. A rota morta foi apagada.

**Registro fechado trava, na tela e no servidor.** A mesma trava das linhas da OS (leva 2) passa a
valer para os campos dela:

- na tela, o botão vira um cadeado desabilitado com o motivo no ⓘ ("OS assinada pelo cliente…",
  "OS já faturada…", "OS com nota fiscal emitida…");
- no servidor, o `PUT` recusa com **409** quando o corpo traz qualquer um dos campos travados
  (`prioridade`, `descricao`, `observacoes`, `unidadeId`, `contratoId`, `responsavelId`,
  `previsaoConclusao`) e a OS está assinada, faturada ou com nota emitida. O **status** continua
  livre: reabrir, concluir e o ajuste manual têm regra própria.

OS cancelada não oferece editar.

## Sugestões inteligentes (Princípio 9: sugere, não preenche no escuro)

Na abertura da OS (`/ordens/nova`) e no diálogo "Nova OS" do calendário, assim que o cliente é
escolhido a tela oferece:

- **o tipo de OS mais usado** naquele cliente;
- **quem atendeu aquele cliente da última vez** (técnico ou equipe).

As regras ficam em `lib/os/sugestoes.ts` — as mesmas na tela e no servidor:

- janela de **6 meses**;
- mínimo de **2 OS** no período: histórico fino **não sugere nada**;
- conta **OS distintas, não atividades** — uma OS partida em três atividades do mesmo técnico é um
  atendimento, não três;
- **empate no topo não sugere** (não existe "o mais usado");
- o executor é o **último**, não o mais frequente — mas só se ele atendeu ao menos 2 OS no período
  (uma visita de passagem não vira sugestão);
- **equipe tem precedência** sobre o técnico na mesma atividade;
- **OS cancelada não conta**;
- o que foi **inativado depois** (técnico desligado, equipe desfeita, tipo de outra empresa) não é
  sugerido: a tela não oferece um atalho que não funcionaria.

Na tela, a sugestão é uma linha discreta embaixo do campo, que **diz de onde veio** ("O tipo mais
usado neste cliente — 3 OS nos últimos 6 meses. Confira antes de salvar.") e tem **Usar** e
**Dispensar**. Nada é preenchido sozinho: o campo só muda no clique em "Usar", e continua editável
depois. Sem cliente escolhido, a tela não pergunta nada ao servidor. Se a rota da sugestão falha, a
abertura da OS segue normal, sem toast de erro — a sugestão é um extra, não uma etapa.

`GET /api/ordens/sugestoes?clienteId=…` exige **Ordens › criar** (quem abre OS é quem pede) e lê o
histórico de atividades da empresa da sessão.

## As telas, uma a uma

### `/ordens` — lista de OS

Já estava no padrão desde a leva 2 (TabelaPro, barra enxuta de filtros, busca com sugestões,
permissão no "Nova OS"). Nesta leva ganhou o **ⓘ no título** (o que o período olha; canceladas ficam
fora até o filtro de status pedir). A tela não grava nada direto — as ações em massa passam pela barra
compartilhada, que mostra o resultado item a item no próprio painel (mais informativo que um toast, e
é o padrão de todas as listas).

### `/calendario`

- **ⓘ no título**: como a grade funciona (arrastar para reagendar, clicar no dia, uma OS dividida em
  visitas aparece em cada dia dela).
- **Toast da casa.** O calendário tinha uma **pilha de toasts própria** — estado local, canto inferior
  direito, 3,5 s, com estilo só dele. Saiu. As mensagens entraram no padrão: frase curta com ponto
  final ("OS 1234 movida para 17/11.").
- **Cadastro inline e editar no contexto** nos seletores do diálogo "Nova OS": Cliente e Tipo de OS
  passaram de `BuscaSelect` para `SelectCadastroRapido`, com as mesmas definições `CLIENTE` e
  `TIPO_OS` do resto do painel.
- **Sugestões** no diálogo, como em `/ordens/nova`.
- **Permissão** nos botões e no arrasto (tabela acima).
- Os **filtros do painel** (cliente, tipos, técnico) continuam filtros: ali não se cadastra nada, e
  não faz sentido oferecer "cadastrar um cliente" num campo que só limita o que a grade mostra. O
  cadastro inline fica onde se cria OS.

### `/prazos` (Prazos e SLA)

- **ⓘ no título** (de onde vêm os prazos, a ordem por urgência, onde ficam os modelos de SLA) no lugar
  de nada — a tela não explicava o que era.
- **Filtros da casa** (`FiltroSelectUrl`): mudam a URL na hora, sem o botão "Filtrar"; a lista
  esmaece enquanto a página nova vem.
- **Estado vazio** no componente compartilhado.
- **Celular**: a linha empilha em vez de apertar a data contra o nome.
- Esta tela **não grava nada e não tem botão destrutivo**: é leitura do acompanhamento, e o prazo é
  cumprido dentro da OS. Não há toast nem permissão a acrescentar aqui, e o inventário automático
  marcava "sem cadastro inline" por engano (os dois campos são filtros).

### `/pmoc` — a lista

- A **tabela própria saiu**: agora é `TabelaProUrl`, com colunas escolhíveis, ordenação pela URL
  (`ORDEM_PMOC`, lista branca), cartões no celular, busca ao vivo com sugestões (a lista `pmoc` entrou
  no typeahead da casa), filtros da casa e **paginação** — antes era um `take: 500` sem paginação
  nenhuma, e o 501º plano simplesmente não existia na tela.
- A **base legal** ("Plano de Manutenção, Operação e Controle — Lei 13.589/2018") saiu do corpo da
  tela e virou o **ⓘ do título**.
- Vocabulário: "equipamento(s)" virou "1 equipamento" / "N equipamentos".
- `wherePmoc` e `lerFiltrosPmoc` saíram da página para `lib/pmoc.ts`: a lista e o typeahead filtram
  exatamente igual.

### `/pmoc/[id]` e `/pmoc/novo` — o editor

- A faixa única de mensagem se dividiu como no resto do painel: **o que deu certo é toast**, o **erro
  fica na tela**, perto do formulário (`role="alert"`). Os avisos de chegada (criado, copiado,
  renovado) também viraram toast.
- **Cliente e Unidade** ganharam **editar no contexto**.
- O `<select>` nativo do **responsável técnico** virou o **cadastro rápido** da casa
  (`RESPONSAVEL_TECNICO`, o mesmo de Dados da empresa, da leva 4B): cadastra e edita sem sair do
  plano, com CREA. Um RT **inativado depois** continua aparecendo marcado, em vez de o campo parecer
  vazio.
- A tabela de **equipamentos cobertos** virou `TabelaPro` (mesmos dados, cartões no celular).
- PMOC é planilha: foi padronizado, não jogado fora.

## Testes

| Arquivo | O que cobre |
|---|---|
| `tests/unit/padronizacao-leva5.test.ts` | as regras das sugestões (janela, mínimo, OS distintas, empate, histórico fino, precedência da equipe, o texto da origem), o `where` e a ordenação da lista de PMOC, e as guardas de fonte (sem tabela própria, sem toast próprio, sem parágrafo de instrução, sem rota morta, sem botão sem permissão) |
| `tests/unit/padronizacao-leva5-pg.test.ts` | as rotas num PostgreSQL real: `GET /api/ordens/sugestoes` (401/403, 400 sem cliente, janela, mínimo, cancelada, OS distintas, empate, inativado depois, multiempresa) e `PUT /api/ordens/[id]` (409 da OS fechada com o banco intacto, 403 sem permissão) |
| `tests/unit/padronizacao-leva5-ui.test.ts` | as telas montadas de verdade: a gaveta Editar OS (abre, manda só o que mudou, toast, recusa mantém o digitado, cadeado com o motivo), as sugestões nas duas aberturas (Usar, Dispensar, histórico fino, sugerido fora da lista), o calendário (criar e arrastar conforme a permissão) e o gerar OS recorrentes |

Os testes de PMOC que liam a faixa de mensagem (`pmoc-etapa1-ui`, `pmoc-etapa3-ui`,
`pmoc-cronograma-ui`, `pmoc-renovacao-ui`) passaram a olhar o toast e o erro inline.

## Decisões que ficaram

- **Filtro é filtro.** O inventário automático acusava "sem cadastro inline" em `/prazos` e nos
  filtros do calendário. É falso positivo, da mesma família do `/qrcodes` na leva 4A: campo que só
  limita a lista não cadastra nada. O cadastro inline entrou onde se cria OS.
- **O botão morto virou tela de verdade**, não foi removido: os campos da OS não tinham onde ser
  editados, e remover o botão deixaria o buraco. Com a trava do registro fechado na tela e no
  servidor.
- **A sugestão nunca preenche sozinha.** Preencher no escuro economizaria um clique e custaria a
  confiança: quem abre a OS às pressas não conferiria. "Usar" é o clique que assume a escolha.
