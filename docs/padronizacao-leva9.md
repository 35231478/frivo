# Padronização de telas — leva 9 (Desempenho) · a última

Nona e última leva. O módulo Desempenho nasceu depois das primeiras levas, com padrão próprio: esta
leva **alinha a tela** ao padrão da casa, sem encostar na lógica (escore, fechamento, premiação,
penalidades).

**Não tem alteração de banco (🟢).** Nenhum arquivo em `prisma/sql/`, nenhuma mudança de schema.

## Prioridade nº 1 — o dinheiro já estava guardado, e continua

| Onde | Quem vê / quem pode | Confere onde |
|---|---|---|
| `/desempenho` (painel) e ficha do colaborador | Desempenho › Visualizar | na página; **sem valor em reais** |
| `/desempenho/revisao` | Desempenho › Revisar | na página e em cada rota de penalidade |
| `/desempenho/premiacoes` | ver: Visualizar · cadastrar, editar, excluir: Gerenciar | na página e na rota |
| `/desempenho/fechamento` (folha de bônus, fechar, reabrir, exportar) | Desempenho › **Gerenciar** | na página e em cada rota |
| `/desempenho/configuracao` (valor das faixas, participantes, modo TV) | Desempenho › **Gerenciar** | na página e em cada rota |
| modo TV (`/relatorio/desempenho/<token>`) | sem login, só leitura | **nunca** tem valor em reais |

As abas do módulo seguem a mesma régua: "A revisar" só aparece para quem revisa; "Fechamento" e
"Configuração", só para quem gerencia.

**O valor em reais sai do servidor, não da tela:** `veValores` devolve verdadeiro só com Gerenciar,
e o painel e a ficha do dashboard mandam bônus `null` e faixa sem valor para todo mundo que não
gerencia. No app do colaborador a ficha é sempre a dele, e ali o valor vai — é a regra "R$ só para
quem gerencia **e para o próprio colaborador**", implementada em dois lugares diferentes porque são
duas superfícies diferentes. Conferi e **não mudei nada disso**.

Provado em PostgreSQL real: **treze rotas de dinheiro** (fechar, folha, configuração, ajustes,
perfil criar/editar/excluir, regra salvar/descartar, participante adicionar/tirar, premiação, modo
TV) respondem **403** sem Gerenciar, e as cinco da revisão respondem 403 sem Revisar — com o retrato
do banco **idêntico** antes e depois. Sem sessão, 401. Os prints `*-so-visualiza.png` mostram o
mesmo pela tela: quem só visualiza abre painel, ficha e premiação, e para em /sem-permissão nas
outras três.

## Tela a tela — o que existia × o que mudou

O módulo não tinha **nenhum** toast, **nenhum** ⓘ e **nenhuma** confirmação da casa: avisava por
recado na própria tela, explicava em parágrafos sob cada título e perguntava com diálogos próprios.

### `/desempenho/fechamento` — a mais mexida

| Antes | Depois |
|---|---|
| folha de bônus em `<table>` à mão, com `<tfoot>` de total e colunas escondidas por CSS no celular | **TabelaPro**: colunas escolhíveis, cartões no celular saindo do mesmo dado |
| total do mês no rodapé da tabela | total na **faixa da tabela**: "4 colaboradores · Total do mês R$ 1.000,00" |
| fechar e reabrir não avisavam nada (a tela só recarregava) | **toast**: "novembro de 2026 fechado. Bônus: R$ 1.000,00." e "… reaberto: os valores voltam a ser projeção."; o **erro continua no diálogo** |
| três parágrafos de instrução (folha, premiação, histórico) | ⓘ em cada um dos três títulos |
| "Nenhum mês foi fechado ainda." escrito na tela | `ListaVazia` da casa |

### `/desempenho/colaborador/[id]` (ficha)

| Antes | Depois |
|---|---|
| composição do escore em `<table>` à mão, com três linhas de `<tfoot>` | **TabelaPro**, e o fecho (qualidade · penalidades · escore) na faixa de cima |
| instrução sobre o peso das métricas em parágrafo | ⓘ no título, contando também a regra do "Conta" |
| "Nada registrado em 11/2026." escrito na tela | `ListaVazia` |

O bônus continua vindo do servidor: sem permissão, o card diz "Valor visível só para a gestão".

### `/desempenho/revisao`

| Antes | Depois |
|---|---|
| decisão, reclamação e exclusão não avisavam nada | **toast** em cada uma ("Decisão registrada: conta no escore.", "Reclamação registrada: entra como item a revisar.", "Reclamação excluída.") |
| excluir abria um diálogo próprio | **confirmação da casa**, com o nome e a data do item |
| instrução no alto da lista | ⓘ no título "A revisar" |

O "Conta" e o "Não conta" continuam em diálogo, porque pedem **motivo** — é formulário, não
confirmação. Mês fechado continua travado: o item mostra "reabra para mudar" e o servidor recusa.

### `/desempenho/premiacoes`

Cadastrar e editar avisam por toast; excluir passa pela confirmação da casa, com o título do prêmio.
ⓘ no título da seção, `ListaVazia` quando não há premiação no mês.

