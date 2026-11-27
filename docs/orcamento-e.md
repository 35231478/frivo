# Orçamento E — Material × Peça

Contexto do Zé: na climatização os **materiais** (tubo de cobre, suporte, cabo, fita, isolamento) vão embutidos no
preço do serviço, não têm nota e não são vendidos separados. Já as **peças** (compressor, placa, motor, capacitor)
são vendidas em linha própria, com valor. Exemplo: cobra-se a instalação com os materiais inclusos; se precisa de
compressor, vende-se o compressor e o serviço de troca.

Termos únicos em todo o sistema: **Material** e **Peça**. Eles substituem "Incluso no serviço" e "Venda à parte".

> 🔵 **Banco — NÃO aplicado.** O SQL está em `prisma/sql/2027-02-06_produto_uso_material_peca.sql`. Ele é aditivo e
> idempotente, e o Zé aplica no Neon antes do merge. Ver "O SQL" abaixo.

## Levantamento — o que existia

| Peça | Como era |
|---|---|
| Material × peça | Era decidido pela **categoria** do produto (`categorias_produto.comportamento`: `VENDA_A_PARTE` ou `INCLUSO_NO_SERVICO`). Produto sem categoria era tratado como incluso. O produto não tinha nada próprio. |
| Snapshot no orçamento/OS | `orcamento_materiais.comportamento` e `os_materiais.comportamento` guardam, por linha, o que valia na hora de orçar. O servidor grava o que a tela manda. |
| Peça no orçamento | Vira uma linha de **produto** derivada (`orcamento_produtos.material_id`), com valor, cobrada à parte. Nunca entra na base do serviço. |
| Material no orçamento | Ajusta o serviço pela diferença do padrão: (quantidade − padrão) × venda. |
| Documento do cliente (leva D) | Duas opções: "Mostrar materiais" e "Mostrar valores dos produtos/materiais", ambas desligadas por padrão. |
| Observação do item (construtor) | Ficava numa **coluna do meio**: Descrição \| Observação \| Qtd \| Unitário \| Total. No PDF ela já saía embaixo da descrição. |
| Estoque | A lista não mostrava nem filtrava material/peça. |
| Implantação | A planilha de produtos não tinha a coluna. |

## O que mudou

### 1. Uso no cadastro do produto

- **Campo "Uso"** no cadastro do produto, com as opções **Material** (consumo, vai incluso no serviço) e **Peça** (vendida à parte).
- **O Uso do produto manda.** A categoria só **sugere** o Uso de um produto **novo** cadastrado sem Uso: Peças de reposição vira Peça; Materiais, ou nenhuma categoria, vira Material. Trocar a categoria depois não muda o Uso.
- **Formulário do produto**: a 1ª opção do campo é **"Pela categoria (sugestão)"**. Um produto novo salvo assim recebe o Uso que a categoria sugere; quem quiser escolhe Material ou Peça. Um produto existente abre com o Uso dele.
- **Lista de produtos**: nova coluna "Uso". A coluna "Categoria" passou a mostrar **só o nome**. A pílula que ficava ao lado ("Material (padrão)") contradizia o Uso: aparecia "Material" num produto de Uso "Peça".
- **Lista do estoque**: coluna "Uso" e filtro **Uso** em "Mais filtros" (Material e Peça, Material, Peça). Um valor estranho na URL é tratado como sem filtro.
- **Planilha de produtos da Implantação** (etapa "Estoque inicial"):
  - nova coluna `uso`, que aceita "Material" ou "Peça", sem acento ou minúsculo, e sinônimos como "consumo" e "insumo";
  - vazia: o produto **novo** vira Material e o que já existe **não muda**;
  - valor desconhecido: erro na linha, com as opções válidas;
  - a exportação escreve o rótulo.

  A coluna fica na planilha de **produtos**, onde o produto nasce. A planilha de estoque só lança saldo.
- A composição do serviço (Materiais padrão) passa a dizer **"Pelo cadastro (Peça)"** no lugar de "Pela categoria (Venda à parte)". A exceção por serviço continua igual.

### 2. Orçamento

- **Materiais dentro do serviço, sem valor.** O documento do cliente (tela, link, impressão/PDF) mostra a lista **"Materiais inclusos"** dentro de cada serviço, só com descrição e quantidade.
- **"Mostrar materiais ao cliente" ligado por padrão**, tanto em Configurações › Orçamentos quanto em cada orçamento novo. Continua dando para desligar nos dois lugares.
- **O botão "Mostrar valores dos produtos/materiais" saiu** da tela do orçamento e de Configurações:
  - as colunas `orcamento_mostrar_valores_materiais` e `mostrar_valores_materiais` **ficam no banco**, sem uso;
  - as rotas ainda **aceitam** o campo antigo (uma tela velha aberta não dá erro) e o **ignoram**;
  - nem um orçamento antigo que estava com a opção ligada mostra valor de material.
