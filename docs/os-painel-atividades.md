# Central da OS — o painel de Atividades lado a lado

A tela de detalhe da OS é a mais importante do sistema. As atividades (cada visita do técnico,
com quem, quando e em que estado) ficavam numa **aba** separada: para entender "o dia da OS" o
gestor trocava de aba e perdia o Resumo de vista. Agora elas moram num **painel sempre visível**,
ao lado das abas no desktop e logo abaixo delas no celular — sem copiar design de ninguém e sem
pôr mais coisa na tela: é a mesma lista, no lugar certo.

## Vocabulário

O Frivo chama de **atividade** cada ida do técnico a campo dentro de uma OS (`atividades_os`): é o
que o calendário, o app do técnico, o relatório e o "O que falta" usam. **Visita** é a atividade
que nasce de um plano de visitas (OS em campanha): o chip "Visita N de M" continua. Por isso o
painel se chama **Atividades** e o botão, **Nova atividade**.

## O que mudou na tela

| | Antes | Agora |
|---|---|---|
| Abas | 6: Resumo, Atividades, Comercial, Materiais & Compras, Financeiro, Relatórios & Anexos | 5: a aba Atividades saiu |
| Atividades | Só na aba, abaixo do plano de visitas e das etapas com prazo | **Painel à direita** (`xl` e acima) ou **seção abaixo das abas** (celular/tablet); sempre à vista |
| Nova atividade | Botão tracejado no rodapé da lista | **No topo do painel**; o formulário abre logo abaixo dele |
| Cada atividade | Título, tipo, status, técnico, data, duração | O mesmo, com o **selo de estado** no tom do sistema de design (`StatusPill`), a **observação curta** numa linha (a inteira aparece ao abrir) |
| Ordem | De criação | **Do calendário**: pela data agendada, sem data no fim, canceladas por último |
| Plano de visitas (OS em campanha) | Na aba, acima da lista | No alto do painel, acima da lista (progresso, incluir dia, replanejar, mover, tirar) |
| Etapas com prazo (antiga aba "Prazos") | Dentro da aba Atividades | Cartão **Etapas com prazo** no Resumo, ao lado dos prazos |
| Resumo | 3 colunas (`lg`) | 1 coluna de cartões, pares lado a lado a partir de `md` — divide a tela com o painel |
| Números-chave "Atividades"/"Equipamentos", pendências de atividade | Abriam a aba | **Rolam até o painel e o destacam**, sem trocar a aba |
| `?aba=atividades`, `?aba=formularios` | Abriam a aba | Abrem o Resumo e rolam até o painel; `?aba=prazos` abre o Resumo (etapas) |

Nada da aba se perdeu: criar, editar, excluir, mudar o status, Executar, concluir sem
equipamento, equipamentos da atividade, formulário respondido, chip de prazo, "Visita N de M",
planejar/replanejar visitas — tudo continua, a partir do painel. Permissão igual à de antes:
quem só visualiza vê a lista sem "Nova atividade", editar ou excluir; o servidor continua
recusando o que a tela não oferece.

## Responsivo

`xl:grid-cols-[minmax(0,1fr)_24rem]`: abas à esquerda com o que sobra, painel com 24rem à direita.
Abaixo de `xl` o grid some e o painel desce, em largura total, sem scroll horizontal (conferido no
navegador real, desktop e celular). O Resumo deixou de ter 3 colunas porque dentro da coluna da
esquerda não cabem.

## Onde mora cada coisa

- `lib/os/abas.ts` — as 5 abas, o destino dos links antigos e `destinoDaAba` (aba × painel).
- `lib/os/painel-atividades.ts` — `ordenarParaPainel`, `observacaoCurta`, `resumoDoPainel`.
- `components/os/central/painel-atividades.tsx` — o painel (título + resumo, Nova atividade, plano de visitas, lista).
- `components/os/os-atividades.tsx` — a lista de sempre, com `novaNoTopo`/`cabecalho`/`antesDaLista`.
- `components/os/os-detalhe.tsx` — as duas colunas, o `irPara` que rola até o painel.
- `components/os/central/resumo-os.tsx` — o Resumo em uma coluna com o cartão de etapas.

Testes: `tests/unit/os-painel-atividades.test.ts` (regras), `tests/unit/os-central-ui.test.ts`
(tela). Prints: `docs/prints/os-painel-antes/` e `docs/prints/os-painel/`.
