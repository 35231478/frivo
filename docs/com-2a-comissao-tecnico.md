# COM-2A — Comissão do técnico (motor e escritório)

A COM-1 pagava o **vendedor**. A COM-2 liga o papel **Executor**: o técnico ganha pelo que executou, com trava de
qualidade, revisão de retorno e teto mensal.

- **Este PR (2A):** o motor, o escritório (Configurações › Comissões e Desempenho › Fechamento) e o extrato.
- **COM-2B:** o app ao vivo (o card no Meu dia, a Prevista que sobe na hora e funciona offline).

Prints antes e depois: `docs/prints/com-2a/`, com dados fictícios do banco local, no desktop e no iPhone.

> 🔵 **Banco**: `prisma/sql/2027-02-14_comissao_executor.sql`. **Rodar ANTES do merge.** Idempotente.
>
> **Aditivo, com UMA flexibilização:** `comissoes.orcamento_id` deixa de ser obrigatório (`DROP NOT NULL`), porque a
> comissão do técnico nasce da OS, que pode não ter orçamento.
> - Um `CHECK` garante que toda comissão vem de um orçamento **ou** de uma OS.
> - Nada é apagado nem convertido: as comissões do vendedor ficam exatamente como estão.
>
> **O que o SQL acrescenta:**
> - `comissao_regras`: `divisao` (padrão `IGUAL`) e `divisao_cargos`;
> - `comissoes`: `ordem_servico_id`, `atividade_id`, `equipamento_id`, `parte` (padrão 1), `divisao` e `chave`
>   (única por empresa);
> - `comissao_lancamentos`: `teto_competencia`;
> - `configuracoes`: `comissao_executor_quando` (padrão `CONCLUSAO_OS`) e `comissao_retorno_dias` (padrão 30);
> - duas tabelas novas: `comissao_tetos` e `comissao_revisoes`.
>
> Testado no PostgreSQL real: roda 2×, as linhas antigas ficam como estavam e o `migrate diff` fica vazio.

## As decisões aprovadas

1. **A unidade é o equipamento atendido × a linha de serviço da OS.**
   - Na **% da venda** (e na % do lucro), cada equipamento **atendido** ganha a parte da linha: o valor da linha ÷ os
     equipamentos **vinculados** à OS. O vinculado que ninguém atendeu não gera nada.
   - No **valor fixo**, é R$ por equipamento atendido.
   - **OS sem equipamento** (módulo desligado ou tipo que não pede): a unidade é a própria linha, inteira, com a OS
     concluída, para os técnicos de todas as atividades.
   - **Limite conhecido:** a OS não diz qual linha é de qual equipamento. Com duas linhas (ex.: limpeza para 8 splits e
     recarga para 1), cada equipamento atendido ganha a parte das **duas**. Na % da venda a soma bate com o valor da
     OS; no valor fixo, o técnico ganha o fixo da recarga em cada um dos 8. Para isso valer só onde houve recarga, a
     regra fixa pode ser por serviço ("Um serviço") ou o escritório pode separar as OS.
2. **O excedente do teto vai para o mês seguinte.** Nada se perde, e o modelo da COM-1 não muda.
3. **A fila de revisão é própria**, em Desempenho › Fechamento, com os dias configurados em Comissões. Funciona sem o
   programa de bônus.
4. **Dois PRs:** este é o 2A; o 2B leva ao app.

## Como funciona

### Dois ou mais técnicos (a divisão)

Cada técnico recebe pela **regra que vence para ele** (pessoa > cargo > todos, como no vendedor), vezes a **parte
dele** pela divisão daquela regra:

- **Igual** (padrão): cada técnico da atividade recebe a mesma parte;
- **Para quem executou**: vai para quem marcou o equipamento como feito. Sem essa marca, a divisão vira Igual;
- **% por cargo**: pelo cargo de quem estava lá, normalizado sobre os presentes. Exemplo: 60/40 com um técnico e dois
  ajudantes = 42,86% / 28,57% / 28,57%.

A parte e a divisão ficam **congeladas** na comissão: mudar a regra depois não mexe no que já nasceu.

**Técnico sem login:** entra na conta da divisão (a parte dele **não** vai para os colegas), mas não recebe. Comissão
é paga a usuário, ligado ao colaborador pelo e-mail, como na COM-1.

