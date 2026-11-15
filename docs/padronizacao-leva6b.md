# Padronização de telas — leva 6B (Comercial: orçamentos, leads do site e sugestões de item)

**As duas telas que faltavam do Comercial — a lista de Orçamentos e os Leads do site — mais as
sugestões inteligentes de item no orçamento.** Reusa o que as levas 1 a 6A deixaram pronto
(`TabelaPro` e os componentes de lista, `Dica`, `InativarRegistro`, toast e confirmação da casa) —
nada paralelo.

**Não tem alteração de banco (🟢).** Nenhum arquivo em `prisma/sql/`, nenhuma mudança de schema: o
status `CANCELADO` e a linha do tempo (`orcamento_eventos`) já existiam.

## Prioridade nº 1 — o que grava só aparece para quem pode

| Onde | Botão / caminho | Permissão | O que o servidor exige |
|---|---|---|---|
| `/orcamentos` | "Novo orçamento" | Orçamentos › criar | `POST /api/orcamentos` |
| `/leads-site` | "Descartar" | Orçamentos › excluir | `DELETE /api/orcamentos/[id]` |
| `/leads-site` | "Reabrir" | Orçamentos › editar | `PATCH /api/orcamentos/[id]` |
| formulário do orçamento | a faixa de sugestões | Orçamentos › criar | `GET /api/orcamentos/sugestoes` |

**O buraco: "Novo Orçamento" aparecia para todo mundo**, inclusive para quem só consulta — o 403 só
chegava depois de preencher o orçamento inteiro. Agora o botão segue a regra da rota.

## As telas, uma a uma

### `/orcamentos` — a lista

Era a tela mais perto do padrão (já tinha `TabelaPro`, cards de período, cancelar/reabrir). Faltava:

- **ⓘ no título** explicando a tela: os cards são do período e filtram ao clicar; cancelar não apaga
  nada e pode ser reaberto; aprovado vira OS ou contrato pelas ações da linha.
- **"Novo orçamento" por permissão** (Orçamentos › criar) e em caixa de frase.

### `/leads-site` — os leads do site

A tela tinha tabela própria, nenhuma ação e nenhuma instrução. Ficou assim:

- A **tabela própria saiu**: virou `TabelaPro` (`tabela:leads-site`), com colunas escolhíveis e
  larguras por usuário, e **cartões no celular** (antes a tabela rolava de lado).
- **Descartar / Reabrir** entram pelo `InativarRegistro` da casa, apontando para as rotas que já
  existiam: descartar é o soft-delete (status `CANCELADO`), reabrir volta para rascunho. Nada é
  apagado — o orçamento, o cliente e o link público ficam preservados.
- **Filtro "Descartados"**, e "Todos" passa a esconder os descartados (o padrão da casa desde a
  leva 1: cancelado não polui a lista).
- **Quem descartou e quando** na própria linha, lido da linha do tempo do orçamento
  (`orcamento_eventos`). Para isso, o descarte e a reabertura **passaram a registrar o evento** —
  antes só a troca de status pela ficha registrava, então cancelar pela lista não deixava rastro.
  Isso vale também para `/orcamentos`, que usa a mesma rota.
- **Atalho para a ficha do cliente** em cada linha (o nome continua abrindo o orçamento).
- ⓘ no título, `ListaVazia` da casa, "1 lead" / "N leads" e "1 novo em 24h" / "N novos em 24h" no
  lugar de "lead(s)".

## Sugestões de item (Princípio 9)

Ao escolher o cliente, o formulário do orçamento mostra **os serviços e produtos que mais entraram
nos orçamentos dele, cada um com o último preço praticado**. Clicar adiciona a linha — editável como
qualquer outra. Nada é preenchido sozinho.

As regras ficam em `lib/orcamentos/sugestoes-itens.ts` (a tela e o servidor usam as mesmas), irmãs
das sugestões da abertura da OS (leva 5):

- janela de **6 meses**;
- conta **orçamentos distintos**, não linhas (o mesmo serviço em três linhas do mesmo orçamento é um);
- só sugere o que apareceu em **pelo menos 2** orçamentos — histórico fino não sugere;
- o preço é o da **linha mais recente**, nunca uma média;
- no máximo **5** itens, do mais usado para o menos; empate desempata pelo mais recente;
- **orçamento cancelado não conta** (foi um caminho que não vingou), o **orçamento aberto não se
  sugere a si mesmo**, e o item de catálogo **inativado** no meio do caminho sai da lista;
- a faixa diz de onde veio ("3 orçamentos deste cliente nos últimos 6 meses") e tem "Dispensar".

## Testes

| Arquivo | O que cobre |
|---|---|
| `tests/unit/sugestoes-itens.test.ts` | as regras puras: contagem por orçamento, mínimo, último preço, chave do item (catálogo × texto), ordem, teto e a janela móvel |
| `tests/unit/padronizacao-leva6b.test.ts` | guardas de fonte: permissão no "Novo orçamento", ⓘ das duas telas, tabela e cartões dos leads, filtro "Descartados", descarte pelo componente da casa, atalhos e plural escrito |
| `tests/unit/padronizacao-leva6b-pg.test.ts` | as rotas num PostgreSQL real: sugestões (403 sem criar, 400 sem cliente, cancelado/janela/catálogo inativo/outra empresa) e descartar/reabrir (403 com o banco intacto; 200 com o evento de quem e quando; 404 de outra empresa) |
| `tests/unit/padronizacao-leva6b-ui.test.ts` | a faixa montada de verdade: sem cliente não pergunta, histórico fino não aparece, 403 não atrapalha, o clique adiciona a linha com o preço, o que já está na lista some e "Dispensar" funciona |

**Mutação: 44 mutantes, 44 pegos.** Um por regra desta leva — cada permissão de tela e de rota, cada
peça da tabela dos leads, o filtro, o registro de quem descartou, cada regra das sugestões e o preço
que a linha sugerida carrega.

## Decisões que ficaram

- **Descartar usa a permissão da casa (Orçamentos › excluir), não "editar".** O pedido era "exige
  `orcamentos › editar`"; a mesma ação já existe em `/orcamentos` pela rota `DELETE`, que exige
  `excluir` (reabrir é que exige `editar`). Criar uma segunda regra para a mesma ação seria o oposto
  de padronizar — e mexer na rota mudaria também quem pode cancelar em `/orcamentos`, que é RBAC.
  **Fica anotado para você decidir.**
- **Sugestão de item é do orçamento, não do contrato.** O formulário de contrato não tem lista de
  itens: o que ele tem é a recorrência por local, que já é sugerida a partir dos locais do cliente.
  Se quiser sugestão no contrato (valor? periodicidade?), diga o quê — não chutei.
- **A faixa não aparece para quem não pode criar orçamento.** A rota exige Orçamentos › criar; a
  tela trata a recusa como "sem sugestão" e segue funcionando.
