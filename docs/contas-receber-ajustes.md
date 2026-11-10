# Financeiro › Contas a receber — ajustes (Nova receita, Perdas, filtros e totais)

Quatro ajustes na tela **Recebimentos › Contas a receber**, no padrão Conta Azul. **🟢 Sem mudança de
banco** — o status `PERDA`, as colunas `valorPerda`/`perdaEm`/`motivoPerda` e as APIs de marcar/reverter
perda já existiam.

## 1. "Nova receita" + vocabulário

- O botão **Nova cobrança → Nova receita** (mesmo destino: cadastro de uma conta a receber).
- O **item** da tela agora é "receita": "Nenhuma **receita** encontrada", "N **receitas**" nos cards, no
  painel de totais, na paginação e na barra de seleção; "Pesquisar receitas".
- **Mantido de propósito** o sentido de "cobrança" como **ato de cobrar**: "Enviar **cobrança** por
  WhatsApp/e-mail", boleto, régua de notificação. Nada renomeado em massa nem em outras telas.

## 2. Perdas — simplificado

- **Removidos**: o botão "Perdas" do topo, o item "Perdas" da barra lateral (Recebimentos › Perdas) e a
  **página/relatório dedicado** (`/financeiro/perdas` + `perdas-view`).
- **Marcar / desmarcar perda** virou ação **dentro de "Editar" a conta**: uma seção no fim da edição com
  "Marcar como perda" (**motivo opcional**) ou, se já está em perda, "Desmarcar perda".
- **Ver perdas** = o **filtro de status "Perda"** que já existe na tela (Mais filtros › Status). O
  **total de Perdas** segue no painel de totais do rodapé.
- Comportamento preservado: marcar tira o saldo do a receber e registra como perda (não apaga); o já
  recebido continua recebido; a NF não é cancelada; **reversível** (desmarcar volta para em aberto, ou
  "o cliente pagou" registra a recuperação). Exige **Financeiro › Perdas**.

## 3. Faixa de filtros compacta

`BarraFiltros` ganhou a variante **`compacto`** (aplicada só aqui): **sem o card branco gordo** — uma
linha enxuta com Vencimento (‹ ›), Pesquisar e "Mais filtros", e **"Limpar filtros" discreto** ao lado.
As outras telas (Pagar, Notas, Orçamentos) seguem iguais.

## 4. Resumo "Totais do período" recolhível

`PainelTotais` já tinha o chevron; agora, em Contas a receber, abre **recolhido por padrão** e **lembra o
último estado** (localStorage, `lembrarComo="totais-receber"`). A quebra (A vencer, Vence hoje, Vencido,
Recebidos, Perdas) aparece ao expandir; com linhas selecionadas, mostra a soma do que está marcado.

## Testes

- `contas-receber-gestao-ui`: 5 cards sem Perdas no topo nem botão; "N receitas"; "Nenhuma receita";
  painel recolhido por padrão (abre pelo chevron); o ⋮ não tem mais "perda".
- `perda-estorno-ui`: "Marcar/Desmarcar perda" vive dentro de Editar (saiu do ⋮); **motivo opcional**
  (envia mesmo vazio); reverter pelo Editar; estorno segue no ⋮.
- `perda-estorno-pg`: marcar sem motivo funciona (200); motivo acima de 500 é recusado; o fluxo de
  perda/estorno/reverter intacto.
- `ux8-ui`: "Nova receita" segue a permissão de criar.
- `tsc`, ratchet e glossário verdes; build exit 0.

## Prints

`docs/prints/contas-receber-ajustes/` (desktop + celular): a tela com a faixa compacta, "Nova receita" e
os totais recolhidos; os totais expandidos; o filtro de status "Perda"; e "Marcar como perda" dentro de
Editar.