### A trava de qualidade

- **Prevista:** a comissão do equipamento só **nasce** quando ele está feito **e** com o relatório completo. É a mesma
  regra que libera a conclusão no app (`lib/execucao/pendencias`): checklist, medições, as fotos e observações pedidas
  e o formulário obrigatório.
- **Relatório reaberto antes de liberar:** a Prevista some.
- **Depois de liberada:** relatório incompleto ou OS cancelada viram **estorno**.
- **O equipamento feito em duas atividades da mesma OS** conta uma vez, na última.

### Quando fica devida (o gatilho do técnico)

Configurações › Comissões › **Comissão do técnico** › "Liberar a comissão do técnico":

- **Na conclusão da OS** (padrão);
- **No aceite do cliente**;
- **No recebimento da OS:** proporcional ao que entrou nas faturas da OS. Fatura com linhas de outras OS conta só a
  parte desta.

O gatilho fica congelado na comissão, como o "quando" do vendedor.

### O retorno no mesmo equipamento

**O que é retorno:** outra OS de um **tipo de retorno**, no mesmo equipamento, aberta até N dias depois do serviço
(padrão 30). O retorno "volta" do **último** serviço antes dele, a mesma regra do Desempenho.

**Fica de fora:**
- a OS que nasceu de orçamento ou de ocorrência do PMOC, que é serviço previsto;
- o técnico que **registrou** o problema no serviço: Atenção no checklist, ocorrência ou serviço adicional.

**O que acontece:** a comissão fica **em revisão**. Não libera nada a mais e aparece "Em revisão" no extrato do técnico.

**Quem decide:** em Desempenho › Fechamento › **Estornos a revisar**:
- **Estornar** zera a comissão; o que já foi pago desconta no mês seguinte, como na COM-1;
- **Manter** libera normalmente;
- sempre com motivo;
- **ninguém decide a própria**, e a revisão decidida não muda de novo.

**Os tipos de retorno** são **a mesma lista do Desempenho**, editável também em Comissões: mudar aqui muda lá. **Sem
nenhum tipo marcado, a revisão fica desligada**, e a tela avisa. Assim uma preventiva de rotina no mesmo equipamento
não vira "retorno".

### O teto mensal

Configurações › Comissões › **Teto mensal**, por pessoa ou por cargo (a pessoa vence o cargo).

**No fechamento:**
- a pessoa recebe **até o teto**;
- o excedente vira um par de lançamentos: −excedente no mês, pago junto (a pessoa recebe o teto), e +excedente no 1º
  dia do mês seguinte, que entra no próximo fechamento.

**Reabrir o mês** desfaz o par. Se o excedente já entrou no fechamento do mês seguinte, aquele mês precisa ser reaberto
antes.

### O extrato e o relatório

