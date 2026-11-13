# Desempenho (manutenção)

Índice de **qualidade** da manutenção, por colaborador e por mês → ranking por perfil, faixa
(Bronze/Prata/Ouro) e bônus. **Não é volume** e **não é o módulo Projetos** (comissão de vendedor).

Entrega em dois PRs:

- **PR 1 — medir e mostrar**: escore, revisão das penalidades, configuração por perfil, painel,
  ficha, premiação do mês e modo TV.
- **PR 2 — pagar**: fechamento mensal (congela), folha de bônus exportável, quem ganha a premiação,
  histórico e a tela do colaborador no app. Ver [Fechamento do mês](#fechamento-do-mês).

## De onde vem cada número

Nada é digitado para o escore. Tudo sai do que a operação já grava.

| Métrica | Fonte | Regra |
|---|---|---|
| Concluídas no prazo | `atividades_os.concluida_em` (coluna nova) × `prazo` ou, sem prazo, `data_agendada` | No prazo = o **dia** da conclusão (Brasília) não passa do dia de referência. Sem data de conclusão ou sem prazo/agenda: **não se mede** |
| Relatórios completos | `atividade_equipamentos` (atendidos), `checklist_respostas`, `fotos_atendimento`, formulário obrigatório | Por equipamento atendido: a **mesma regra que libera a conclusão no app** (`lib/execucao/pendencias`) + uma foto "antes" e uma "depois" (quando o perfil exige) |
| Avaliação do cliente | `os_aceites.avaliacao`, via `avaliacoesPorTecnico` / `osAvaliadas` (`lib/os/aceite-server`) | Média das notas (1 a 5) ÷ 5 → 5 estrelas = 100%, 4 = 80% |
| Retorno | OS com atividade de tipo marcado como **corretiva**, aberta até N dias depois do **último** serviço feito no mesmo equipamento (`atividade_equipamentos.feito_em`) | Vai para "a revisar", para quem executou esse último serviço |
| Ressalva do cliente | `os_aceites.observacao` (ressalva escrita no aceite), **com nota ou sem** | Um item por aceite e por colaborador que executou a OS. A nota, quando existe, aparece na descrição do item |
| Reclamação | Registro manual (telefone, WhatsApp), opcionalmente ligado a uma OS | Nasce "a revisar" |

**A data de conclusão não existia.** Até aqui a atividade só guardava o status. `concluida_em` passa a
ser gravada em cada conclusão (no app, a hora do **toque** no aparelho, mesmo que a fila chegue
depois; reabrir limpa). As atividades concluídas antes ficam **sem data** — sem medição nessa
métrica, nunca zero.

## O escore

```
base   = média ponderada das métricas QUE TÊM MEDIÇÃO no mês (pesos do perfil)
escore = base − pontos das penalidades marcadas "conta"   (entre 0 e 100)
```

- Métrica sem dado no mês **não vira zero**: sai da conta e o peso é repartido entre as outras.
- Sem nenhuma métrica medida não há escore ("Sem medição").
- **Meta mínima** é o portão: abaixo dela não há faixa nem bônus.
- **Faixa** = a mais alta que o escore alcança. **Bônus projetado** = o valor da faixa.

## Penalidade nunca é automática

1. Retorno e **toda ressalva escrita** pelo cliente são **detectados** e entram na lista **A revisar**.
2. Só pesam depois de alguém com *Desempenho › Revisar penalidades* marcar **Conta**, com motivo.
   **Não conta** também pede motivo. Dá para **rever** a decisão.
3. **Nunca se penaliza quem registrou o problema.** Não é retorno quando, no serviço anterior, o
   colaborador apontou *atenção* no checklist daquele equipamento, abriu ocorrência (PMOC) ou serviço
   adicional. OS corretiva nascida de ocorrência registrada ou de orçamento aprovado também não.
4. Ninguém revisa a própria penalidade.
5. A detecção é idempotente (uma chave por fato e colaborador) e só considera fatos a partir do mês
   em que a empresa abriu o módulo.

## Perfis e regras

- **Perfil de desempenho** é cadastro próprio (o cadastro de Cargos é texto livre e não diz se a
  pessoa é de preventiva ou corretiva). A empresa nasce com Preventiva, Corretiva, Instalação e
  Encarregado, todos editáveis e **sem regra**.
- Cada colaborador participa por **um** perfil. Sem perfil = fora do ranking.
- **Colaborador de campo** é medido pelas atividades que executou. **Encarregado (gestão)** é medido
  pelas atividades e avaliações das equipes **ativas** que lidera (a atividade é da equipe, ou tem um
  membro dela entre os executores).
- **Regra do perfil**: pesos (somam 100; zero tira a métrica), exigir foto antes/depois, pontos por
  retorno e por reclamação, meta mínima e faixas com o valor do bônus.
- **Travada no mês**: a primeira regra vale já no mês corrente; qualquer mudança é gravada para o
  **mês seguinte** e não retroage (`desempenho_regras.vigente_desde`).

### Nota e ressalva são sinais separados

- A **nota** do cliente pesa na **média da avaliação** — e só nela. Nota baixa **não é item de
  penalidade**, com ou sem comentário.
- A **ressalva** é o que o cliente **escreveu** no aceite. É um sinal qualitativo à parte: **toda
  ressalva vira item "A revisar"**, tenha o cliente dado nota ou não. Um cliente que dá 5 estrelas e
  escreve um problema não tem a reclamação escondida pela nota alta.
- Quem revisa decide: **Conta** ou **Não conta**, com motivo. A descrição do item traz a nota
  (`OS-123: ressalva do cliente (nota 5 de 5) — "…"`), para as duas coisas serem vistas juntas —
  inclusive quando a nota já foi baixa e a ressalva repete o mesmo problema.
- Um item por aceite e por colaborador (chave `ACEITE:<aceite>:<colaborador>`): detectar de novo não
  duplica nem mexe no que já foi decidido.

Vão para revisão: **retorno**, **ressalva do cliente** e **reclamação** registrada pela gestão.

Os itens antigos de **nota baixa** (da primeira versão) continuam gravados, mas não aparecem nem
descontam: o filtro é um só, `lib/desempenho/itens-validos.ts`, usado na medição, na lista, na
contagem, na ficha e na decisão. Nada foi apagado. A coluna `desempenho_config.nota_baixa_ate` ficou
sem uso.

## Fechamento do mês

Antes de fechar, tudo é **projeção**: escore, faixa e bônus mudam a cada dado novo.

**Fechar** (`/desempenho/fechamento`, *Desempenho › Gerenciar*) grava uma fotografia do mês:

- `desempenho_fechamentos` — a competência, a versão, quem fechou e quando, o painel inteiro como
  estava (com valores), os premiados e o total da folha;
- `desempenho_fechamento_linhas` — a **folha de bônus**: uma linha por colaborador (nome, perfil,
  posição, escore, faixa e valor).

Com o mês fechado:

- painel, ficha e app do colaborador **leem a fotografia** — dado novo não muda nada;
- a revisão fica travada (decidir, rever, registrar, editar ou excluir reclamação respondem 409);
- a detecção não cria item novo naquele mês e a contagem "a revisar" não o considera.

Antes de fechar, o servidor avisa e pede confirmação explícita quando: o mês ainda está **em
andamento**; há itens **a revisar** (eles ficam de fora). Mês futuro e mês sem participantes não
fecham.

**Reabrir** exige *Gerenciar* e **motivo** (10 caracteres ou mais). O fechamento não é apagado: fica
no histórico como *Reaberto*, com quem, quando e por quê. Fechar de novo cria a **versão seguinte**.

### Folha de bônus

Lista por colaborador (perfil, posição, escore, faixa, valor) + total + premiados. **Exporta em CSV**
(`;`, vírgula decimal, UTF-8 com BOM — abre direto no Excel), no arquivo
`bonus-desempenho-AAAA-MM[-vN].csv`.

O valor é só **registrado**. Imposto, encargo e o pagamento em si são do financeiro / custo de
pessoal: aqui **não se calcula encargo** e nada é lançado sozinho em outro módulo.

### Quem ganha a premiação

O **maior escore acima da meta**, no escopo do cadastro (um perfil ou todos). Empate, nesta ordem:

1. maior **média de avaliação** do cliente (quem não foi avaliado perde para quem foi);
2. **menos penalidades** que contaram;
3. **mais atividades no prazo**;
4. ainda empatado: **dividem o prêmio**, e a tela avisa.

A folha e o histórico dizem por qual critério saiu o resultado. No mês aberto é projeção; no fechado
fica congelado junto com a folha.

### Histórico

Todos os fechamentos da empresa, do mais novo para o mais antigo, incluindo os reabertos. Só leitura:
dá para abrir e exportar a folha de qualquer versão.

### O colaborador no app

Aba **Desempenho** do app (só para quem participa): escore do mês, posição no ranking do perfil,
composição com os números, o que descontou, prêmio em disputa e o bônus — *projetado* no mês aberto,
*fechado* depois. Mostra a **média** das avaliações, nunca cada comentário: o texto do cliente
(ressalva, reclamação) não sai do servidor para o app; o motivo da decisão da gestão, sim.

## Individual é a base

Numa atividade de equipe, **todos os executores levam o resultado, uma vez cada** (responsável e
equipe da atividade). A visão por equipe é só um resumo: a média dos escores dos membros que
participam.

## Telas

| Rota | O que é | Permissão |
|---|---|---|
| `/desempenho` | Painel: ranking do mês por perfil, prêmio em disputa, resumo por equipe | Visualizar |
| `/desempenho/colaborador/[id]` | Ficha: escore, composição com os números, faixa, bônus projetado ou fechado | Visualizar |
| `/desempenho/fechamento` | Fechar e reabrir o mês, folha de bônus, exportação, histórico | Gerenciar |
| `/desempenho/revisao` | Lista "A revisar", decisão com motivo, reclamação manual | Revisar penalidades |
| `/desempenho/premiacoes` | Premiação do mês (texto + imagem) | Visualizar (cadastro: Gerenciar) |
| `/desempenho/configuracao` | Perfis, regras, participantes, ajustes, link da TV | Gerenciar |
| `/relatorio/desempenho/[token]` | **Modo TV**: sem login, só leitura, atualiza a cada minuto | o link |
| `/tecnico?ver=desempenho` | App do colaborador: o desempenho **dele** | ser participante |

**Valores em reais** (bônus e valor das faixas) só saem do servidor para quem tem *Gerenciar* — e
para o próprio colaborador, na ficha dele (`GET /api/tecnico/desempenho`). O modo TV monta a resposta
campo a campo: posição, nome, escore e faixa. Não há valor, composição nem penalidade nela.

## Permissão nova

Módulo `desempenho` (seção Equipe): **Visualizar**, **Revisar penalidades**, **Gerenciar**.
Perfis de acesso já existentes não ganham nada sozinhos; o papel ADMIN tem tudo. O preset de
Supervisor nasce só com **Visualizar** — revisar penalidades concede-se explicitamente (perfis de
supervisor que já existem não mudam).

Fechar, reabrir, ver a folha e exportar: **Gerenciar**.

## Banco

`prisma/sql/2026-12-31_desempenho.sql` — aditivo e idempotente. Uma coluna
(`atividades_os.concluida_em`) e sete tabelas: `desempenho_config`, `desempenho_tipos_retorno`,
`desempenho_perfis`, `desempenho_regras`, `desempenho_participantes`, `desempenho_penalidades`,
`desempenho_premiacoes`. Sem enum (tipo, situação e competência "AAAA-MM" são texto).

`prisma/sql/2027-01-01_desempenho_fechamento.sql` (PR 2) — aditivo e idempotente. Duas tabelas:
`desempenho_fechamentos` e `desempenho_fechamento_linhas`. Não altera nem apaga nada do que existe.

## Código

- `lib/desempenho/regras.ts` — regras puras (competência, vigência, métricas, escore, ranking, retorno, validações).
- `lib/desempenho/painel.ts` — da medição para o painel, a ficha e a TV.
- `lib/desempenho/medicao-server.ts` — a medição do mês (poucas consultas, sem laço por atividade).
- `lib/desempenho/penalidades-server.ts` — detecção, lista, revisão, reclamação manual.
- `lib/desempenho/servidor.ts` — configuração, perfis, regras, participantes, painel, ficha, TV.
- `lib/desempenho/premiacoes-server.ts` — premiação do mês.
- `lib/desempenho/fechamento.ts` — regras puras do fechamento (avisos, folha, desempate, CSV, o que quem só visualiza não vê).
- `lib/desempenho/fechamento-estado.ts` — o mês está fechado? (uma consulta, usada por todos).
- `lib/desempenho/fechamento-server.ts` — prévia, fechar, reabrir, histórico, exportação.
- `lib/desempenho/itens-validos.ts` — quais itens de penalidade valem.
- `lib/os/conclusao-atividade.ts` — a data de conclusão da atividade.

## Testes

- `tests/unit/desempenho-regras.test.ts` — regras puras.
- `tests/unit/desempenho-pg.test.ts` — rotas reais com PostgreSQL real.
- `tests/unit/desempenho-ui.test.ts` — telas num DOM de verdade.
- `tests/unit/sql-desempenho.test.ts` — o SQL de produção, comparado com `prisma db push`.
- `tests/unit/desempenho-fechamento.test.ts` — regras puras do fechamento e do desempate.
- `tests/unit/desempenho-fechamento-ui.test.ts` — fechamento, folha, histórico e a tela do app num DOM de verdade.
- `tests/unit/sql-desempenho-fechamento.test.ts` — o SQL do fechamento, comparado com `prisma db push`.

Prints em `docs/prints/desempenho/` e `docs/prints/desempenho-fechamento/`.