### `/desempenho/configuracao`

| Antes | Depois |
|---|---|
| "Ajustes salvos." em verde, fixo na tela | **toast** |
| perfil, regra, participante e modo TV não avisavam | toast em cada um ("Perfil criado.", "Regra salva: vale a partir deste mês.", "Mudança agendada: vale no mês que vem.", "Colaborador adicionado ao perfil.", "Modo TV ligado…") |
| excluir perfil em diálogo próprio; **tirar do ranking** e **descartar a mudança agendada** sem pergunta nenhuma | confirmação da casa nas três, com o que acontece dito na pergunta |
| valores das faixas com `tabular-nums` solto | tokens `PLANILHA.numero` (é planilha editável) |
| instruções de perfis e do modo TV em parágrafo | ⓘ nos dois títulos |

### `/desempenho` (painel)

ⓘ no **título do módulo** (o que é o escore, que é qualidade e não volume, e que valor em reais só
aparece para quem gerencia) e ⓘ em "Por equipe"; `ListaVazia` no perfil sem ninguém. O painel
continua sem nenhum valor em reais.

## O que esta leva não encostou

`lib/desempenho/*` inteiro (escore, painel, servidor, fechamento, penalidades, premiações, medição,
as regras e os erros) e **todas** as rotas de `app/api/desempenho` e `app/api/tecnico/desempenho`.
Não é promessa: um teste compara esses arquivos com o merge-base do master e cai se qualquer um
mudar — e outro teste confere que cada arquivo da lista existe com esse nome (foi assim que a leva
8C pegou um caminho errado numa guarda parecida).

Em particular continuam como estavam: a fotografia do mês em JSONB, reabrir exigindo Gerenciar e
motivo, o desempate da premiação, quem pode revisar penalidade (e que ninguém revisa a própria), e o
409 da revisão em mês fechado.

## Testes

Três arquivos novos, 38 casos:

- `tests/unit/padronizacao-leva9.test.ts` — guardas de fonte: trava de cada tela e de cada rota,
  abas por permissão, `veValores`, TV sem dinheiro, toast no sucesso e erro na tela, confirmação da
  casa nas ações destrutivas, TabelaPro sem `<table>` à mão, tokens de planilha, ⓘ, vocabulário, e o
  diff contra o master nos arquivos de lógica;
- `tests/unit/padronizacao-leva9-pg.test.ts` — PostgreSQL real: 403/401 nas rotas de dinheiro e de
  revisão **com o banco idêntico**; valor em reais só para quem gerencia; fechar, reabrir (com
  motivo) e o 409 da revisão em mês fechado;
- `tests/unit/padronizacao-leva9-ui.test.ts` — DOM de verdade: os toasts do fechamento e da revisão,
  o erro que fica no diálogo sem mudar a tela, a folha com as mesmas linhas na tabela e nos cartões,
  e a confirmação que, recusada, não chama o servidor.

**Testes existentes atualizados (2):** `desempenho-ui` e `desempenho-fechamento-ui` cobriam o DOM
antigo — o `<tfoot>` da folha, as colunas escondidas por CSS, os diálogos próprios de exclusão, o
recado verde dos ajustes e as instruções em parágrafo. As expectativas passaram a cobrar o
comportamento novo (cartões, faixa, toast, confirmação, ⓘ), sem afrouxar nada: onde antes se exigia
um texto, agora se exige o ⓘ com aquele rótulo; onde se contava um diálogo, conta-se a chamada à
confirmação.

**Mutação: 7 quebras propositais, 7 pegas.** Tirar o Gerenciar da tela de fechamento, afrouxar a
rota de fechar, deixar o valor em reais vazar para quem só visualiza, calar o toast do fechamento,
pular a confirmação do excluir, calar o toast da decisão, tirar o total da faixa.

Suíte inteira verde.

## Prints

`docs/prints/padronizacao-leva9/` — 50 arquivos, `antes-*` e `depois-*`, desktop e celular: as seis
telas, o ⓘ do módulo aberto, a folha de bônus com dinheiro de verdade (o fechamento abre no mês
anterior, que está vazio na massa — por isso há um print do mês corrente), o diálogo de fechar o mês
e o aviso depois dele, a pergunta antes de excluir na revisão, e as seis telas vistas por quem só
tem Desempenho › Visualizar.

## ❓ Para conferir

1. **O seletor de colaborador da reclamação continua um `<select>` simples.** O padrão da casa pede
   `SeletorCadastro` com cadastro inline, mas ali a lista é de **participantes do Desempenho** — não
   faria sentido cadastrar um colaborador novo de dentro de uma reclamação (o cadastro é de Equipes,
   e participar do ranking é decisão da configuração). Deixei como está; se quiser o cadastro
   rápido mesmo assim, é uma troca pequena.
2. **A composição do escore virou TabelaPro.** São poucas linhas e um fecho, então ganhou menos que
   a folha de bônus; fiz assim para não deixar `<table>` à mão no módulo e para o celular receber
   cartões. Se achar que ali cabia melhor uma lista simples, reverto só essa.
