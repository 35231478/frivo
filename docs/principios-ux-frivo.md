# Princípios de UX do Frivo

Os seis primeiros princípios estão descritos e medidos na auditoria de UX
(`docs/auditoria-ux-2026-10-22.md`):

1. Criação inline: criar sem sair da tela.
2. CRUD visível conforme a permissão.
3. Feedback sempre.
4. Responsivo de verdade.
5. Escala: busca, filtro e paginação.
6. Consistência entre telas.

A identidade visual (cores, tipografia, componentes-base) está em `docs/design-system.md`.

## Princípio 7: tom profissional, texto curto e ajuda na dica (ⓘ)

O Frivo deve ter cara de software profissional. A tela mostra o essencial; a explicação fica a um
toque, no ícone ⓘ.

### Regras de conteúdo

1. **Rótulo curto na tela, explicação na dica.** Parágrafos de orientação, "como funciona" e regras de
   preenchimento saem da tela e vão para o ⓘ ao lado do rótulo, do título da seção ou do título da
   página.
2. **Sempre visível, nunca na dica:**
   - avisos de segurança e privacidade (o que é enviado, criptografado ou não armazenado);
   - campos fiscais e legais que o contador precisa enxergar, e o significado do valor escolhido (ex.: a
     descrição do código LC 116, o CNAE que vai na nota);
   - mensagens de erro, de estado e de permissão (ex.: "Somente leitura: requer a permissão…",
     pendências, ambiente de homologação).
3. **Tom formal e direto.** Frases curtas, sem gíria, sem exclamação, sem tutorial. Preferir "Em
   branco, …" a "Vazio = …"; "Somente leitura: requer a permissão X" a "Só quem … pode alterar".
4. **Títulos em caixa de frase:** "Dados da empresa", "Tipos de equipamento", não "Dados da Empresa".
5. **Descrição de página com no máximo uma linha curta.** O detalhe vai para a dica do título.
6. **Sem emoji e sem cara de IA.** Nada de "✨", "Ótimo!", "Pronto!" ou tom de conversa.

### Como aplicar no código

Há um componente de dica, e só um: `components/ui/dica.tsx` (`Dica`). Não crie outro tooltip.

| Onde | Como |
|---|---|
| Campo de formulário | `<FormField label="CNAE" dica="…">` |
| Seção de formulário | `<FormSection title="Endereço" dica="…">` |
| Título de card | `<CardTitulo dica="…">Emitente</CardTitulo>` |
| Título da página | `<PageHeader title="…" description="…" dica="…" />` |
| Interruptor | `<ToggleSwitch label="…" dica="…" />` e `<ToggleGroup title="…" dica="…">` |
| Cadastro padrão | prop `ajuda` do `CadastroPadrao` (vira ⓘ ao lado das abas); erros vão em `aviso`, visíveis |
| Campo do registro de cadastros | `ajuda` no `CampoCadastro` (`lib/cadastros/registro.ts`) vira a dica do campo; `descrever` (o que o valor significa) continua visível |
| Qualquer outro lugar | `<Dica texto="…" rotulo="Do que a dica fala" />` |

**Prop `hint` × prop `dica`.** O `hint` (texto sob o campo) fica para mensagens curtas de estado ou
de valor, que precisam ser vistas sem abrir nada. Explicação vai em `dica`.

### Comportamento da dica (acessibilidade)

- Desktop: abre no hover do mouse e fecha ao sair.
- Celular: abre e fecha no toque; toque fora ou rolagem da tela fecham.
- Teclado: abre no foco; Esc fecha; Enter ou Espaço alternam.
- Leitor de tela: o botão se chama "Ajuda: <rótulo>" e é descrito pelo balão (`aria-describedby`,
  `role="tooltip"`). O balão fica no DOM mesmo fechado.
- O balão é renderizado no `body` (portal, posição fixa). Não é cortado por gaveta, modal ou tabela
  com rolagem, abre para cima perto do rodapé e nunca sai da tela.
- Clicar na dica não aciona o que está em volta: não foca o campo, não liga o switch e não clica no card.
- O visual segue `docs/design-system.md`: balão escuro (`bg-ink`), texto branco de 12 px, ícone
  `Info` em `text-ink-subtle`.

## Padrão das telas de lista: barra de período + filtros enxuta

Toda tela de lista por período (Orçamentos, Ordens de Serviço, Contas a Receber, Contas a Pagar,
Notas fiscais, Medições, Perdas, Faturamento de contratos) usa a mesma barra, numa linha só:

```
Vencimento                     Pesquisar no período selecionado
[‹ | Novembro de 2026 ⌄ | ›]   [Pesquisar]   [Mais filtros ⌄] [extras]
Limpar filtros
```

