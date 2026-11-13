# Padronização de telas — leva 1

Primeira leva da padronização: os **componentes compartilhados** que as próximas levas só reusam, e as
**telas pequenas de cadastro de apoio** que estavam fora do padrão. Sem alteração de banco.

Referência de ouro: o cadastro de cliente. Toda tela segue o mesmo esqueleto — cabeçalho e ações no
topo, formulário em seções, lista no padrão de listas (busca, filtros e paginação no servidor), ajuda no
ⓘ (não em parágrafo), vocabulário consistente e responsivo.

## Parte A — componentes compartilhados

### 1. Editar no contexto

O mesmo componente do "criar sem sair da tela" (`components/ui/select-cadastro-rapido.tsx`) agora
também **edita o item já escolhido**, sem sair da tela.

**Regra de ouro: a interface diz sempre o que está sendo editado.** As regras são puras e ficam em
`lib/edicao-contexto.ts` (tela e testes usam as mesmas):

| Escopo | O que muda | Título do painel | Faixa |
|---|---|---|---|
| `referencia` (cadastro-mãe) | Em todo lugar | "Editando o cadastro do cliente" | "Vale em todo lugar onde este cadastro é usado." |
| `uso` (a linha da transação) | Só ali | "Editando este item da OS" | "Vale só aqui. O cadastro não muda." |

- **Registro fechado não se edita.** `motivoDaTrava({ notaEmitida, faturado, aceite, statusOs,
  statusOrcamento })` devolve o motivo — nota emitida, faturado, OS assinada, OS concluída, orçamento
  aprovado pelo cliente — ou `null`. Com motivo, o lápis vira um cadeado desabilitado e o motivo fica
  no ⓘ ao lado.
- **Permissão.** Sem a permissão de editar, o lápis nem aparece.
- **Salvar.** Só vai para o servidor o que mudou (apagar um campo é uma mudança). Nada mudou: fecha
  sem chamar o servidor. Salvou: toast. O formulário principal não é enviado nem perde o que tinha.
- **Edição complexa.** Link "Abrir cadastro completo", em outra aba.

Como usar:

```tsx
// 1) Seletor com cadastro rápido: passe `edicao`
<SelectCadastroRapido
  value={clienteId} onChange={setClienteId} opcoes={clientes} entidade={CLIENTE.entidade}
  campos={CLIENTE.campos} criar={CLIENTE.criar} permissao={CLIENTE.permissao}
  edicao={{
    escopo: "referencia", alvo: "do cliente",              // "Editando o cadastro do cliente"
    campos: [{ nome: "telefone", label: "Telefone" }],
    valores: (id) => ({ telefone: cliente(id).telefone ?? "" }),
    salvar: (id, valores, alterados) => gravar(id, valores, alterados),
    permissao: { modulo: "clientes", acao: "editar" },
    linkCadastroCompleto: (id) => `/clientes/${id}`,
  }}
/>

// 2) Seletor de um cadastro do registro padrão (cargo, categoria…): basta `editavel`
<SeletorCadastro entidade="cargos" valor={cargoId} onChange={setCargoId} editavel />

// 3) A linha de uma transação (o item da OS, a linha do orçamento): o painel sozinho
<BotaoEditarNoContexto rotulo="Editar este item" travado={motivoDaTrava({ statusOs })} onClick={abrir} />
<EdicaoNoContextoModal
  aberto={aberto} onFechar={fechar} escopo="uso" alvo="este item da OS"   // "Editando este item da OS"
  campos={campos} valores={valoresDaLinha} salvar={gravarLinha} onSalvo={fechar}
/>
```

Onde já está ligado nesta leva:

- **Tipo de OS, de dentro da OS** — abertura da OS e atividades (nova e editar). Edita nome,
  descrição e cor do tipo; a regra do equipamento e os formulários ficam no cadastro completo.
- **Campos que apontam para outro cadastro, no formulário do cadastro padrão** — por exemplo, a
  categoria de dentro do produto.

O escopo `uso` (linha de transação) e a trava de registro fechado estão prontos e testados, mas ainda
não estão ligados a uma tela: entram com as telas de OS e orçamento, nas próximas levas.

### 2. Ajuda no ⓘ

Já existia um componente único: `components/ui/dica.tsx` (`<Dica texto rotulo />`). Abre com mouse,
toque e teclado, fecha com Esc, e o leitor de tela lê "Ajuda: <rótulo>". Nada novo foi criado — as
telas desta leva passaram a usá-lo no lugar de parágrafos.

- Lista: `ajuda="…"` no `CadastroPadrao` vira o ⓘ ao lado das abas.
- Campo: `ajuda` no campo do registro (`lib/cadastros/registro.ts`) vira o ⓘ do rótulo.

