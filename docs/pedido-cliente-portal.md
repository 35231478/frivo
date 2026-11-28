# PC-2 — Pedido do cliente no portal + lembretes

Continuação da PC-1 (#280). Antes, o escritório recebia o pedido do cliente por e-mail ou WhatsApp e informava à
mão; o portal não mostrava nada, e ninguém lembrava o comprador. Agora:

1. o **comprador** vê no portal o que aguarda o pedido de compra e **anexa** o pedido ali;
2. o escritório **confere** e **confirma** (liga às OS e o faturamento segue) ou **recusa com motivo** (o cliente vê);
3. o sistema **lembra** o contato de compras por **e-mail**, nos dias de uma régua configurável.

**Termos:** no portal, "Pedido de compra" (o nome que o cliente usa); no escritório, "Pedido do cliente".

> 🔵 **Banco: NÃO aplicado.** O SQL está em `prisma/sql/2027-02-12_pedido_cliente_portal_lembretes.sql`. Ele é
> aditivo e idempotente, depende do SQL da PC-1 e o Zé aplica no Neon **antes do merge**.

## Levantamento (antes)

| Ponto | Antes (PC-1) | Agora |
|---|---|---|
| Portal | nada sobre o pedido (`antes-03`) | menu **Pedido de compra**: o que aguarda, o envio do pedido e a situação de cada um |
| Quem informa o pedido | só a equipe, na gaveta da OS (`antes-01`) | também o comprador, pelo portal (fica em conferência) |
| Aviso ao escritório | só o sino das OS atrasadas | + sino, painel de pendências e push **"Pedidos do cliente para conferir"** |
| Cobrar o comprador | à mão | e-mail automático nos dias da régua (padrão 3, 7 e 15) |
| Configurações | só o prazo do aviso do sino (`antes-02`) | + lembretes ligados/desligados e a régua |
| Ficha do cliente | contato de compras | + "Lembrar o contato de compras por e-mail" |

## Portal: "Pedido de compra"

**Quem vê** (`lib/pedido-cliente/lembretes` › `podePedidoNoPortal`): o cliente (ou alguma unidade dele) exige o pedido
**e** o contato é o comprador:

- tem a permissão nova do portal **"Enviar pedido de compra"** (`enviarPedidoCompra`), **ou**
- o e-mail dele é o **e-mail de compras** da ficha do cliente (sem diferença de maiúsculas). É a pessoa que recebe os
  lembretes, então o link do e-mail funciona para ela sem configurar nada.

Nenhum perfil existente muda. Quem não é comprador não vê o menu, e a página mostra "Sem permissão".

**A tela** (`/portal/pedidos-compra`):

- **Aguardando pedido de compra:** OS e orçamentos aprovados do **próprio cliente** que aguardam o pedido.
  - Mostra nº, unidade, data de conclusão (ou "Em execução"), há quantos dias, valor e o **Relatório (PDF)**
    (o link público do relatório da OS) ou o orçamento.
  - O orçamento cuja OS gerada já está na lista não aparece duas vezes.
  - O que já tem um pedido **em conferência** aparece com "Pedido nº X enviado — em conferência", sem caixa de marcar.
- **Enviar o pedido de compra:**
  - marca um ou mais serviços (com um só, ele já vem marcado), nº (obrigatório), data (dd/mm/aaaa), valor e
    **arquivo** (PDF ou foto, obrigatório) e observação;
  - o servidor confere cada item: do próprio cliente, aguardando, fora de outra conferência; senão, recusa;
  - limite de 10 envios por contato e 30 por IP por hora.
- **Pedidos de compra enviados:** situação de cada um (Recebido — em conferência · Confirmado · Recusado). O recusado
  mostra o **motivo** do escritório, também no topo da página.
- **Início do portal:** card "Aguardando pedido de compra" e aviso com a quantidade.

**Enviado, NADA é liberado ainda.** O pedido nasce em `pedidos_cliente` com `origem = PORTAL` e
`situacao = CONFERIR`. As OS que ele cobre ficam em `os_propostas` / `orcamentos_propostos`, **sem** ligar
`pedido_cliente_id`. Por isso:

- a etiqueta continua "Aguardando pedido";
- a fatura e a NFS-e continuam travadas;
- tudo o que a PC-1 já faz segue igual.

A trilha da OS registra "Pedido de compra recebido pelo portal". O escritório recebe o push.

## Escritório: conferir

- **Etiqueta "Pedido recebido — conferir"** (OS, orçamento e listas): 1 clique abre a gaveta **Conferir pedido do
  cliente**, que mostra:
  - cliente, nº e data, valor e o que o pedido cobre (com o total);
  - quem enviou e a observação;
  - o arquivo e o alerta da PC-1 quando o valor é menor que o total.
- **Confirmar pedido:**
  - liga as OS e os orçamentos **pelo mesmo caminho** do pedido informado pela equipe (`ligarAoPedido`): propagação
    orçamento ⇄ OS, histórico, nº na fatura, e a fatura "Aguardando PC" segue sozinha;
  - o que ganhou outro pedido no meio da conferência fica como está;
  - duas confirmações ao mesmo tempo ligam uma vez só (a segunda recebe 409).
- **Recusar…:** pede o motivo (5 a 300 caracteres), que o cliente vê no portal. Nada é ligado, e os serviços voltam a
  aguardar (o comprador pode enviar outro pedido).
- **Quem pode:** quem já informa o pedido do cliente (PC-1: editar OS/orçamentos ou lançar faturas).
- **Sino, painel de pendências e push** "Pedidos do cliente para conferir":
  - um pedido: abre a OS; mais de um: a lista `/ordens?pedido=conferir`;
  - o push é um tipo novo, **"Pedido do cliente recebido pelo portal"** (escritório que vê OS; o técnico não recebe).
- **"Último lembrete em …"**: ao lado da etiqueta no cabeçalho da OS/orçamento e no tooltip das listas.

## Lembretes por e-mail

**Configurações › Orçamentos e propostas › Pedido do cliente:**

- "Lembrar o contato de compras por e-mail" (ligado);
- **Enviar nos dias** (padrão **3, 7, 15**): de 1 a 6 dias, entre 1 e 90.

**Ficha do cliente › Cobrança e faturamento:** "Lembrar o contato de compras por e-mail", desligável por cliente.

**A rotina** (`/api/cron/lembretes-pedido`, `vercel.json` às 11:41 UTC = 8:41 em Brasília, com `CRON_SECRET` no
padrão das outras):

- Por cliente que exige o pedido, com e-mail de compras e lembretes ligados na empresa e no cliente.
- **O que entra:** o que aguarda o pedido **agora**. O resolvido (pedido informado ou confirmado, liberado sem pedido,
  faturado, cancelado) já não vem, e o que está **em conferência** também não.
- **A etapa** de cada item é o maior dia da régua já alcançado desde o início da espera: a conclusão da OS; no modo
  "para executar", a aprovação.
- **Sai um e-mail** quando algum item chegou a uma etapa ainda não enviada. O e-mail:
  - lista **tudo** o que está pendente (nº, conclusão, valor, há quantos dias), com o total;
  - leva o botão **"Enviar o pedido de compra"**, que abre o portal;
  - usa o template `PEDIDO_CLIENTE_LEMBRETE`, editável em Configurações › E-mails (`antes/depois-21`).
- **Pulou etapas** (o 1º lembrete no 20º dia): vai só a maior. Nunca três e-mails.
- **Registro:** cada item listado fica em `pedidos_cliente_lembretes` e na **trilha da OS**:
  - "Lembrete do pedido do cliente · Enviado a … (lembrete de 7 dias)";
  - "(na lista do lembrete)" quando o item foi junto sem etapa nova.

  No orçamento, o registro vai para o evento.

**Sem duplicar:**

- Antes de enviar, a rotina **grava** as chaves devidas. A chave é única: `os:<id>:<etapa>`.
- Se outra rodada já gravou (rodou de novo, ou duas ao mesmo tempo), nada sai.
- O item que só foi junto na lista ganha uma linha com a chave do envio. Ela nunca segura uma etapa, e o "último
  lembrete" é o último e-mail em que o item apareceu.
- **Envio que falha:** as chaves gravadas são apagadas e a rodada seguinte tenta de novo.

**Avisos para a 1ª rodada em produção:**

- **Pendências antigas:** quem já espera há mais de 15 dias recebe **um** e-mail (a etapa 15) na primeira manhã. Se
  isso não for desejado, desligue os lembretes em Configurações antes do deploy e ligue quando quiser.
- **E-mail da empresa:** sem a configuração de e-mail completa (Configurações › E-mails), nada sai, e o
  `email_log` registra a falha.
- **Autor na trilha:** o histórico da OS exige um usuário. A trilha do lembrete e do pedido recebido pelo portal usa
  o administrador/gerente mais antigo da empresa, o mesmo do chamado aberto pelo portal.

## O SQL (🔵 não aplicado)

`prisma/sql/2027-02-12_pedido_cliente_portal_lembretes.sql`. Só acrescenta (`IF NOT EXISTS`); nada é apagado nem
atualizado.

- **`pedidos_cliente`:**
  - colunas `origem` (`ESCRITORIO`), `situacao` (`CONFIRMADO`), `os_propostas`, `orcamentos_propostos`,
    `enviado_por_contato_id`, `conferido_em`, `conferido_por_id` e `motivo_recusa`;
  - índice `(empresa_id, situacao)`.
- **`configuracoes`:** `pedido_lembretes_ativo` (true) e `pedido_lembretes_dias` (3, 7, 15).
- **`clientes`:** `pedido_lembretes_ativo` (true).
- **Tabela nova `pedidos_cliente_lembretes`**, com a `chave` única.

Os pedidos que já existem ficam "do escritório, confirmados": nada muda para eles.

Testado em PostgreSQL real (`sql-pedido-cliente-portal`):

- roda 2×, e o que foi gravado entre as rodadas não é desfeito;
- os padrões estão certos;
- a chave é única;
- `migrate diff` vazio.

## Testes

| Arquivo | O que trava |
|---|---|
| `pedido-cliente-portal` (19, regra) | régua (ler, padrão, texto), etapa, plano do e-mail (devido, já enviado, pular etapas, desligado, sem e-mail), linha e variáveis do e-mail (escapado), template formal, quem vê no portal, termos, motivo, push, sino e painel, cron no vercel.json e no middleware, limite, SQL só aditivo |
| `pedido-cliente-portal-pg` (15, PostgreSQL real) | portal só do próprio cliente (o orçamento da OS gerada não aparece duas vezes) (outro cliente e outra empresa recusados), sem permissão, troca de senha pendente, sem arquivo, enviado = nada ligado e faturamento travado, trilha, push, sino, etiqueta, GET, permissão de conferir, recusar (motivo, o cliente vê, volta a aguardar), confirmar (liga, libera, fatura "Aguardando PC" segue, o do meio fica, duas confirmações = uma); cron: um e-mail por cliente, cada empresa no seu, resolvido e em conferência fora, rodar de novo e duas rodadas ao mesmo tempo sem duplicar, a etapa seguinte, "na lista", pular etapas, falha volta, desligado na empresa/cliente, sem e-mail, régua da empresa, rota com CRON_SECRET (sem segredo, desligada; com o certo, roda) |
| `pedido-cliente-portal-ui` (13, tela) | lista do portal (PDF, em conferência sem caixa, em execução), validação, corpo enviado, erro do servidor, enviados e recusado com motivo, menu só do comprador; conferir (abre pela etiqueta, confirmar, recusar exige motivo, erro fica); "Último lembrete em …"; régua em Configurações |
| `sql-pedido-cliente-portal` (5, PostgreSQL real) | o SQL de produção |

- **Mutação: 36 mutantes, 36 mortos** (regra, rotina, portal, conferência, rotas, telas). Os 3 que sobreviveram na
  1ª rodada viraram provas: a consulta da rotina pula o cliente desligado; o orçamento cuja OS gerada está na lista
  não aparece duas vezes; sem `CRON_SECRET` a rota responde 401 (o teste antigo mandava `Bearer `, que a requisição
  apara e não exercitava o caso).

- Suíte completa (612 arquivos, 8883 testes), typecheck e build de produção: ok.

**Testes antigos atualizados de propósito** (cada um só passa a listar o item novo da PC-2):

- `push-regras` (2 testes, 3 listas) e `push-pg` (1): o tipo novo de push `PEDIDO_CLIENTE` na lista de quem vê OS.
- `sino-lidos` (2) e `pendencias-regras` (1): o aviso/linha `pedidosConferir`.
- `proposta-corporativa-ui` (1): a tela de Orçamentos e propostas também manda os lembretes e a régua.
- `sql-pedido-cliente` (PC-1): depois do SQL da PC-1, aplica também o da PC-2 (a sequência de produção), porque o
  Prisma de hoje já tem as colunas novas nas mesmas tabelas.

## Prints (fictícios)

`docs/prints/pedido-cliente-portal/`, em desktop e iPhone 13:

- `antes-01…03`: OS aguardando, Configurações e o portal sem nada;
- `depois-09…24`:
  - **portal:** início com o card; aguardando; anexando o pedido; em conferência; recusado com o motivo; confirmado;
  - **escritório:** sino; etiqueta "conferir"; a conferência; recusar com motivo; OS confirmada; "Último lembrete em …";
    trilha com os lembretes;
  - **configuração:** a régua em Configurações; o desligar na ficha do cliente;
  - **e-mail:** o e-mail do lembrete.

## Leva I.2 — itens 8 a 10

**8. Resolvido por outro meio.** O pedido do portal em conferência cujos serviços **todos** deixaram de aguardar o
pedido (outro pedido informado, liberado sem pedido, OS cancelada, orçamento recusado, faturado, cliente que deixou de
exigir) encerra **sozinho** na situação própria `RESOLVIDO` ("Resolvido por outro meio"). O portal mostra a situação
na lista de enviados, com a dica "Nenhuma ação é necessária"; a trilha das OS registra o encerramento.
- **Um ponto só:** a leitura dos pedidos em conferência (`emConferencia` em `portal-server.ts`), que o sino, o filtro, o
  portal (lista e enviados) e o lembrete já usam. Assim nenhum caminho que resolve um item precisa lembrar de encerrar
  (são muitos: registrar, liberar, cancelar, recusar orçamento, faturar, mudar a ficha). A troca é condicional
  (`situacao: "CONFERIR"`): leituras simultâneas, ou a conferência do escritório no meio, encerram uma vez só.
- O escritório não confirma nem recusa o encerrado (409 com o motivo); a gaveta explica.

**9. Lembrete para o cliente sem portal.** Quando o e-mail de compras **não** é o login de um contato ativo com senha
num cliente com portal ligado (`compradorTemPortal`), o lembrete usa o template novo
`PEDIDO_CLIENTE_LEMBRETE_SEM_PORTAL` (editável em Configurações › E-mails): a mesma lista e, ao lado de cada OS, o
**link público do relatório** (`/relatorio/os/<token>`; o orçamento, pelo link dele). **Anexo não**: o relatório da OS
é uma página que o cliente imprime/salva em PDF; não há PDF da OS gerado no servidor. O texto pede que o cliente
**responda o e-mail** com o pedido; a resposta vai para o e-mail da empresa quando a configuração de e-mail não tem um
"responder para". Sem botão nem link do portal. A régua, a chave única e a trilha são as mesmas.

**10. E-mail da recusa.** Ao recusar o pedido do portal, o cliente recebe o template novo `PEDIDO_CLIENTE_RECUSADO`
("Pedido de compra recusado", editável; variável nova `motivo_recusa`, escapada) com o motivo, os serviços do pedido e
o botão do portal. Vai ao contato que enviou **e** ao e-mail de compras (sem repetir). A recusa nunca depende do
e-mail: sem e-mail configurado, sem destinatário ou com falha no envio, a recusa vale, a falha vai para o log e para a
trilha da OS ("Recusa do pedido de compra não enviada por e-mail"), e a tela avisa.

Testes: `leva-i2c` (regras e templates), `leva-i2c-ui` (portal e gaveta), `leva-i2c-pg` (encerramento, lembrete sem
portal, recusa com e sem e-mail). Ajustados: `pedido-cliente-portal` (o rótulo novo na lista de situações) e
`pedido-cliente-portal-pg` (os clientes da rotina ganharam o contato com portal, para seguir recebendo o lembrete com
link; a trilha da recusa ganha a linha do e-mail).
