# App pronto pra janeiro 2 — PR B: as decisões D2 a D14

As decisões da varredura (`docs/app-pronto-pra-janeiro.md`, seção "Decisões de produto"), tomadas pelo Zé e pelo
dono. D1 (pausar / impedimento) foi para o PR A. D10 (checklist por tipo de OS) e D15 (voltar do Android) ficam para
PRs próprios. D3 e D12 seguem como estão (decisão: manter).

**Não mexi na conversa da OS nem na barra inferior** (a outra nuvem está corrigindo o rodapé do chat no iPhone).

Prints antes e depois, com dados fictícios e banco local: `docs/prints/janeiro2b/` (iPhone 390 px, Android 360 px e o
escritório no desktop).

## O que mudou, item a item

| # | Decisão | Como ficou |
|---|---|---|
| D2 | A sessão do **app do técnico** vale 30 dias | Quem entra no modo técnico fica conectado 30 dias, com ou sem "Manter conectado". O escritório segue como antes: sem a caixa, 1 dia. Continua caindo **na hora**: entrou em outro celular ("um aparelho só"), senha redefinida, usuário inativado (testado com o token de 30 dias). |
| D4 | Legenda opcional nas fotos **antes/depois** | "+ Legenda" embaixo de cada foto antes/depois do equipamento, igual às fotos do serviço. Vale sem sinal (vai pela fila). Vazia, volta à do sistema ("Antes do serviço"). Fica no histórico da OS. Com a OS encerrada, não aparece. |
| D5 | Material **sem saldo**: lança com aviso | Ao escolher o material: "Saldo disponível: X". Passou do saldo: **"Saldo disponível: X. Vai ficar negativo; o escritório será avisado."**, e o Lançar continua valendo. O push "Estoque negativo" ao escritório já existia: está conferido no teste, com a OS. |
| D6 | "Assinar em tela cheia" | No aceite do app, o botão abre o quadro do tamanho da tela. Trava em **paisagem só nessa tela** onde o aparelho deixa (Android). No iPhone, que não trava, pede "Gire o celular para assinar deitado". A assinatura volta para o quadro do aceite **em escala, sem distorcer**, e sai na mesma imagem de sempre. "Voltar" e Esc fecham só a tela cheia. |
| D7 | Despesa: corrigir ou excluir antes da decisão | Em "Minhas despesas", a que aguarda aprovação tem **Corrigir** e **Excluir** (também sem sinal). O escritório vê, na despesa, **o que mudou**. As excluídas ficam na aba **"Excluídas pelo colaborador"**, com o que eram. Depois que o escritório decide, não muda mais. |
| D8 | Cartão "Instale o app e ative as notificações" | Um cartão só no Meu dia, nos **7 primeiros dias** neste aparelho, com o passo que falta. No iPhone: "Compartilhar › Adicionar à Tela de Início". Nos outros aparelhos: Instalar, depois "Ativar notificações". Some quando está feito ou com "Agora não". |
| D9 | "Saiu do seu dia" | A OS que estava no dia e o escritório **cancelou, reagendou ou passou a outro técnico** vira a faixa "Saiu do seu dia: OS-2603 (reagendada pelo escritório para 12/01)". Fica até o técnico tocar "Entendi", também sem sinal. |
| D11 | Aviso no aparelho novo | O aparelho novo avisa: "O outro aparelho tem 3 gravações que ainda não subiram (última notícia dele: hoje às 10:42). Para não perder: abra o app nele com sinal…". Com "um aparelho só", diz também que este aparelho sai. |
| D13 | Corrigir o checklist do veículo até o fim do dia | No Perfil: "Corrigir o checklist do veículo de hoje". Reabre com as respostas. As fotos já enviadas continuam; tire outra só para trocar. O alerta e o status são decididos de novo. O gestor vê **o que mudou** no detalhe do checklist (Veículos › Checklist). Só no mesmo dia. |
| D14 | "1 começado · 0 completos" | O topo da OS conta os equipamentos **começados** (com resposta, foto ou marcado) e os **completos**, separados. |

## Decisões de implementação (para o Zé conferir)

- **D5, não existe estoque por veículo.** O campo `local_id` do estoque é gravado (o veículo do uso), mas não há
  entrada por veículo: um saldo só do veículo daria sempre negativo.
  - **Como ficou:** o número mostrado é o saldo da empresa, mais o que foi **separado para esta OS** (a separação é
    consumida primeiro), menos o que o aparelho lançou e ainda não enviou.
  - **Por isso o texto é "Saldo disponível"**, não "Saldo do veículo".
  - **Vantagem:** o aviso aparece exatamente quando o escritório recebe o push.
  - **Quando houver estoque por veículo,** só a conta muda; o texto fica numa função só.
