# Orçamento — leva B: estoque e margem no Editar orçamento

Itens anotados pelo dono na ferramenta de Anotações Internas (tela Editar orçamento).
Banco: **nada obrigatório**. Um SQL **opcional** (`prisma/sql/2027-01-26_orcamentos_ver_custo.sql`) liga a
permissão nova nos perfis do tipo Administrador já gravados — **pendente, não aplicado** (ver "Banco").

## Levantamento — o que existia

| Tema | Como era |
|---|---|
| Disponível em estoque | `Produto.saldo` é o cache do razão de estoque. A reserva da OS (separação, E4.1) é um lançamento `RESERVA` que **subtrai** do saldo, e o estorno (`ESTORNO_RESERVA`) devolve. Ou seja: **o saldo já é "o que há menos o reservado"** — a tela de separação usa exatamente isso. Produto com `controlaEstoque=false` não tem saldo que valha. O Editar orçamento não mostrava nada de estoque. |
| Custo | O Estoque usa o **último custo de compra** (`ultimosCustos` em `lib/estoque/custo.ts`: última ENTRADA com custo). Não há custo médio no sistema. Os materiais do serviço já copiavam esse custo para `orcamento_materiais.custo_unit` na hora de orçar (snapshot) e o painel de materiais mostrava "Custo interno". |
| Margem | `margemSobreVenda` em `lib/estoque/preco.ts` (margem sobre a venda) — usada na precificação do Estoque. |
| RBAC | Não havia permissão de custo no orçamento: **qualquer um que editasse orçamento via custo**. |
| Payloads (achado de segurança) | O custo dos materiais ia ao navegador de **todo mundo** que abria o Editar: na página (props do formulário), no `GET /api/orcamentos/[id]` e no `GET /api/orcamentos/materiais-padrao`. E o salvar **gravava o `custoUnit` que viesse do navegador** (dava para forjar custo). |
| PDF / link do cliente | `INCLUDE_DOCUMENTO_ORCAMENTO` (link público, impressão/PDF e versão interna) **não lê materiais nem custo** — já estava limpo; agora há teste que trava isso. |
| Resíduos da leva A | "Anexos da proposta" com dois parágrafos explicativos na tela; nos totais, "Sem ISS (alíquota 0% em Configurações)." |

## O que mudou

### 1. "Disponível em estoque" por produto e material
- Sob cada produto: **"Disponível 4 un"**; nos materiais do serviço: **"Disp. 30 m"** ao lado do nome.
- Quando a quantidade do orçamento passa do disponível: ⚠ **"Disponível −1 un · faltam 3"** em tom de atenção
  (discreto, não bloqueia nada).
- **Mesma regra do Estoque:** disponível = saldo do produto (já líquido das reservas). Produto que não controla
  estoque: não mostra nada.
- **Módulo Estoque desligado:** a rota responde **200** com `estoque: false` e **sem** o campo `disponivel`; a tela
  simplesmente não mostra a informação (regra nº 1 da modularização: o núcleo nunca dá 403).
- Rota nova: `GET /api/orcamentos/situacao-produtos?ids=…` (quem cria ou edita orçamento; só produtos da empresa
  da sessão; até 300 por chamada). A tela pede uma vez, com uma espera curta quando o conjunto de produtos muda.

### 2. Custo, lucro e margem — só para quem tem a permissão
- Permissão nova: **Orçamentos › Ver custo e margem** (`orcamentos.verCusto`). Aparece sozinha em
  Configurações › Perfis de acesso. Papel ADMIN/SUPER_ADMIN vê sempre; demais perfis só se ligarem.
- Com a permissão, sob cada produto: **Custo R$ 154,00 · Lucro R$ 205,60 · Margem 57,2%** (custo = último custo de
  compra × quantidade; peça derivada usa o custo copiado no material). No fim dos totais, o quadro
  **Custo e margem**: custo (produtos e materiais), lucro bruto, margem e "N itens sem custo de compra (fora da
  conta)". Margem negativa em vermelho; até 10% em atenção.
- **O dado não vai ao navegador de quem não tem a permissão** (não é só esconder):
  - página do Editar: os materiais saem **sem a chave** `custoUnit`;
  - `GET /api/orcamentos/[id]` e `GET /api/orcamentos/materiais-padrao`: idem;
  - rota de situação: sem a chave `custo`;
  - o vendedor também deixa de ver o "Custo interno" do painel de materiais (mudança de comportamento
    intencional — era o mesmo vazamento).
