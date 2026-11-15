# Padronização de telas — leva 6A (Comercial: contratos)

**As quatro telas de contrato: a lista, a ficha (nova e edição), "Reajustes a aplicar" e o relatório
de manutenções.** Reusa o que as levas 1 a 5 deixaram pronto (`TabelaPro` e os componentes de lista,
`Dica`, `SelectCadastroRapido` com criar e editar no contexto, toast e confirmação da casa,
`SomenteLeitura`) — nada paralelo.

**Não tem alteração de banco (🟢).** Nenhum arquivo em `prisma/sql/`, nenhuma mudança de schema.

A leva 6 foi dividida como o combinado: **6A é contratos** (este PR) e **6B é a lista de orçamentos,
os leads do site e as sugestões de item**. O formulário de contrato sozinho tem cinco abas e doze
seletores; junto com as sugestões viraria um PR difícil de revisar.

## Prioridade nº 1 — o que grava só aparece para quem pode

O servidor já recusava com 403 em todas as rotas de contrato. O que faltava era a tela não oferecer.

| Onde | Botão / caminho | Permissão | O que o servidor exige |
|---|---|---|---|
| `/contratos` | "Novo contrato" | Contratos › criar | `POST /api/contratos` |
| `/contratos/novo` | a página inteira | Contratos › criar | `POST /api/contratos` |
| `/contratos/[id]/editar` | Salvar, Salvar e continuar, menu de status, campos | Contratos › editar | `PUT /api/contratos/[id]`, `PATCH .../status` |
| `/contratos/reajustes` | Aplicar, Adiar 30 dias, Dispensar | Contratos › editar | `POST /api/contratos/[id]/reajuste` |
| `/contratos/relatorio` | "Gerar OS" | Ordens › criar **ou** Contratos › editar | `POST /api/contratos/[id]/gerar-os` |

### A ficha do contrato: somente leitura em vez de porta fechada

`/contratos/novo` e `/contratos/[id]/editar` **não checavam permissão nenhuma**. Quem não podia editar
preenchia as cinco abas e descobria no 403, com o preenchimento perdido.

- **`/contratos/novo`** agora exige Contratos › criar e manda para `/sem-permissao` — formulário vazio
  não tem nada para ler.
- **`/contratos/[id]/editar`** é a única tela de um contrato (`/contratos/[id]` só redireciona para
  ela), então fechá-la tiraria leitura de quem tem Contratos › visualizar. Em vez disso, ela abre em
  **somente leitura**: o conteúdo das abas fica num `<fieldset disabled>`, "Salvar", "Salvar e
  continuar" e o menu de status saem da tela, e entra a faixa `SomenteLeitura` da casa — "Somente
  leitura: requer a permissão Contratos › editar". Quem não tem nem `visualizar` nem `editar` vai para
  `/sem-permissao`.

O status continua visível como informação (pílula), só não vira menu.

## As telas, uma a uma

### `/contratos` — a lista

- A **tabela própria saiu**: virou `TabelaPro`, com colunas escolhíveis e larguras guardadas por
  usuário (`tabela:contratos`), ordenação pela URL como antes e **os três totais na faixa de cima**
  (contratos filtrados, equivalente por mês, equivalente por ano) — eram um rodapé solto.
- A instrução que ficava em parágrafo acima da lista virou o **ⓘ do título**: o valor é o de *cada*
  cobrança, o valor por ano segue a frequência, vencidos e vencendo em 30 dias aparecem destacados, e
  o reajuste anual se decide em Contratos › Reajustes.
- Lista vazia no componente da casa (`ListaVazia`), que diz o que não casou com a busca.
- Vocabulário: "1 contrato" / "N contratos" e "1 filtro" / "N filtros" no lugar de "contrato(s)".
- Os cartões de celular continuam como estavam (eram o padrão da casa já).
- As **ações em massa** já passavam por permissão (`useAcoesMassaDisponiveis`): a coluna de seleção
  só aparece para quem tem alguma ação disponível. Não mexi.

### `/contratos/novo` e `/contratos/[id]/editar` — a ficha

Além da permissão e do somente leitura acima:

- **Cliente** ganhou **editar no contexto** (telefone, celular, e-mail e os contatos, sem sair do
  contrato) — era o único seletor de referência do formulário sem o lápis.
- O `<select>` nativo do **responsável técnico** virou o **cadastro rápido** da casa
  (`RESPONSAVEL_TECNICO`, o mesmo do PMOC e de Dados da empresa): cadastra com CREA e edita no
  contexto, sem sair do contrato. O rótulo mostra o CREA.
- Na aba **Recorrência**, os dois `<select>` nativos por local — **Tipo de OS** e **Responsável** —
  viraram cadastro rápido com edição no contexto. Um técnico cadastrado ali **nasce habilitado no
  tipo de OS já escolhido**, senão ele sairia da própria lista (a lista filtra por competência).
- A **prévia das próximas 6 OS** usava uma tabela com classes próprias; agora é a planilha da casa
  (`PLANILHA`), com data em fonte tabular.

**Os outros oito seletores do formulário não são cadastros.** Status, tipo de contrato,
periodicidade, frequência da recorrência, tratamento de fim de semana, referência da NFS-e, dia de
vencimento e faturamento de adicionais são listas fixas de enum: não há o que cadastrar inline. É a
mesma família do "filtro é filtro" da leva 5. O inventário dizia "~12 seletores" contando todos.

