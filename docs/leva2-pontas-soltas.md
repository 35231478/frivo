# Leva 2 — pontas soltas do dia a dia

Seis itens, um PR. Sem banco. Nenhum arquivo de orçamento tocado.

## 1. Central da OS quebrava entre 1200 e 1366 px

**Causa.** O painel de Atividades ia para o lado a partir de `xl` (1280 px de **tela**). Mas a tela inclui
o menu lateral (280 px) e o espaçamento: em 1280–1366 sobravam 548–634 px para as abas, e os cartões do
Resumo continuavam em pares (`md:`, também pela tela). Resultado: lápis sobre o endereço, nome e data
quebrados, aba "Relatórios" escondida, título do painel quebrando.

**Decisão.** O layout decide pela largura **disponível**, com *container queries* (`app/globals.css`):

| Classe | Regra |
| --- | --- |
| `.os-central` / `.os-colunas` | painel ao lado só com **68rem (1088 px)** disponíveis — sobram ≥ 704 px para as abas; abaixo disso, empilha (abas e, embaixo, o painel) |
| `.os-abas` / `.os-pares` | os pares de cartões do Resumo só ficam lado a lado com **40rem (640 px)** na coluna das abas |

Com o menu aberto: 1024, 1200, 1280 e 1366 empilham (abas em largura total, pares lado a lado); 1440 fica
lado a lado (abas com 708 px). Com o menu recolhido, o painel vai para o lado antes — porque há espaço.
Também: título do painel em duas linhas ("Atividades" / "1 de 4 concluídas") e o nome da empresa na trilha
do topo sem quebrar.

## 2. Estoque: "OK" com saldo 0

`situacaoEstoque` só olhava "negativo" e "≤ mínimo"; saldo 0 **sem mínimo cadastrado** caía em "OK".
Agora são quatro situações exclusivas, da mais grave para a mais branda:
**Saldo negativo › Sem estoque › Abaixo do mínimo › Em estoque**. Filtro e aviso do topo por situação
("2 produtos sem estoque · 1 produto abaixo do mínimo"), cada frase leva ao filtro dela.

## 3. Clientes: Segmento e Satisfação vazias

- **Segmento** saiu do formulário do cliente de propósito (comentário no código: "não são mais editáveis");
  hoje só entra pela importação de planilha.
- **Satisfação** é um campo de estrelas digitado à mão na aba Relacionamento — **não** é a nota que o cliente
  dá no aceite da OS (`aceite.avaliacao`, base do Desempenho).

As duas saem do padrão da lista (continuam em "Colunas"). Quem já tinha escolhido as colunas mantém a escolha.
Próximo passo possível (não feito aqui): mostrar na coluna a média das avaliações do aceite.

## 4. Ficha do cliente em consulta

Nova rota `/clientes/[id]`: o cadastro como texto (só o que está preenchido), endereços e contatos em lista,
mesmas abas; **Editar** é ação do cabeçalho e abre na mesma aba. Para lá levam a lista (linha e nome), a
busca global e o link de "Leads do site" (que caía em 404). O lápis da linha continua indo direto para a
edição. Salvar ou cancelar a edição volta para a ficha. Cliente recém-criado continua na edição (para
cadastrar endereços e contatos).

## 5. Histórico da OS

`lib/os/historico.ts` resume o registro para o gestor, sem apagar nada:
- agrupa eventos seguidos da mesma família, mesma pessoa, sem pausa de mais de 1 hora ("5 fotos adicionadas",
  "3 itens executados", "Atividade “X” editada · data agendada, técnico");
- o "Status automático" até 2 minutos depois de um evento vira consequência dele ("Atividade iniciada · OS em
  execução");
- traduz os códigos (`AGENDADA → EM_ANDAMENTO (app do técnico)` → "Atividade iniciada").

Auditoria: cada linha agrupada abre os registros dela ("Ver os 5 registros"), e o modo **Registro completo**
mostra cada evento como foi gravado.

## 6. Gráfico do Dashboard financeiro

O gráfico tinha **dois eixos** (a linha do saldo acumulado com escala própria, centrada no meio), sem valores
no eixo, mês sem ano, valor só no `title` (no celular, nunca) e cores de status (verde/vermelho) para
categorias. Agora: um eixo a partir do zero com marcas redondas ("R$ 20 mil"), legenda, resultado de cada mês
embaixo ("+R$ 17 mil"; no celular "+17 mil") e o do período no cabeçalho, detalhe do mês por toque/mouse/
teclado dentro do cartão, e "Ver em tabela". Cores de série validadas (luminosidade, croma, daltonismo,
contraste): `#0E7FA0` (petróleo da marca) e `#C2410C`, em `lib/ui/tokens.ts › serieGrafico`.
