# Detalhe da venda (consolidação, estilo "Detalhes da receita" do Conta Azul)

Consolidação da visão da venda, alcançada a partir de uma conta a receber (gaveta), de uma fatura, ou de um orçamento/OS faturado. **Reaproveita** as peças existentes — não reconstrói nem muda cálculo, baixa, retenção ou dado. 🟢 sem banco.

## Avaliação: o que já existia × o que faltou

A venda já tinha duas superfícies de detalhe ricas:

- **Gaveta "Ver detalhes" da conta** (`conta-receber-detalhes.tsx`): cabeçalho (cliente, número, valor, status), origem com links, itens, retenções, boleto, NFS-e, parcelas (com as irmãs), recebimentos/baixas, renegociação, perda, cancelamento e a **linha do tempo**.
- **Página da fatura/medição** (`/financeiro/medicoes/[id]`, = `/financeiro/faturas/[id]`): cabeçalho + voltar, ações (`MedicaoAcoes`), **NFS-e com baixar PDF/XML** (`NotasFiscais`), retenções (`ResumoRetencoes`), o documento com itens/cliente/totais (`MedicaoDocumento`) e as contas a receber vinculadas.

| Ponto do pedido | Já existia? | Onde |
|---|---|---|
| 1. Cabeçalho (cliente, nº, valor, status) | Sim | gaveta + `MedicaoDocumento` |
| 2. Origem (volta ao orçamento/OS) | Parcial (só o "voltar") | **+ link "Origem" visível na fatura** |
| 3. Itens | Sim | gaveta + `MedicaoDocumento` |
| 4. Fiscal: NFS-e baixar PDF/XML + retenções | Sim | `NotasFiscais` + `ResumoRetencoes` |
| 5. Parcelas / lançamentos + baixas + navegação | Sim | gaveta (parcelas, recebimentos) + `ContasReceberVinculadas` |
| 6. **Faturas parciais (P5): as partes, cada uma com valor/%, nota e status** | **Não** (só no orçamento/OS) | **+ "Faturas desta venda" na fatura e na gaveta** |
| 7. Ações no lugar certo (conforme permissão) | Sim | `MedicaoAcoes` + menu ⋮ da conta |
| 8. Histórico / linha do tempo | Sim (gaveta) | eventos da conta |

**O que faltou e esta leva adiciona:** o ponto 6 — a consolidação das **faturas parciais (P5)** nas telas de detalhe — e o link de **Origem** visível na página da fatura (ponto 2). O resto já estava pronto e foi mantido.

## O que muda

- **Componente compartilhado** `components/faturamento/faturas-da-venda.tsx` (`FaturasDaVenda`, `ResumoFaturamento`, `HistoricoFaturas`): leitura pura do faturamento da origem (pílula de status + "Faturado X de T · a faturar S" + o histórico das faturas, cada uma com número, parte %, status, NF e valor, com link; a fatura que está sendo vista fica destacada como "Esta venda", sem link para si mesma). A régua (`statusFaturamento`, `saldo`, `rotuloParcial`) é a do lib (P5), sem lógica nova. O "Faturar" (`botao-faturar`) foi refatorado para reusar `ResumoFaturamento`/`HistoricoFaturas` — um só lugar renderiza a lista.
- **Página da fatura/medição**: quando a venda foi faturada em partes, mostra "Faturas desta venda" (as irmãs, destacando esta), reusando `faturamentoDoOrcamento`/`faturamentoDaOs`; e o link "Origem: Orçamento/OS". Fatura cheia única não mostra a seção.
- **Gaveta da conta**: `detalhesDaConta` passa a devolver `faturamento` (as faturas da origem) quando houve partes; a gaveta mostra "Faturas desta venda" destacando a fatura desta conta. Multiempresa: computado com a empresa da conta, nunca cruza.

## Fora (de propósito)

Mudar o modelo de dados; faturar por item; edição fiscal por venda (PR própria).

## Testes

`faturamento-parcial-pg` (a página da fatura monta "Faturas desta venda" com as irmãs, destaca a atual e leva à origem; fatura cheia não mostra; a gaveta via `detalhesDaConta` traz as partes com a desta conta; multiempresa não cruza e usa a empresa certa), `faturamento-parcial-ui` (`FaturasDaVenda`: resumo, destaque da atual sem link próprio, permissão `podeVer`), e os testes P5/avulso seguem verdes após a refatoração do `botao-faturar`.