A faixa de erro do formulário (`erroGlobal`, que aponta a aba com campo obrigatório) **ficou como
está**: é exatamente o que a tela de referência — Cadastro de Cliente — faz. Sucesso é toast, erro de
validação fica na tela, perto do formulário.

### `/contratos/reajustes` — a decisão do reajuste anual

- A tabela própria virou `TabelaPro` (`tabela:contratos-reajustes`), com os cartões de celular que
  já existiam passando a entrar por `cartoes`.
- **Aplicar, Adiar 30 dias e Dispensar só aparecem com Contratos › editar.** Sem a permissão, a linha
  continua informando o de-para do valor e diz "Quem cuida de contratos decide".
  A página em si já exigia Contratos › editar; a guarda na tela é a segunda camada — e passa a valer
  se um dia a leitura da tela for aberta a mais gente.
- ⓘ, toast e a confirmação da casa já estavam certos (vieram prontos na PR4/D8). O "Aplicar" continua
  mandando o **valor esperado**, que é o que impede aplicar o mesmo reajuste duas vezes.

### `/contratos/relatorio` — relatório de manutenções do mês

- **"Gerar OS"** era o único botão da tela que grava e não checava nada. Agora segue a regra da rota:
  Ordens › criar **ou** Contratos › editar.
- ⓘ no título explicando a tela (uma linha por contrato com manutenção prevista no mês, progresso das
  atividades, "Atrasado" = previsão vencida sem conclusão).
- Lista vazia no componente da casa; "contrato(s)" virou plural escrito.
- A tela já era de cartões expansíveis (funciona no celular) e já dava toast nos dois caminhos.

## Testes

| Arquivo | O que cobre |
|---|---|
| `tests/unit/padronizacao-leva6a.test.ts` | guardas de fonte: a permissão nas páginas do servidor, o `fieldset` do somente leitura, o ⓘ de cada tela, os seletores da casa (nenhum select nativo de RT, tipo de OS ou responsável), as tabelas (TabelaPro nas listas, planilha na prévia) e o plural escrito |
| `tests/unit/padronizacao-leva6a-pg.test.ts` | as rotas num PostgreSQL real: criar (403/401), salvar, mudar status (403 com o banco intacto, 200 com histórico de quem mudou), gerar OS (403; Ordens › criar basta; Contratos › editar também; repetir não duplica), reajuste (403; aplicar protegido pelo valor esperado; dispensar não mexe no valor) e o contrato de outra empresa (404) |
| `tests/unit/padronizacao-leva6a-ui.test.ts` | as telas montadas de verdade: a lista (botão por permissão, TabelaPro, ⓘ, lista vazia, cartões, plural), o relatório (botão pelas duas permissões, toast, recusa não muda a tela), os reajustes (decisão por permissão, confirmação, valor esperado, recusa) e a ficha (somente leitura × edição, cliente e RT com editar no contexto) |

**Dois testes antigos mudaram de expectativa (mudança intencional, nada mascarado):**

- `tests/unit/despoluicao-onda2.test.ts` montava a lista de contratos sem o provider de permissões e
  conferia que "Novo contrato" aparece. Agora o botão só sai para quem tem Contratos › criar, então o
  teste monta a tela dentro do `PermissoesProvider` (como a página faz) com permissão total — o
  assunto dele é a pintura dos cartões, não a permissão.
- `tests/unit/reajustes-ui.test.ts` idem para as três decisões (Aplicar, Adiar, Dispensar), que agora
  exigem Contratos › editar; e as asserções de `fetch` passaram a ignorar `/api/preferencias/...`,
  que a `TabelaPro` grava sozinha ao montar.

Quem cobre a permissão nessas duas telas é `padronizacao-leva6a-ui.test.ts`, com as duas pontas (com
e sem), e a mutação tem um mutante para cada uma.

**Mutação: 37 mutantes, 37 pegos.** Um por regra desta leva — cada permissão de tela e de rota, o
somente leitura, cada seletor, cada ⓘ, o plural, a chave da preferência de colunas, o mês que o
"Gerar OS" manda e o valor esperado do reajuste.

**Navegador real** (Chromium, app de verdade, banco de prints): a lista, a ficha nas duas permissões,
o relatório gerando a OS do mês e os reajustes aplicando o reajuste, com os prints de desktop,
celular e "sem permissão" em `docs/prints/padronizacao-leva6a/`.

## Decisões que ficaram

- **Somente leitura em vez de porta fechada** na ficha do contrato. Fechar a página era mais simples,
  mas `/contratos/[id]` redireciona para a edição: quem tem Contratos › visualizar perderia o único
  jeito de ler um contrato. O `<fieldset disabled>` + faixa `SomenteLeitura` é o padrão que as telas
  de Configurações já usam (leva 3).
- **A faixa de erro do formulário continua faixa.** A tela de referência faz igual; trocar por toast
  aqui criaria divergência, não padronização.
- **Oito dos doze seletores do contrato são listas fixas.** Cadastro inline em enum não existe.
- **A guarda de leitura das telas de Comercial não foi mexida.** `/contratos`, `/contratos/relatorio`
  e `/orcamentos` não exigem Contratos › visualizar para abrir — qualquer pessoa que entra no painel
  vê a lista e o relatório. Isso é anterior a esta leva e vale para o módulo inteiro; fechar leitura
  por módulo é decisão de produto, não de padronização. **Fica anotado para você decidir.**
- **`DELETE /api/contratos/[id]` existe e nenhuma tela usa.** A rota exige Contratos › editar. Não
  criei botão de excluir contrato: encerrar/cancelar é o caminho do negócio (status, com histórico).
