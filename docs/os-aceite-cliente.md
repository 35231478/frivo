# Aceite do cliente na conclusão da OS

A prova de que o cliente **recebeu e aprovou** o serviço. Quando a OS é concluída, ela passa a
aparecer como **"Concluída · Aguardando confirmação do cliente"** até alguém do cliente confirmar —
assinando na tela de quem está no local, ou pelo link de confirmação.

O aceite **não trava nada**: a OS concluída já pode ser faturada, com ou sem a confirmação. O aceite
é um registro à parte, que entra no relatório da OS como prova.

## Como o aceite se liga à OS

- Tabela nova `os_aceites`, **uma linha por OS** (chave única em `ordem_servico_id`). Nasce
  `PENDENTE` no momento em que a OS conclui — pelo app do técnico (status automático) ou pelo
  escritório (status à mão).
- O **status da OS não muda** e não ganhou valor novo: continua `CONCLUIDA`. O "aguardando
  confirmação" é calculado (OS concluída + aceite pendente). Por isso nada do faturamento, dos
  filtros ou dos relatórios existentes foi tocado.
- Cada aceite tem um **token** próprio (o link público). Reabrir e concluir a OS de novo não cria
  outro registro nem troca o link.
- OS **reaberta** com aceite pendente não fica "aguardando" (volta a ficar quando concluir de novo).
  Aceite **já confirmado** continua confirmado mesmo que a OS seja reaberta depois.
- OS concluídas **antes** desta funcionalidade não têm registro: não viram pendência sozinhas. Quem
  tem "OS › Editar" pode clicar em **Enviar ao cliente** nelas, e aí o registro nasce.

## Os dois caminhos

### No local (alguém do cliente está presente)

Depois de concluir a atividade que fecha a OS, o app do técnico mostra **Confirmação do cliente**
com o botão **Cliente assina agora**: o responsável informa o **nome** e **assina no quadro**.

- Funciona **sem sinal**: a assinatura entra na fila do aparelho e sobe quando o sinal voltar. A tela
  já mostra "Confirmado por … (a enviar)".
- Fica gravado: nome, assinatura, data e hora, quem colheu, em qual atividade, e o IP e o navegador
  **do aparelho que colheu** (o do técnico).
- O escritório tem o mesmo quadro na OS: **Colher assinatura** (para quando o cliente está no
  balcão). Pelo escritório a OS precisa estar concluída.
- O app só oferece o aceite na atividade que **conclui a OS** (a última em aberto). Se a OS ainda tem
  outra visita, não oferece.

### Remoto (não há ninguém)

Botão de **um clique** — **Enviar link ao cliente** no app, **Enviar ao cliente** na OS:

1. o **e-mail** sai pelo envio da empresa (Resend), com o modelo "Confirmação do serviço (aceite do cliente)", editável como os outros;
2. o **WhatsApp** abre com a mensagem pronta e o link (wa.me), no aparelho de quem clicou.

Os destinatários são os mesmos do "A caminho / Cheguei": quem abriu o chamado no portal, depois os
contatos de **Ordens** da aba Comunicação do cliente, depois o cadastro. Cliente marcado para não
receber e-mail de OS não recebe. Sem WhatsApp nem e-mail, o link é copiado e a confirmação fica
pendente no portal.

O técnico do app só recebe o **número** do cliente se "Exibir contatos do cliente" estiver ligado em
Equipes › App do colaborador (o e-mail sai do servidor de qualquer forma). O envio precisa de sinal.

## A página de confirmação (link público)

`/relatorio/aceite/<token>` — sem login, só o token. Antes de qualquer botão, o cliente vê:

- **de qual OS se trata**: número, serviço, data da conclusão, equipamentos atendidos;
- o **relatório da OS** inteiro (a versão do cliente), para ler antes de confirmar;
- o formulário: **nome completo** (obrigatório), o aviso de que ficam registrados o nome, a data, a
  hora e o endereço IP, e dois caminhos:
  - **Confirmo o recebimento do serviço**;
  - **Tenho uma ressalva** — abre um campo para o cliente escrever o que ficou pendente ou diferente
    do combinado (5 a 1.000 caracteres) e o botão **Confirmar com ressalva**.