- **Peças em linha própria com valor**: esse comportamento não mudou.
- **Trocar o Uso só neste orçamento.** Cada material do painel "Materiais e peças" tem um botão **Material ⇄ Peça**.
  - Caso típico: o gás refrigerante cobrado por kg.
  - Trocar muda **só o snapshot daquele orçamento**; o cadastro do produto não é tocado.
  - Virou Peça: sai do serviço e ganha a linha de produto, com valor.
  - Virou Material: some da tabela de produtos e volta para dentro do serviço.
  - Em leitura (orçamento travado, OS), aparece só a pílula com o termo.
  - O mesmo painel é usado no comercial da OS, então lá a troca também vale só para aquela OS.
- **Custo, lucro e margem** (com a permissão "Ver custo") continuam somando materiais e peças. **Estoque, separação e "Solicitar compra dos faltantes"** valem para os dois. Nada disso mudou.

### 3. Observação do item

No construtor do orçamento, a observação do item **saiu da coluna do meio**. Ela foi para um lugar próprio, logo
**abaixo da descrição** do serviço, na mesma célula, em letra menor, cinza e itálica, como no PDF.

- **Vazia**: só um link discreto **"+ Observação"**. No computador ele aparece ao passar o mouse na linha ou com o foco do teclado; no celular aparece sempre.
- **Colunas**: a tabela ficou com Descrição, Qtd, Unitário e Total.
- **Linha derivada de peça**: não tem observação, porque é editada nos materiais.

### 4. PDF e link do cliente

O documento é um componente só para tela, link e impressão/PDF. A consulta do documento deixou de ler até o **preço
de venda** do material: só descrição, quantidade, unidade e Uso. O custo nunca é lido.

## Decisões (registradas, não chutadas)

1. **Fonte da verdade = Uso do produto.** A categoria vira só sugestão. Produto lido sem o Uso (dado antigo em memória) cai na categoria, como antes.
2. **Preenchimento dos produtos que já existem**: pela **origem mais usada**.
   - Conta como Material: composição de serviço, kit, material incluso no orçamento e na OS.
   - Conta como Peça: linha de produto avulsa no orçamento e na OS, material "à parte" no orçamento e na OS.
   - Empate, inclusive produto nunca usado: decide a categoria (Peças de reposição vira Peça); sem categoria, Material.
3. **O padrão "ligado" vale para o que nasce depois do SQL.** Empresas e orçamentos que já existem **ficam como estão** (gravados `false`). O SQL traz um `UPDATE` **comentado** que liga o padrão nas empresas atuais; ele só vale para os orçamentos novos delas. É decisão do Zé.
4. **Trocar Material para Peça no orçamento** cobra a quantidade inteira em linha própria e **não abate** nada do serviço. Peça nunca fez parte da base do serviço. Ver a pergunta 1.

## O SQL (`prisma/sql/2027-02-06_produto_uso_material_peca.sql`)

1. Cria o tipo `"UsoProduto"` (MATERIAL, PECA) dentro de um bloco `DO`, então rodar de novo não dá erro.
2. `ALTER TABLE produtos ADD COLUMN IF NOT EXISTS uso`, primeiro nulo.
3. Preenche **só onde `uso IS NULL`**, pela origem mais usada (regra acima). Rodar de novo não desfaz uma escolha feita depois no cadastro.
4. Coloca o padrão `'MATERIAL'` e torna a coluna `NOT NULL`.
5. Muda **só o padrão** de `configuracoes.orcamento_mostrar_materiais` e `orcamentos.mostrar_materiais` para `true`.
6. Bloco opcional comentado, descrito na decisão 3.

Não apaga nada: sem `DROP`, `DELETE` ou `TRUNCATE` (testado). O resultado é igual ao que o `schema.prisma` espera (o `prisma migrate diff` sai vazio, testado num PostgreSQL real).

## Perguntas para o Zé

1. **Material virando Peça no orçamento**: hoje a quantidade inteira vai em linha própria e o serviço fica na base. Exemplo: o serviço tem 1 kg de gás no padrão, e no orçamento o gás vira Peça com 2 kg. O cliente paga 2 kg à parte e o serviço não abate o 1 kg do padrão. Deve abater?
2. **Ligar "Mostrar materiais" nas empresas que já existem?** O `UPDATE` está pronto e comentado no SQL; só vale para os orçamentos novos delas.

