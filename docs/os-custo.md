# Custo na OS só com permissão

Mesma regra do #241 (orçamento leva B) aplicada à OS. Banco: **nenhum**. Sem SQL.

## A regra e por que essa

**Regra única do custo de compra** (`lib/estoque/custo-acesso.ts`):

- vê custo quem tem **Estoque › visualizar** OU **Orçamentos › Ver custo e margem**;
- administrador (ADMIN/SUPER_ADMIN) sempre vê;
- **papel TÉCNICO nunca vê** (`usuarioVeCustoDeCompra`), mesmo que o perfil tenha alguma permissão de estoque.

**Por que não uma chave nova `ordens.verCusto`:** o custo dos materiais da OS é o **mesmo dado**: o último custo de
compra, copiado para o material quando ele entra (ou copiado do orçamento ao gerar a OS). Quem tem uma dessas duas
permissões já vê esse custo: na ficha do produto no Estoque, ou no Editar orçamento de onde a OS veio. Uma terceira
chave dividiria o mesmo dado em três permissões e exigiria SQL e acerto de perfis. Reusar a regra do #241 mantém uma
porta só, sem banco.

## Levantamento — onde o custo aparecia na OS

| Ponto | Antes | Depois |
|---|---|---|
| Página da OS (`/ordens/[id]`), aba Comercial › Itens da OS | `custoUnit` de cada material ia nas props, ou seja, para o navegador de qualquer um que vê a OS. Ficava visível em "Materiais e peças" (custo por material e "Custo interno") | sem permissão, a chave some das props (`verCusto=false`) e a tela não mostra custo |
| `GET /api/ordens/[id]` (gaveta do calendário e outros) | trazia `custoUnit` para quem tem Ordens › visualizar | sem permissão, vem sem a chave |
| `GET /api/ordens/[id]/orcamento/catalogo` (adicionar serviço/produto do catálogo) | materiais com custo para quem edita OS | preço de venda sim; custo só com a regra |
| `POST /api/ordens/[id]/orcamento` e `PUT/PATCH .../[itemId]` (respostas) | item e peças com `custoUnit` | sem permissão, sem a chave |
| `POST`/`PUT` do item (gravação) | **gravava o `custoUnit` vindo do navegador** (dava para forjar) | o servidor decide: produto que já estava no item mantém o custo gravado; produto novo pega o último custo de compra; linha à mão fica sem custo. Quem não vê custo salva sem apagar o custo |
| `GET /api/compras/ultima-compra` pela OS (dica "Última compra: R$ …" no pedido de compra) | bastava Ordens › editar | **403** sem a regra (Compras › visualizar segue) |
| Relatório da OS / PDF (`/ordens/[id]/relatorio`, `/relatorio/os/[token]` e `/imprimir`) | não lia custo | continua sem; travado em teste e conferido no HTML real |
| Link do aceite do cliente (`/relatorio/aceite/[token]`) | não lia custo | continua sem; travado e conferido |
| App do técnico (`/api/tecnico/meu-dia`, `/agenda`, atividade; "O que levar") | não lia custo (o "O que levar" seleciona só produto, descrição, unidade e quantidade) | continua sem; o painel da OS é bloqueado ao técnico (403) e a regra de sessão diz "técnico nunca" |
| Separação, consumo e devolução de material | sem custo nos selects | sem mudança |

## Testes

- `tests/unit/os-custo.test.ts`: regras puras (sessão com técnico nunca, custo decidido no servidor, a chave some).
- `tests/unit/os-custo-pg.test.ts`: PostgreSQL real, 401/403/200 por perfil (sem login, sem OS, supervisor sem custo,
  com Estoque, com ver custo, admin, técnico). Cobre catálogo, POST/PUT/PATCH (custo forjado ignorado, gravado mantido
  com compra nova, produto novo), GET da OS, props da página, última compra pela OS, e uma trava no código: relatório,
  PDF, link, aceite e app do técnico não leem custo.
- `tests/unit/os-custo-ui.test.ts`: os Itens da OS num DOM real, com e sem a permissão (item do orçamento, "Materiais
  e peças deste item", novo serviço do catálogo; o POST não leva valor de custo).
- Ajuste intencional em `orcamento-estoque-margem-pg`: a "última compra" pela OS passou de 200 para 403 sem a regra.

## Prints

ANTES: `docs/prints/os-custo-antes/` · DEPOIS: `docs/prints/os-custo-depois/` (desktop e celular, admin e supervisor
de OS sem permissão de custo).
