# Orçamento E2 — regra de materiais por empresa

Ajuste do Zé sobre o Orçamento E. "Material vai embutido no serviço" é o jeito da Termofrio, não de toda empresa. O
Frivo é SaaS e cada empresa cobra do seu jeito, então a regra não pode ficar fixa no código. Cada empresa escolhe
**como os materiais entram na cobrança**:

| Regra | Material | Peça |
|---|---|---|
| **Incluso no serviço** (padrão; a Termofrio fica assim) | Fica dentro do serviço, sem valor para o cliente. Quantidade acima do padrão ajusta o serviço. É o comportamento do Orçamento E. | Linha própria, com valor |
| **Cobrado à parte** | Linha própria, com o preço de venda, somando no total (como a peça). O serviço fica no valor base. | Linha própria, com valor |

Termos fixos em todo o sistema: **Material** e **Peça**. A regra decide só a **cobrança**. No estoque, na
separação e no custo (lucro e margem), o Material continua sendo Material.

> 🔵 **Banco — aplicado pelo Zé** (no merge do [#273](https://github.com/35231478/frivo/pull/273)). O SQL está em
> `prisma/sql/2027-02-07_cobranca_materiais.sql`. Ele é aditivo e idempotente. Ver "O SQL" abaixo.

## Levantamento — onde a cobrança do material era decidida

| Ponto | Como era (Orçamento E) |
|---|---|
| Regra pura (`lib/orcamentos/materiais.ts`) | Material ajusta o serviço pela diferença do padrão; só a Peça (`VENDA_A_PARTE`) virava linha de produto derivada. Fixo no código. |
| Gravar o orçamento (`app/api/orcamentos`, `[id]`, `editar-linha-server`) | Usava a regra pura acima para os valores e as linhas derivadas. |
| OS (`lib/os/materiais*.ts`, rotas de itens da OS) | A mesma regra, para os itens com materiais da OS sem orçamento. |
| Gerar OS / faturar | Copiam os valores e as linhas **gravados**; não recalculam. |
| Documento do cliente (tela, link, PDF) | A lista "Materiais inclusos" dentro do serviço, sem valor (opção "Mostrar materiais ao cliente"). |
| Configurações › Orçamento | Só o padrão de "Mostrar materiais ao cliente". `orcamento_mostrar_valores_materiais` está no banco sem uso desde o Orçamento E e **não foi reaproveitada**. |

## O que mudou

1. **Configurações › Orçamento, bloco "Materiais"**
   - **"Como os materiais entram na cobrança"**: dois cartões, **Incluso no serviço** e **Cobrado à parte**. Cada um tem uma frase curta; a explicação fica no ⓘ do bloco, sem parágrafo na tela.
   - **"Mostrar a lista de materiais ao cliente"** aparece só no Incluso. No à parte os materiais já vão ao cliente em linha própria, com valor, então a lista não se aplica.
   - Sem Configurações › gerenciar, tudo fica só leitura.
2. **Orçamento**
   - O orçamento **nasce com a regra da empresa** e a guarda (`orcamentos.cobranca_materiais`).
   - Mudar a configuração depois **não altera** orçamento antigo nem aprovado, nem quando ele é editado. O PUT não aceita trocar a regra do orçamento.
   - No construtor, com "Cobrado à parte":
     - o serviço fica no valor base;
     - cada material com quantidade vira linha de produto com o preço de venda e a pílula **"Material · serviço"**;
     - a Peça continua com a pílula "Peça · serviço";
     - o painel "Materiais e peças" marca o que vai à parte e resume "N itens vão como linha de produto".
3. **Troca Material ⇄ Peça por item** continua valendo nos dois modos, como exceção pontual. No à parte a cobrança é a mesma (os dois vão à parte); muda o rótulo da linha e o custo por Uso.
4. **Documento do cliente** (tela, link público, impressão/PDF), com "Cobrado à parte":
   - os materiais aparecem em **Produtos** com valor e somam no total;
   - a lista "dentro do serviço" some, para não repetir;
   - a opção "Mostrar materiais ao cliente" do orçamento fica escondida.
   No Incluso, fica como no Orçamento E.
5. **OS**
   - **Gerar OS** copia a regra do orçamento.
   - **OS sem orçamento**: a regra da empresa é fixada na OS (`ordens_servico.cobranca_materiais`) no 1º item com materiais e não muda mais com a configuração. Enquanto não há item com materiais, fica nula e segue a empresa.
   - O comercial da OS mostra os valores pela regra da OS.
6. **Faturamento**: lê as linhas gravadas. No à parte, o material vai como linha de **PRODUTO**, sem custo e sem baixa de estoque, igual à Peça.
7. **Implantação**: a etapa de configuração ganhou o item **"Como você cobra materiais?"**. Ele mostra a escolha atual e leva a Configurações › Orçamento. Há sempre uma escolha (o padrão é Incluso), então o item não trava a etapa.

## Decisões do Zé (respostas às perguntas do #273)

1. **Nota fiscal do material à parte**: nada fiscal agora. Quando vier a NF-e de produto (modelo 55, que está no
   backlog), o material cobrado à parte segue a Peça.
2. **Exceção "este material vai incluso" numa empresa à parte**: não entra agora. Só se um cliente pedir.
3. **OS sem orçamento** (regra fixada no 1º item com materiais; OS que já tinham materiais = Incluso): sem resposta
   registrada; segue como está.

## O SQL (🔵 aplicado)

`prisma/sql/2027-02-07_cobranca_materiais.sql` é aditivo e idempotente: pode rodar mais de uma vez sem mudar nada.

- Tipo `"CobrancaMateriais"` (`INCLUSO`, `A_PARTE`), criado num bloco `DO` que ignora se já existe.
- `configuracoes.orcamento_cobranca_materiais`: NOT NULL, padrão `INCLUSO`. Toda empresa existente fica INCLUSO, inclusive a Termofrio.
- `orcamentos.cobranca_materiais`: NOT NULL, padrão `INCLUSO`. Todo orçamento existente fica INCLUSO, que é como os valores dele foram calculados.
- `ordens_servico.cobranca_materiais`: nula até ser fixada. As OS que **já têm materiais** recebem `INCLUSO` (único `UPDATE`, só onde ainda está nula).
- Nada é apagado. `orcamento_mostrar_valores_materiais` não é tocada.

Testado em PostgreSQL real (`tests/unit/sql-cobranca-materiais.test.ts`):

- rodado duas vezes sobre uma "produção" sem as colunas;
- confere padrões, OS com e sem materiais, e que uma regra fixada depois não é desfeita;
- confere que valores inválidos e nulo são recusados;
- confere que o `prisma migrate diff` fica vazio;
- confere que o arquivo não tem DROP/DELETE/TRUNCATE.

## Testes

| Arquivo | O que trava |
|---|---|
| `tests/unit/orcamento-e2.test.ts` | Regra pura nos dois modos: rótulos fixos, padrão INCLUSO, ajuste, linhas à parte, quantidade 0, resumo e custo por Uso, valor manual, gravar, item da OS, troca de Uso, documento, Implantação |
| `tests/unit/orcamento-e2-ui.test.ts` | Configurações (cartões, lista só no Incluso, PUT, só leitura); construtor nos dois modos (linhas, pílula, totais, payload, troca, orçamento antigo); documento nos dois modos |
| `tests/unit/orcamento-e2-pg.test.ts` | Rotas reais + PostgreSQL: PUT da config (400 em valor inválido; campo antigo intocado); orçamento nasce com a regra; mudar a config não altera o antigo nem ao editar; gerar OS copia; faturar; OS sem orçamento fixa a regra; impressão/PDF |
| `tests/unit/sql-cobranca-materiais.test.ts` | O SQL de produção (acima) |

Expectativa atualizada de propósito: `tests/unit/proposta-corporativa-ui.test.ts`. O PUT de Configurações ›
Orçamento agora também manda `orcamentoCobrancaMateriais`.

## Prints (dados fictícios)

`docs/prints/orcamento-e2/`, desktop e celular. Cada tela tem três versões:

- `-antes`: o master de hoje;
- `-depois-a-parte`: a empresa e o ORC-209 com "Cobrado à parte";
- `-depois-incluso`: a empresa com "Incluso", no ORC-222.

As telas:

- `01-config-materiais`: Configurações › Orçamento, bloco Materiais;
- `02-construtor-materiais`: o painel "Materiais e peças" no construtor;
- `03-documento`: a tela do orçamento (no à parte, sem a opção "Mostrar materiais ao cliente");
- `04-implantacao`: a etapa de configuração, com "Como você cobra materiais?";
- `05-documento-itens` (só depois): a tabela de Serviços e Produtos do documento do cliente. No à parte, os materiais vão em Produtos com valor; no Incluso, ficam dentro do serviço, sem valor.

## Leva I.2 — material de campo no "Cobrado à parte" (item 7)

Com a regra da OS em **Cobrado à parte** (`A_PARTE`), o material que o técnico lança no app vira **item cobrado** da OS.
O app do técnico não mudou: quem decide é o servidor dos materiais de campo (`lib/execucao/materiais-campo.ts`), na
mesma transação do uso. A regra pura está em `lib/os/material-campo-cobranca.ts`; o banco, em `-server.ts`.

- **O item:** tipo PRODUTO, a quantidade usada (2 casas), o preço de **venda** (tabela do cliente; senão o valor padrão
  do produto). Material fora do catálogo entra com R$ 0 e pede o preço na conferência. Nasce executado, com
  `materialCampoId` (único: o mesmo uso nunca vira dois itens) e `conferirCampo = true`. A regra fica gravada na OS.
- **Não cobra:** modo Incluso (nada muda); o uso que consome a separação de um material já cobrado na OS (a peça ou o
  material derivado do serviço — não cobra duas vezes); a OS já faturada ou com nota.
- **Enquanto não conferido:** corrigir o uso (técnico ou escritório) muda a quantidade do item; remover/estornar o uso
  tira o item. Depois de conferido, o campo não mexe mais na cobrança. O item só nasce na 1ª gravação do uso.
- **A conferência** (Comercial › Itens da OS, quadro "Material de campo a conferir"): **Confirmar** (preço e
  quantidade ajustáveis; o preço precisa ser maior que zero) ou **Excluir da cobrança** (o uso e o estoque ficam como
  estão). Quem pode: quem edita a OS (botões só para ela; o servidor recusa com 403). A assinatura do cliente não trava
  a conferência; a fatura/nota trava. Fica na trilha da OS (quem e quando, em `conferidoCampo*`).
- **Faturar** a OS (`faturarOs`) com item a conferir é **bloqueado**: "Há material de campo a conferir nesta OS…".
  O item a conferir também não sai pelas rotas comuns (excluir, desmarcar executado, editar).
- Rota nova: `POST /api/ordens/[id]/orcamento/[itemId]/conferir-campo` (`{ acao: "confirmar" | "remover", quantidade?, valorUnitario? }`).
- Vocabulário: o glossário do sistema proíbe "Remover" em rótulo (`despoluicao-onda7`), por isso o botão é "Excluir da cobrança".

Testes: `leva-i2c` (regra pura e ligações), `leva-i2c-ui` (o quadro: confirmar com ajuste, preço 0, excluir, sem
permissão, faturada, assinada), `leva-i2c-pg` (pela fila real do app: preço da tabela, fora do catálogo, reenvio,
Incluso, corrigir/remover, faturar bloqueado, 403, confirmar/excluir, conferido não muda, fatura sai depois).
