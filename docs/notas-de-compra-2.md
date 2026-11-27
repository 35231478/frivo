# Notas de compra 2 (`/estoque/notas`)

Quatro melhorias na lista de notas de compra. Uma delas, reordenar colunas, vale para todas as tabelas do sistema.

## 1. Filtro de data

O mesmo seletor de período das outras listas (Hoje, Esta semana, Este mês, Este ano, Últimos 30 dias, Últimos 12 meses, Todo o período e Período personalizado), com as setas ‹ ›.
- **Mês anterior:** a seta ‹ a partir de "Este mês".
- **Qual data:** a emissão da nota, por padrão. Em "Mais filtros › Data do período" dá para trocar para a **entrada**, o lançamento no estoque; o rótulo do seletor passa de "Emissão" para "Entrada". A nota ainda não lançada não tem entrada.
- **Padrão:** "Todo o período", como na lista de OS, para nenhuma nota esperando conciliação sumir da tela.
- **Na URL:** `periodo`, `mes`, `de`/`ate` e `data=entrada`, compartilháveis como nas outras listas.

Regra: `lib/listas/filtros.ts` (`whereNotasCompra`, `campoDataNota`, `periodoNotas`). Os dias são os de Brasília.

## 2. Mais colunas

O padrão continua o de antes: NF, Fornecedor, Emissão, Valor, Itens e Situação. As outras o usuário liga em "Colunas":

| Coluna | De onde vem |
| --- | --- |
| Série | a nota |
| Chave de acesso | a nota, com o botão "Copiar" |
| CNPJ do fornecedor | o emitente da nota |
| Entrada | o lançamento no estoque (`lancadaEm`) |
| Produtos, Frete, Desconto, ICMS, ICMS-ST, IPI | o XML importado (totais da NF-e) |
| Pedido de compra | o pedido vinculado, com link |
| Lançada por | quem fez a entrada no estoque; a nota guarda quem importou |

Os valores dos impostos não ficam em coluna do banco: são lidos do XML da página que está na tela, até 50 notas por vez. Por isso esta leva não tem SQL. Nota sem XML mostra "—" nesses valores.

## 3. Reordenar colunas: em todas as tabelas

O menu "Colunas" do componente compartilhado (`components/listagem/tabela-pro.tsx`) ganhou uma **alça** em cada coluna. Toda tabela que usa o componente ganha a reordenação.

| Como | O que faz |
| --- | --- |
| Arrastar a alça (mouse ou dedo) | a tabela mostra a ordem nova enquanto arrasta; grava ao soltar |
| Teclado, com a alça em foco | ↑ e ↓ movem uma posição; Home e End levam ao começo e ao fim. O foco fica na alça e o leitor de tela ouve "Coluna: posição N de M" |
| Restaurar padrão | volta larguras, colunas e ordem da tela |

- **Colunas fixas:** o checkbox de seleção e as ações não se movem nem entram no menu.
- **Onde fica salvo:** a ordem é do usuário, na mesma preferência das larguras e colunas (`/api/preferencias/tabela:<tela>`, com o navegador de reserva).
- **Coluna nova numa tela:** entra junto da vizinha em que a tela a declarou.
- **Regras puras:** `lib/preferencias.ts` (`ordenarColunas`, `moverColuna`).

## 4. Visualização rápida

Clicar na linha, ou no ícone de olho, abre uma **gaveta lateral** sem sair da tela.
- **Outra aba:** Ctrl/⌘ + clique ainda abre a nota em outra aba.
- **Tela completa:** o número da NF continua levando à tela da nota (conciliar, lançar).
- **Celular:** o olho fica no cartão.

**Com o XML importado, a gaveta mostra a DANFE simplificada:**
- emitente (nome, endereço, CNPJ e IE), número, série e emissão;
- a chave de acesso em blocos, com "Copiar chave", o protocolo e a natureza da operação;
- o destinatário;
- os itens: código, NCM, CFOP, CST, quantidade, unitário, total, ICMS e IPI;
- impostos e totais: bases, ICMS, ICMS-ST, produtos, frete, seguro, desconto, outras despesas, IPI, tributos e o total da nota;
- transporte, duplicatas e informações complementares.

Os botões são **Baixar PDF** (a mesma DANFE em PDF), **Baixar XML** (o arquivo como foi importado) e **Abrir a nota**.

**Sem XML:** um aviso, os dados que a nota tem no sistema (número, série, emissão, fornecedor, CNPJ, total, chave e itens) e só "Abrir a nota". Baixar PDF e Baixar XML ficam escondidos.

A DANFE simplificada é um espelho para consulta, não a DANFE oficial do emitente (layout da SEFAZ, com código de barras). A gaveta e o PDF dizem isso.

| Peça | Onde |
| --- | --- |
| Leitura do XML (tolerante: campo faltando vira vazio; recusa o que não é NF-e, o vazio, o grande demais e DOCTYPE/ENTITY) | `lib/compras/danfe.ts` |
| Texto (endereço numa linha, nome dos arquivos) | `lib/compras/danfe-texto.ts` |
| PDF (pdf-lib, a maquinaria de desenho da casa) | `lib/compras/danfe-pdf.ts` |
| Rotas: dados, PDF, XML (Estoque › Visualizar; empresa da sessão; sem XML, 404) | `/api/compras/notas/:id/visualizar`, `/danfe`, `/xml` |
| Gaveta | `components/compras/gaveta-nota.tsx` |
| Lista | `components/compras/notas-lista.tsx` |

## Testes

| Arquivo | O que prova |
| --- | --- |
| `notas-compra-2-regras` | ordem das colunas (fixas paradas, coluna nova, mover, preferência), leitura da DANFE (campos, tolerância, recusas), período por emissão/entrada, PDF |
| `notas-compra-2-pg` | lista com valores do XML, pedido e quem lançou; período com o dia de Brasília; visualizar, PDF e XML pelas rotas (permissão, outra empresa, sem XML); a preferência guarda a ordem |
| `notas-compra-2-ui` | reordenar com teclado e arrastando (mouse e toque), ordem do servidor ao abrir, Restaurar padrão, `aoAbrir`; a gaveta com e sem XML, erro, colunas novas e o rótulo do período |