Ao confirmar, o servidor grava **nome + IP + navegador + data/hora** — o mesmo mecanismo da aprovação
do orçamento por link (mesma leitura do IP, mesma troca atômica: dois cliques não confirmam duas
vezes). Se quem confirma está logado no portal **do mesmo cliente**, o contato fica registrado junto.

Não confirma: token inexistente, OS cancelada, OS reaberta, aceite já confirmado.

### A ressalva

"Aceite com ressalva": o serviço **fica confirmado** (não é uma recusa), a OS segue concluída e
faturável, e o que o cliente escreveu fica **no registro do aceite**. A ressalva aparece:

- no cartão do aceite e no selo do cabeçalho da OS ("Confirmada pelo cliente, com ressalva", em tom
  de atenção), e no histórico ("Serviço confirmado pelo cliente, com ressalva", com o texto);
- no relatório/PDF da OS, nas duas versões ("Aceite do cliente, com ressalva");
- na própria página do link e no portal do cliente ("Ressalva registrada: …");
- no **sino** do escritório (abaixo).

Como o cliente já respondeu, a OS sai das pendências dele: o gate do novo chamado não fica cobrando
quem confirmou com ressalva. Depois de confirmado, ninguém troca nem acrescenta ressalva. A ressalva
só existe no caminho remoto (link/portal); a assinatura no local não tem esse campo.

No banco a ressalva mora na coluna `observacao` de `os_aceites` (era o campo "Observação" da primeira
versão da página); no código o campo se chama `ressalva`.

## No portal do cliente

- **Início** e **Novo chamado** mostram, em destaque, as confirmações pendentes:
  "2 serviços aguardando sua confirmação" e, para cada um, `OS-123 · 05/11 · Manutenção preventiva`
  com o botão **Ver e confirmar** ao lado.
- A página do chamado concluído também mostra o pedido de confirmação.

### O gate do novo chamado

| Situação | O que acontece |
|---|---|
| Padrão (opção desligada) | **Soft gate**: mostra as pendências e facilita confirmar, mas o chamado abre normalmente. |
| Opção da empresa ligada, sem pendência | O chamado abre normalmente. |
| Opção ligada, com pendência | O formulário dá lugar ao pedido de confirmar. O servidor também recusa (409). |
| Opção ligada, com pendência, **emergência** | O botão "É uma emergência: abrir chamado agora" abre o formulário na hora. O chamado nasce, as pendências continuam, e o histórico do chamado registra a emergência e quais OS estavam pendentes. |

A opção fica em **Configurações › Portal do cliente**: "Pedir a confirmação dos serviços antes de um
novo chamado". É **por empresa** e nasce **desligada**. A saída de emergência existe sempre: não há
configuração que a tire.

## Aviso no sino do escritório

Quando o cliente confirma, o sino acende — **um aviso por confirmação**, as ressalvas à parte:

| Item do sino | Conta | Leva a |
|---|---|---|
| **Ressalvas de clientes** | confirmações **com** ressalva que ninguém viu | a OS da mais recente |
| **Serviços confirmados pelo cliente** | confirmações **sem** ressalva que ninguém viu | a OS da mais recente |

- Vale para a confirmação pelo link/portal e para a assinatura colhida **pelo técnico** no local (o
  escritório também não sabia). A assinatura colhida **pelo próprio escritório** não vira aviso.
- O aviso **some quando alguém com "OS › Editar" abre a OS** (fica gravado em `os_aceites.visto_em`).
  É o mesmo mecanismo da NFS-e e da resposta do orçamento. Quem só visualiza vê o aviso e a OS, mas
  não o apaga. Some para todos de uma vez, e o sino relê na hora.
- Só é avisado quem tem acesso à OS: precisa de "OS › Visualizar"; o técnico do app, só das OS em que
  tem atividade. OS inativada não avisa. Tudo por empresa.
- Ver o aviso não apaga a ressalva: ela continua na OS e no relatório.

## No escritório

- Cabeçalho da OS: selo **Aguardando confirmação do cliente** / **Confirmada pelo cliente** ao lado
  do status.