- **"Minhas comissões"**, no perfil e no app, mostra cada OS com o equipamento no item ("Manutenção preventiva de
  split — Cassete recepção"). Só o valor da pessoa: nunca a base, o custo, a margem nem o valor dos colegas.
- **O relatório do mês** (Fechamento) traz as OS do técnico ao lado das vendas: por emissão, as comissões nascidas no
  mês; por recebimento, o dinheiro da OS no mês.

### Quando a conta roda

Como na COM-1, nada é empurrado pela operação. A conta é **refeita a partir do estado real da OS** quando:
- alguém olha o extrato, a prévia do fechamento ou fecha o mês;
- uma revisão é decidida.

Refazer é idempotente: há uma chave única por atividade × equipamento × linha × pessoa, e a empresa fica travada
durante a conta. Entram as OS que já têm comissão do técnico e as que mudaram nos últimos 180 dias.

## Mudanças em código compartilhado

- **`lib/comissoes/servidor.ts` (COM-1):**
  - `sincronizarComissoes` também refaz a conta do técnico, menos quando é só de alguns orçamentos;
  - `recebimentoDaVenda` virou `recebimentoDaOrigem`, por orçamento ou por OS. A linha de fatura sem orçamento não
    conta mais como "desta venda";
  - o extrato e o relatório agrupam por chave (orçamento ou `os:<id>`);
  - `comissoesDoMes` aplica o teto;
  - `salvarRegra` grava e confere a divisão (os cargos precisam ser da empresa).
- **`lib/comissoes/regras.ts`:** `PAPEIS_ATIVOS` com o Executor; a divisão na regra; a configuração do técnico
  (opcional: a tela antiga continua funcionando).
- **`lib/desempenho/fechamento-server.ts`:** o teto ao fechar e desfeito ao reabrir.
- **`lib/desempenho/medicao-server.ts`:** `relatoriosDasAtividades` exportado e com o `equipamentoId` (campo a mais).
- **`app/api/configuracoes/route.ts`:** a tela geral não sobrescreve os campos novos de Comissões.
- **Telas:** `comissoes-client.tsx` (regra do Executor, seção do técnico, teto), `fechamento-client.tsx` (a fila),
  `minhas-comissoes.tsx` e `relatorio-comissoes.tsx` (a chave por OS).
- **Não feito nesta leva:** uma entrada no sino ou em Pendências para as revisões. O Desempenho também não põe o "A
  revisar" dele lá; a fila fica no Fechamento, com o contador.

## Testes

| Arquivo | O que trava |
|---|---|
| `com2-executor` (20, regra) | a unidade (÷ vinculados, sem equipamento, a chave); a divisão (igual, para quem executou, % por cargo normalizado, os casos que viram igual); o valor de cada um pela regra dele; o alvo de cada gatilho, a trava, a revisão (segura, estorna, mantém); o retorno (o último serviço, os dias); o teto (pessoa > cargo, menor, excedente, dezembro); os schemas |
| `com2-executor-pg` (17, PostgreSQL real) | a unidade e a divisão igual; a trava (responder o checklist gera, reabrir antes de liberar tira); o extrato do técnico sem base nem colegas; a conclusão libera e o cancelamento estorna; % por cargo e para quem executou, com a regra congelada; OS sem equipamento e técnico sem login; o retorno (sem tipo fica desligado, abre revisão, segura, manter libera, estornar estorna, quem registrou e a OS de orçamento não contam); outra empresa; o teto no fechamento e ao reabrir; a configuração (tipo de outra empresa recusado, tela antiga e tela geral não apagam); os gatilhos aceite e recebimento (fatura com outra OS); teto e revisão pelas rotas (permissão, a própria, decidida de novo, outra empresa); o extrato refaz a conta sozinho; o relatório com as OS (a cancelada fora) |
| `com2-ui` (11, tela) | a regra do Executor com a divisão e o % de cada cargo; a do vendedor sem divisão; editar abre com a divisão; a seção do técnico (gatilho, dias, tipos, aviso de desligado, máximo 365); o teto (criar, erro, excluir); a fila (some sem revisão, contador, motivo mínimo, erro do servidor, recarrega); o extrato com a OS e "Em revisão" |
| `sql-com2-executor` (4, PostgreSQL real) | o SQL de produção: 2×, o que existia fica, a comissão só da OS vale e de nenhuma das duas não, a chave não repete, os CHECKs, só acrescenta (a única flexibilização é o `orcamento_id`), `migrate diff` vazio |

**Testes da COM-1 atualizados de propósito:**

- `comissoes` (2): o Executor passou a ser aceito (o Responsável segue recusado); `normalizarRegra` devolve a divisão.
- `comissoes-pg` (1): a regra recusada passou a ser a do Responsável.
- `comissoes-ui` (3): o Executor sem o "(em breve)"; a tela recebe e grava a configuração do técnico; o extrato tem a
  chave.
- `comissoes-app` (1): o extrato tem a chave.
- `sql-comissoes` (1): o SQL da COM-1 "rebobina" o banco e roda a COM-2 por cima antes de comparar com o schema.

**Mutação: 55 mutantes.**
- Na 1ª rodada sobraram 8:
  - 3 eram **equivalentes** (o código fazia a mesma coisa sem a linha mutada) e saíram do código, que ficou mais simples;
  - 5 eram **buracos** e viraram prova: quem registrou o problema, a OS de orçamento, o extrato que sincroniza sozinho,
    a fatura com outra OS e o relatório sem a OS cancelada.
- **52/52 mortos.**