## Testes

- `tests/unit/sql-produto-uso.test.ts` (6, PostgreSQL real): o SQL rodado 2× sobre uma "produção de hoje" com dados fictícios. Cobre o preenchimento por origem, o empate pela categoria, a 2ª rodada que não desfaz o cadastro, o padrão e o `NOT NULL`, os defaults, o `migrate diff` vazio e a ausência de DROP.
- `tests/unit/orcamento-e.test.ts` (15, regras puras):
  - termos;
  - Uso × categoria;
  - sugestão para produto novo;
  - trocar Uso;
  - campo e coluna do cadastro;
  - schema;
  - planilha (aceitos, vazio, erro, exportar);
  - filtro do estoque.
- `tests/unit/orcamento-e-ui.test.ts` (5, tela): trocar Material ⇄ Peça no construtor, cobrindo a linha derivada, o ajuste do serviço, o payload e a ausência de gravação no cadastro. Também a leitura sem botão e a observação abaixo da descrição.
- `tests/unit/orcamento-e-pg.test.ts` (5, PostgreSQL real com rotas reais):
  - cadastro (sugestão, Uso vence, editar sem Uso não muda, 400);
  - materiais-padrão pelo Uso;
  - orçamento com o gás trocado para Peça (snapshot, linha com valor, custo somando, cadastro intacto);
  - planilha (cria, atualiza, vazia não muda, erro);
  - filtro do estoque, só da empresa.
- **Expectativas atualizadas de propósito**:
  - `orcamento-leva-d` (puro, tela e PG): padrão ligado, sem a opção de valores, campo antigo aceito e ignorado, registro antigo sem valor;
  - `proposta-corporativa-ui`: o PUT de Configurações leva `orcamentoMostrarMateriais: true`;
  - `orcamento-materiais-ui`: o documento mostra a lista dentro do serviço;
  - `orcamento-construtor-ui`: a observação embaixo da descrição;
  - `estoque-e31-ui`, `estoque-e32-ui`, `leva-estoque-e31` e `orcamento-materiais-ui`: rótulos Material e Peça;
  - `leva-importacao` e `codigos-exportacao`: a coluna `uso` na planilha (as linhas de teste passam a ser montadas pela chave da coluna, porque a planilha é lida pelo título);
  - `listas-ui` e `codigos-exportacao-ui`: a coluna Uso na lista de produtos (ordenável, e no cartão do celular);
  - `composicao-servico-pg`, `orcamento-materiais-pg`, `os-materiais-pg` e `padronizacao-leva2-pg`: os produtos de teste da categoria Peças ganham `uso: PECA`, como o SQL deixaria, porque agora o Uso do produto manda.

## Prints (desktop e celular, dados fictícios)

Pasta `docs/prints/orcamento-e/`, nos sufixos `-desktop` e `-celular`.

| Print | O que mostra |
|---|---|
| `01-construtor-{antes,depois}` | Construtor do orçamento. Depois: sem a coluna "Observação" no meio |
| `02-documento-{antes,depois}` | Documento na tela do orçamento e bloco "Documento do cliente" só com "Mostrar materiais" |
| `03-config-orcamento-{antes,depois}` | Configurações › Orçamentos. Depois: sem "Mostrar valores dos produtos/materiais" |
| `04-estoque-lista-{antes,depois}` | Lista do estoque. Depois: coluna "Uso" |
| `05-construtor-servico-{antes,depois}` | Serviço com materiais. Depois: observação logo abaixo da descrição e botão Material ⇄ Peça em cada material |
| `06-documento-servico-{antes,depois}` | O serviço no documento. Depois: observação discreta e "Materiais inclusos" dentro do serviço, sem valor |
| `07-estoque-filtro-peca` | Estoque filtrado por Uso = Peça |
| `08-produtos-coluna-uso` | Lista de produtos com a coluna Uso, e a Categoria só com o nome |
| `09-produto-campo-uso` | Novo produto: campo Uso com "Pela categoria (sugestão)" |
| `10-trocar-uso-antes-do-clique` | Painel de materiais antes de trocar |
| `11-trocar-uso-virou-peca` | O material trocado para Peça só neste orçamento |
| `12-peca-em-linha-propria` | A peça na tabela de produtos, com valor (custo, lucro e margem só com a permissão) |