| Peça | Componente | O que faz |
|---|---|---|
| Período | `BarraPeriodo` (`components/listagem/periodo-cards.tsx`) | menu com Hoje · Esta semana · Este mês · Este ano · Últimos 30 dias · Últimos 12 meses · Todo o período · Período personalizado; as setas andam uma unidade do atalho; só mês (competência) com `somenteMes`; "Todo o período" com `permitirTodos` |
| Regras do período | `lib/periodo.ts` | lê a URL (`mes`, `de`/`ate`, `periodo`, `ref`), dá `gte`/`lt` (instantes de Brasília) e `dias` (dia civil); `urlDoAtalho`, `urlVizinho`; padrão por tela (`padrao: "mes" | "todos"`) |
| Barra | `BarraFiltros` (`components/listagem/barra-filtros.tsx`) | período + busca (rótulo "Pesquisar no período selecionado") + "Mais filtros" (menu com os NOMES dos filtros; escolher um faz o campo aparecer, com ×; os que têm valor na URL aparecem sozinhos; contador dos ativos) + "Limpar filtros" na linha de baixo (zera os filtros e a busca; o período fica) + extras à direita |
| Filtro | `FiltroDef` (`id`, `label`, `params`, `render`, `largo`), controles com `inputFiltro(ativo)`, `FiltroSelectUrl`/`SelectFiltro` com `className="w-full"`, `FiltroTextoUrl` (texto/número com atraso) | cada mudança vai na hora para a URL; o controle ativo se destaca |

Regras:
- A URL é a fonte da verdade (compartilhável; o "voltar" funciona). O mês corrente não vai para a URL.
- Os cards de resumo ficam abaixo da barra e continuam clicáveis como filtro.
- Sem botão "Aplicar": escolher já filtra. Campos de texto esperam a pessoa parar de digitar.
- No celular tudo empilha (período na largura toda, busca, botões); a lista vira cartões como antes.
- Atalhos de teclado onde existiam (OS): ← › período anterior/seguinte, T = hoje.

## Padrão das telas de lista: a tabela profissional (`TabelaPro`)

Toda tabela de lista no desktop (Orçamentos, OS, Contas a Receber, Contas a Pagar, Notas fiscais,
Medições e os cadastros do `CadastroPadrao`) é UM componente: `components/listagem/tabela-pro`.
No celular a tabela não existe: a tela passa os seus cartões em `cartoes`.

```
[contador / totais da tela]                               [⚙ Colunas ⌄]
┌ CÓDIGO ┃ NOME                 ┃ CLIENTE      ┃ VALOR (R$) ┃   ┐   ← cabeçalho 10px maiúsculo; a borda ┃ arrasta
│ C-0101   Manutenção preventiva   Hospital X        5.880,00   ⋮ │   ← 13px em tudo; R$ à direita, tabular, sem "R$"
```

| Regra | Como |
|---|---|
| Uma fonte, um tamanho | `PLANILHA.tabela` (13px) em tudo; o nome principal é só `PLANILHA.nome` (peso), nunca maior. Código/número é `PLANILHA.codigo` (mono 12px) em todas as telas. |
| Alinhamento | Texto à esquerda; R$ e números à direita com `tabular-nums` (`alinhar: "direita"`); o "R$" fica no cabeçalho ("Valor (R$)"). |
| Colunas declaradas | `ColunaPro { id, titulo, alinhar, largura, minimo, obrigatoria, oculta, fixa, ordenar, classe }`. Uma coluna SEM `largura` é a elástica (ocupa o que sobra): toda tela tem uma. |
| Redimensionar | A borda direita de cada cabeçalho arrasta (ponteiro); respeita `minimo` (48px); duplo clique volta ao padrão. Colunas `fixa` (checkbox, ações) não mexem. |
| Menu "Colunas" | Mostrar/esconder (as `obrigatoria` ficam travadas; as `fixa` nem aparecem) e "Restaurar padrão". |
| Preferência por usuário | Larguras e colunas vão para `preferencias_usuario` pela rota `/api/preferencias/tabela:<tela>` (só a do próprio usuário da sessão) e seguem a pessoa entre dispositivos. O `localStorage` responde na hora e fica de reserva se a API falhar; a do servidor vence. |
| Ordenação | `ordenacao={{ ativa, dir, onOrdenar }}` ou `TabelaProUrl` (lê `?ordem=&dir=`). O cabeçalho vira botão com `aria-sort`. |
| Células | Chegam prontas (`ReactNode`): a página do servidor monta links e pílulas como sempre; o componente cuida de largura, visibilidade e estilo. |