### 3. Padrão de lista

Já estava num componente reutilizável, e foi confirmado:

- `components/cadastros/cadastro-padrao.tsx` (`CadastroPadrao`) — abas Ativos / Inativos / Todos com
  contagem, busca com sugestões, paginação e ordenação **no servidor**, Novo / Editar / Inativar
  conforme a permissão, impacto antes de inativar, tabela no desktop e cartões no celular.
- `components/listagem/*` — `TabelaPro`, `CampoBusca`, `Paginacao`, `ListaVazia`, para as listas que
  não são cadastro.

O que faltava e entrou: **toast ao gravar** (criar, editar, inativar, reativar) e a coluna
`larga` (descrição ocupa o espaço que sobra).

### Esqueleto das telas de cadastro de apoio

`components/config/tela-cadastro-apoio.tsx`:

```tsx
<TelaCadastroApoio titulo="Tipos de OS" descricao="Tipos de serviço executados pela empresa">
  <TiposOsTela />   {/* um CadastroPadrao */}
</TelaCadastroApoio>
```

Cabeçalho (título + uma linha do que é) → cartão → cadastro padrão. Instrução longa não vai em
parágrafo: vai em `ajuda`.

## Parte B — telas tocadas

| Tela | Antes | Depois |
|---|---|---|
| **Tipos de OS** (Configurações) | Tabela própria: lista inteira de uma vez (busca só no navegador), sem abas (inativos num recolhível), sem paginação nem ordenação; Editar e Desativar (lixeira) à vista para qualquer usuário — o servidor recusava só depois do clique; sem impacto antes de desativar; sem versão de celular; "Novo tipo de os" | Cadastro padrão: abas com contagem, busca, ordenação e paginação no servidor, Novo / Editar / Inativar só com Configurações › gerenciar, impacto antes de inativar, cartões no celular, toast, regra do equipamento no ⓘ, coluna "Em uso" |
| **Tipos de problema** (Portal do cliente) | A mesma tabela própria, com um parágrafo de instrução | Cadastro padrão dentro da seção; a instrução foi para o ⓘ |
| **Tipos de equipamento** | Já no padrão de lista; cabeçalho e cartão montados à mão | Mesmo esqueleto (`TelaCadastroApoio`) e toast |
| **Categorias de produto** | Idem | Idem |
| **Categorias financeiras** | Idem | Idem |
| **Centros de custo** | Idem | Idem |
| **Cargos** | Idem, e mais estreita que as outras | Mesmo esqueleto, na largura das outras, e toast |
| **Kits de material** | Idem | Mesmo esqueleto e toast |

Prints em `docs/prints/padronizacao-leva1/` (`antes-*` e `depois-*`, desktop e celular).

### Tipos de OS e Tipos de problema no registro padrão

Entraram em `lib/cadastros/registro.ts` (`tipos-os`, `tipos-problema`). As rotas antigas
(`/api/tipos-os`, `/api/tipos-problema` e `/[id]`) só delegam para a mesma implementação de
`/api/cadastros/[entidade]` — uma regra só:

- ler: qualquer usuário logado (as telas de OS, orçamento, contrato e cliente precisam do catálogo);
  criar, editar, inativar e reativar: **Configurações › gerenciar**;
- a empresa vem sempre da sessão; campo desconhecido no corpo é recusado (400);
- editar é parcial; **inativar nunca apaga** (as OS, contratos, formulários e chamados continuam com
  o tipo, como "inativo");
- a rota antiga, sem `?ativo`, continua devolvendo ativos e inativos, e o tipo de OS continua vindo
  com os formulários ativos — as telas que leem daí não mudaram.

O arquivo `components/config/crud-cadastro.tsx` (a tabela própria) foi removido: ninguém mais o usa.

## O que não entrou (de propósito)

- Nenhuma outra tela do sistema — as próximas levas reusam o que está aqui.
- Ações em massa e importação por planilha para Tipos de OS e Tipos de problema.
- Edição no contexto de cliente, unidade, equipamento, produto e serviço dentro de OS e orçamento.

## Testes

- `tests/unit/edicao-contexto.test.ts` — regras puras (rótulo, alcance, trava, o que mudou).
- `tests/unit/padronizacao-leva1-ui.test.ts` — telas num DOM de verdade: edição no contexto
  (referência, uso, registro fechado, permissão, toast, formulário principal intacto), Tipos de OS,
  Tipos de problema e o esqueleto das telas de apoio.
- `tests/unit/padronizacao-leva1-pg.test.ts` — rotas reais com PostgreSQL real: a genérica e as
  antigas com a mesma regra (criar, editar parcial, inativar, permissão, multiempresa, paginação,
  impacto).