- "O que falta": **Aguardando a confirmação do cliente (aceite do serviço)** — ao lado de "faturar",
  sem tirar o faturar.
- Cartão do aceite no topo da OS, logo abaixo do cabeçalho: o último pedido (quando, por onde, para quem) e, depois de confirmado,
  a prova — quem, quando, como (no local × pelo link), IP, a ressalva (se houver) e a assinatura.
- Histórico da OS: "Confirmação do cliente pedida", "Serviço confirmado pelo cliente" e
  "Serviço confirmado pelo cliente, com ressalva".

## No relatório / PDF da OS

Bloco **Aceite do cliente**, antes das assinaturas, nas duas versões (interna e do cliente): quem
confirmou, quando, como, o IP, a ressalva (se houver) e a assinatura desenhada (no aceite no local). Só o
aceite **confirmado** entra; o pendente não é prova de nada.

## Permissões

| Ação | Quem pode |
|---|---|
| Ver o aceite da OS | Ordens de serviço › Visualizar |
| Enviar ao cliente, copiar o link, colher a assinatura | Ordens de serviço › **Editar** |
| Receber o aviso no sino | Ordens de serviço › Visualizar |
| Dar o aviso por visto (abrindo a OS) | Ordens de serviço › **Editar** |
| Técnico do app | Só nas OS em que ele tem atividade; precisa de "Editar" (quem só conclui não colhe) |
| Confirmar pelo link | Não exige login: só o token |
| Ligar o bloqueio do portal | Configurações › Gerenciar |

Tudo conferido na tela **e** no servidor. Tudo por empresa.

## Banco

Dois arquivos, aditivos e idempotentes, sem enum (situação, método e canal são texto):

- `prisma/sql/2026-12-28_os_aceite_cliente.sql` — cria a tabela `os_aceites` e a coluna
  `configuracoes.portal_aceite_obrigatorio` (padrão `false`).
- `prisma/sql/2026-12-29_os_aceite_visto.sql` — cria a coluna `os_aceites.visto_em` (o aviso do sino).

```
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2026-12-28_os_aceite_cliente.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2026-12-29_os_aceite_visto.sql
```

### O toggle que saiu

"Exigir assinatura do cliente na OS" (`configuracoes.os_exigir_assinatura`) existia em Configurações
› Preferências e não fazia nada. Saiu da tela e a API não devolve nem grava mais o campo. A **coluna
continua no banco**, sem uso (apagar coluna é irreversível e quebraria uma versão antiga do sistema
ainda no ar durante a publicação). Quando for a hora de limpar:
`ALTER TABLE "configuracoes" DROP COLUMN IF EXISTS "os_exigir_assinatura";` — junto com a retirada
do campo do `schema.prisma`.

## Onde está o código

| O quê | Onde |
|---|---|
| Regras (estado, textos, gate) | `lib/os/aceite.ts` |
| Servidor (abrir, colher, pedir, confirmar, pendências) | `lib/os/aceite-server.ts`, `lib/os/aceite-rotas.ts` |
| Rotas | `app/api/ordens/[id]/aceite`, `…/aceite/enviar`, `…/aceite/visto`, `app/api/publico/aceites/[token]/confirmar` |
| Sino | `app/api/alertas/route.ts` (contagens), `components/layout/header.tsx` (itens), `lib/ui/sino.ts` (reler na hora) |
| Fila do app (operação `aceite`) | `lib/tecnico/sync.ts`, `lib/tecnico/offline/estado.ts` |
| Telas | `components/os/os-aceite.tsx`, `aceite-assinatura.tsx`, `aceite-publico.tsx`, `components/tecnico/aceite-cliente.tsx`, `components/portal/aceites-pendentes.tsx`, `chamado-form.tsx` |
| Página pública | `app/(publico)/relatorio/aceite/[token]/page.tsx` |
| Testes | `tests/unit/os-aceite*.test.ts`, `tests/unit/sql-os-aceite.test.ts` |
| Prints | `docs/prints/os-aceite-cliente/`, `docs/prints/os-aceite-ressalva-sino/` |
