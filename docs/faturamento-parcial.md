# Faturamento parcial (P5)

Em cima do faturamento avulso (Opção A: a conta a receber nasce no "Faturar"), o orçamento aprovado e a OS concluída sem contrato podem ser faturados **em partes**: fatura uma parte agora (por valor ou por percentual do total), gera a nota (NFS-e) e a conta a receber **daquela parte**, e o restante fica "a faturar". Repete até zerar.

É diferente de **parcelar**: parcelar divide a cobrança de uma fatura em N boletos; faturar parcial divide a **origem** em N faturas, cada uma com número, nota e conta próprios. Uma fatura parcial pode, ela mesma, ser parcelada.

Vocabulário (glossário): Faturar / Fatura = cobrança de OS ou orçamento avulso; Medição = cobrança periódica de contrato. Nada aqui muda a medição de contrato.

## Regras

1. **Saldo manda.** `total` = o valor da fatura cheia hoje (orçamento: total geral; OS: itens executados + adicionais "Cobrar"). `faturado` = soma do líquido das faturas avulsas **vivas** ligadas à origem. `saldo = total − faturado`. Nenhuma parte pode passar do saldo (1 centavo de folga arredonda ao saldo, para o último "resto" por percentual fechar a conta). Percentual é **do total** da origem (40% do orçamento), não do saldo.
2. **Cada parte é uma fatura própria**: medição `ADICIONAL` avulsa já liberada (como o "Faturar" cheio), com `faturaParcial = true` e `percentualFaturado`. As linhas da fatura cheia entram **proporcionais** (mantêm serviço/produto/origem: é por eles que a NFS-e e as retenções saem), quantidade 1, a última linha absorve o arredondamento; desconto proporcional; líquido = exatamente a parte. Descrição "Parcial 40% — Orçamento ORC-… — nome"; linhas "… — parcial 40%"; a NFS-e referencia "Fatura nº 2026-0012 (parcial 40%)". Retenções herdadas dos serviços saem sobre a parte (proporcionais). Conta a receber pelo líquido da parte.
3. **Status da origem** (`statusFaturamento`): A faturar → **Parcialmente faturado** → Faturado (saldo zero). "Faturar" (sem parte informada) depois de uma parte fatura **o saldo** e também é marcado parcial (fecha a origem). Fechada, "Faturar" devolve a última fatura (`jaExistia`) e "Faturar parcial" é recusado: nunca cobra duas vezes.
4. **Fatura cheia cobre a origem inteira.** Um "Faturar" sem parte anterior é a fatura cheia (`faturaParcial = false`) e zera o saldo, seja qual for o valor: a OS gerada do orçamento que faturou só os itens executados continua cobrindo o orçamento (como sempre foi). O mesmo vale para uma medição de contrato/manual viva que cubra a origem.
5. **Cancelar uma parte devolve o valor ao saldo** (o saldo é recalculado a partir das faturas vivas; nada a gravar). A previsão do orçamento que a parte tinha absorvido volta valendo o **saldo** (não o total): nunca por cima das outras partes vivas.
6. **Previsão ("A faturar", painel):** o orçamento aprovado entra com o saldo não faturado; some quando fecha. A conta de uma fatura parcial não tira o orçamento da previsão (só a conta Prevista antiga, sem medição, tira).
7. **Travas:** as origens são trancadas (`FOR UPDATE`, ordem fixa) e o saldo é lido na mesma transação; 5 pedidos simultâneos de 30% em 1.000 → 3 faturas e 2 recusas (409). Corpo inválido (percentual > 100, valor ≤ 0, parcelas fora da faixa) → 400, nunca vira um "Faturar" cheio por engano.
8. **RBAC / multiempresa:** Financeiro › Medições para faturar; empresa sempre da sessão; orçamento de outra empresa → 404.

## Onde está

| Camada | Arquivo |
|---|---|
| Regras puras (`validarParcial`, `faturaParcial`, `statusFaturamento`, `saldoAFaturar`, `rotuloParcial`, `referenciaNota`) | `lib/faturamento/fatura.ts` |
| Saldo da origem (`faturamentoDaOrigem`) e trava (`travarOrigens`) | `lib/faturamento-os.ts` |
| Motor (`criarFatura`: parte ou saldo; `faturamentoDoOrcamento`, `faturamentoDaOs` para as telas) | `lib/faturamento/faturar-server.ts` |
| Corpo `{ parcial: { valor \| percentual }, parcelamento? }` e resposta (`parcial`, rótulo) | `lib/faturamento/resposta.ts`; rotas `app/api/orcamentos/[id]/faturar`, `app/api/ordens/[id]/faturar` |
| Previsão pelo saldo | `lib/financeiro/a-faturar.ts` |
| Cancelamento: previsão volta pelo saldo | `lib/financeiro-server.ts` (`desfazerContasDaMedicao`) |
| Tela: status, "Faturado X de T · a faturar S", histórico das faturas, "Faturar" e "Faturar parcial" (modal) | `components/faturamento/botao-faturar.tsx` (`faturamento` prop); orçamento `app/(dashboard)/orcamentos/[id]/page.tsx`; OS `components/os/os-detalhe.tsx` e `os-financeiro.tsx` |
| Banco (aditivo, idempotente) | `prisma/sql/2026-11-08_faturamento_parcial.sql`: `medicoes.fatura_parcial` (bool, false) e `medicoes.percentual_faturado` (decimal 6,2, nulo) |

## Fora (de propósito)

Faturar por item (v2); edição fiscal por venda; retenções federais na NFS-e; o estágio automático da OS continua "Faturada" com a primeira fatura viva (o "Parcialmente faturado" aparece no bloco de faturamento da OS e do orçamento).

## Testes

`tests/unit/faturamento-parcial.test.ts` (regras puras e leitura do corpo), `faturamento-parcial-pg.test.ts` (rotas reais em PostgreSQL: por valor e por %, saldo e concorrência, retenções proporcionais, status, cancelamento devolve o saldo, parcelas, cheio intacto, OS, multiempresa), `faturamento-parcial-ui.test.ts` (bloco e modal no DOM), `sql-faturamento-parcial.test.ts` (SQL idempotente).