- **D7, a trilha.** A trilha é uma tabela nova (SQL 🔵). A exclusão apaga a despesa (somem a lista, o sino e a OS),
  mas a linha da trilha fica. Duas outras garantias:
  - um reenvio atrasado do lançamento **não traz a despesa excluída de volta**;
  - corrigir e aprovar ao mesmo tempo: vale uma das duas, inteira. Isso foi testado com as duas chamadas simultâneas.
    A conta de reembolso usa o valor gravado **na hora da aprovação**.
- **D13, a trilha.** É uma tabela nova (SQL 🔵). A correção é um pedido explícito do app (`correcao: true`): um 2º
  checklist comum do mesmo dia continua não passando por cima.
  - **"Até o fim do dia"** vale pelo **toque**: a correção feita sem sinal às 23h50 e enviada de manhã vale.
  - **Duas proteções contra reenvio:** a mesma correção enviada de novo não é aplicada outra vez, e um reenvio atrasado
    do checklist original não desfaz a correção.
- **D11, o limite honesto.** O aviso usa a **última notícia** que o aparelho antigo deu ao servidor. Ele conta a fila a
  cada Meu dia e a cada envio. O que o aparelho antigo gravou **sem sinal e nunca chegou a contar**, o servidor não tem
  como saber.
  - **Onde fica guardado:** nas preferências do usuário, sem tabela nova.
  - **O que vai:** o id aleatório do aparelho e o número de gravações. Nada do conteúdo.
- **D9, sem aviso falso.** A última mudança do dia na OS feita pelo **próprio técnico** (ex.: "não concluída", do PR A)
  não vira aviso. O servidor só devolve o número da OS e o motivo, nada do cliente.
  - **Por que os ids vão no cabeçalho:** a URL do Meu dia não muda.
- **D6, onde vale.** A tela cheia é só no app (`telaCheia`). O aceite do escritório segue com o quadro de sempre.

## SQL (🔵, aditivo e idempotente)

`prisma/sql/2027-02-22_janeiro2_trilhas.sql` cria duas tabelas:
- `despesas_campo_historico` (D7);
- `checklist_correcoes` (D13), com a chave para `checklist_preenchidos`.

Testado 3× e idêntico ao Prisma. Nada existente é alterado.

```
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2027-02-22_janeiro2_trilhas.sql
```

## Testes

| Arquivo | O que prova |
|---|---|
| `janeiro2b-regras` | As regras puras: D4, D5, D7, D8, D9, D11, D13 e D14. |
| `janeiro2b-ui` | D5 e D4 nas telas: o saldo, o aviso, lançar assim mesmo, a correção que olha só o aumento; "+ Legenda". |
| `janeiro2b-assinatura-ui` | D6: tela cheia e paisagem, a volta em escala, Voltar/Esc, o iPhone, o escritório sem o botão. |
| `janeiro2b-avisos-ui` | D8, D9 e D11 nas telas; o motor manda o id do aparelho, a fila e os ids de hoje. |
| `janeiro2b-sessao-pg` | D2 com PostgreSQL real: 30 dias, e cai na hora (outro aparelho, senha, inativo). |
| `janeiro2b-meu-dia-pg` | D9 e D11 nas rotas de verdade. |
| `app-campo-leva2-despesas-pg` / `-ui` (+) | D7: corrigir, excluir, a trilha, a corrida com a aprovação, a fila sem sinal. |
| `checklist-diario-pg` / `-app` (+) | D13: corrigir, as fotos, a trilha, o prazo, os reenvios, outro aparelho. |
| `app-campo-leva1-pg` (+) | D5: o saldo no catálogo, o separado no retrato, o push ao escritório. |
| `os-legenda-foto-pg` (+) | D4: a legenda pela fila, a trilha e a volta à do sistema. |
| `sql-janeiro2-trilhas` | O SQL. |

## Prints

`docs/prints/janeiro2b/antes/` (master) e `docs/prints/janeiro2b/depois/` (este PR): as mesmas cenas em iPhone e
Android, e o escritório no desktop.

A auditoria automática de cada tela (alvos de toque, texto cortado, rolagem lateral) **não achou nada novo**.
- **O que melhorou:** o "Limpar" da assinatura tinha 24 px de altura e agora tem 44 px.
- **O que ficou como estava (fora desta leva):**
  - o campo de data do formulário de despesa (38 px), o mesmo do "Lançar despesa";
  - o "×" da orientação do iPhone em Notificações (20 px).