- **O salvar decide o custo no servidor** (`fixarCustosDosMateriais`): material já gravado mantém o custo copiado
  na hora de orçar; material novo pega o último custo de compra; linha à mão fica sem custo. Custo vindo do
  navegador é ignorado. Assim o vendedor salva sem apagar o custo e ninguém grava custo inventado.
- **PDF e link do cliente:** continuam sem custo (a consulta do documento nem lê materiais) — travado em teste e
  conferido no HTML real de `/orcamento/<token>` e `/orcamento/<token>/imprimir`.

### 3. Despoluição
- **Anexos da proposta:** os dois parágrafos foram para o ⓘ do título; na tela fica só a contagem (`2/12`).
- **Totais:** "Sem ISS" + ⓘ com o porquê (alíquota 0% em Configurações › Orçamentos e como o ISS entra).

## Decisões tomadas

1. **Disponível = saldo** (não "saldo − reservado"): o saldo já desconta as reservas; subtrair de novo contaria a
   reserva duas vezes. É a mesma regra da separação.
2. **Custo = último custo de compra** — é o único custo que o Estoque tem e o que os materiais já copiavam.
3. **Margem sobre a venda** (`(venda − custo) ÷ venda`), como no Estoque.
4. **Resumo:** venda = total geral **sem o ISS** (imposto não é receita); custo = produtos + peças + materiais
   inclusos com custo conhecido. Mão de obra não tem custo no sistema e não entra (dito no ⓘ). Item sem custo
   conta em "sem custo" e fica fora da conta (não vira custo zero).
5. **Peça derivada** (material "venda à parte" que vira linha de produto) entra uma vez só — pelo material.
6. **No celular**, disponível e custo/margem descem para uma linha abaixo do item (quebra de linha, sem rolagem
   horizontal — conferido no navegador).
7. A tela só mostra custo se **o perfil tiver a permissão E o servidor confirmar** (`verCusto` da rota).

## Banco

🟢 Nada obrigatório: a permissão é uma chave nova no JSON dos perfis (chave ausente = sem a permissão) e o
papel ADMIN já vê sem SQL.

🔵 **Opcional, pendente (não aplicado):** `prisma/sql/2027-01-26_orcamentos_ver_custo.sql` liga
`orcamentos.verCusto` nos perfis **do tipo Administrador** já gravados (que hoje não têm a chave). Aditivo e
idempotente: não toca quem já tem a chave (true ou false), nem outros tipos, nem JSON fora do formato; testado em
PostgreSQL real rodando três vezes (`tests/unit/sql-orcamentos-ver-custo.test.ts`).

## Perguntas em aberto (para o Zé)

1. **`/api/estoque/custos`** entrega o último custo a **qualquer usuário logado** (rota do Estoque, fora deste
   escopo e do RBAC do orçamento). Não mexi (regra: não mexer em RBAC do painel). Fechar com a permissão do
   Estoque?
2. **OS:** a tela/API de itens da OS (`/api/ordens/[id]/orcamento`, painel de materiais da OS) também mostra o
   custo dos materiais a quem edita a OS. Aplicar a mesma permissão lá numa próxima leva?
3. **SQL opcional:** aplicar para que perfis "Administrador" personalizados (sem o papel ADMIN) já vejam a margem?

## Testes

- `tests/unit/estoque-margem.test.ts` — regras puras (falta, margem, resumo, peça não contada duas vezes, tom,
  chave que some, custo confiável).
- `tests/unit/orcamento-estoque-margem-pg.test.ts` — PostgreSQL real: situação (empresa, sem controle, Estoque
  desligado = 200 sem disponível), **sem a permissão nenhum payload traz custo** (situação, GET, materiais-padrão,
  props da página do Editar), salvar com custo forjado/gravado/novo/de outro orçamento, documento sem custo.
- `tests/unit/orcamento-estoque-margem-ui.test.ts` — o formulário num DOM real com e sem a permissão, Estoque
  desligado, rota falhando, "Sem ISS" no ⓘ; `tests/unit/proposta-corporativa-ui.test.ts` — Anexos no ⓘ.
- `tests/unit/sql-orcamentos-ver-custo.test.ts` — o SQL opcional.
- Mutação: ver o PR. Navegador real: 22 conferências (desktop e celular, admin e vendedor, Estoque desligado,
  HTML do link e do PDF).

## Prints

ANTES: `docs/prints/orcamento-b-antes/` · DEPOIS: `docs/prints/orcamento-b-depois/`.
