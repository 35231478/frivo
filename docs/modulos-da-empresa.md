# Módulos da empresa (a "Loja de Módulos") — fase 1

O que a **empresa** usa do Frivo. É uma terceira camada de acesso, **acima** do perfil de acesso
do usuário:

| Pergunta | Quem responde | Onde mora |
| --- | --- | --- |
| A **empresa** tem este módulo? | entitlement | `empresa_modulos` + `lib/modulos/*` |
| O **usuário** pode esta ação? | RBAC (perfil de acesso) | `lib/permissoes.ts` + `usuarios`/`perfis` |

As duas somam, e nenhuma substitui a outra: o gestor com todas as permissões **não** vê a Frota se
a empresa desligou a Frota; e ligar um módulo não dá permissão nenhuma a quem o perfil não dá.

Esta fase é só **organização** — simplificar a tela de quem não usa um pedaço do sistema. Não há
cobrança, plano nem preço aqui (isso vem muito depois, com o checkout). A coluna `empresas.plano`
continua sendo letra morta e não foi tocada.

## As três regras que sustentam tudo

1. **Ausência de linha = módulo ligado.** A tabela nasce vazia e continua vazia para quem nunca
   desligar nada; por isso o recurso entra sem mudar nada para ninguém. Não há backfill nem seed.
2. **O núcleo não desliga.** `clientes`, `ordens`, `calendario`, `equipes`, `relatorio-os`,
   `configuracoes` e `dashboard` respondem "tem" sempre — nem com linha gravada na mão no banco.
3. **Desligar nunca apaga.** Os veículos, os checklists e os pedidos de compra ficam onde estão;
   o módulo desligado impede **criar coisa nova**. Religar restaura tudo como estava.

## O catálogo é a espinha dorsal

`lib/modulos/catalogo.ts` é um registro único, puro (sem banco), onde cada módulo declara:

```ts
{ id, nome, descricao, icone, categoria, nucleo?, rotas?, permissoes?, dependeDe?, gateAtivo? }
```

- `rotas` → o que o **menu** e o **portão de rota** usam (prefixo mais longo ganha, e é por isso que
  `/configuracoes/checklists-veiculo` pertence à Frota sem arrastar o resto das Configurações);
- `permissoes` → a ponte com o RBAC: é assim que `exigirPermissao("veiculos", …)` sabe que aquela
  rota de API pertence à Frota;
- `dependeDe` → Compras depende de Estoque, QR Codes e PMOC dependem de Equipamentos, NFS-e e
  Custo de pessoal dependem do Financeiro;
- `gateAtivo` → **a migração é módulo a módulo**. Só o módulo marcado assim tem o gate valendo nas
  três camadas. Os outros 24 estão catalogados e seguem exatamente como sempre foram.

Hoje `gateAtivo` existe em **Frota**, **Compras**, **Estoque**, **Equipamentos** e **QR Codes**.

## Como o gate age, camada por camada

| Camada | Onde | O que acontece com o módulo desligado |
| --- | --- | --- |
| Menu | `components/layout/sidebar.tsx` (`podeVer`) | o item some, inclusive para o administrador master |
| Rota | `lib/modulos/pagina.ts` (`exigirModuloNaPagina`) | redireciona para `/sem-permissao?modulo=…`, que explica que **a empresa desligou** (não é falta de permissão) |
| API | `lib/permissoes-server.ts` (`exigirPermissao`, `exigirAlgumaPermissao`, `exigirModuloNaApi`) | 403 com `{ erro, modulo }` |

A verdade é o **banco**, não o token: as permissões ficam congeladas no JWT do login, mas o módulo
é lido no `layout` do painel (que já é Server Component e já consulta o banco) e passado ao menu por
prop. Desligar vale em segundos, para todo mundo, sem ninguém sair e entrar de novo. O middleware
(Edge, sem banco) não foi tocado.

## O padrão dos campos-ponte (vale em cada leva daqui em diante)

Uma tela do **núcleo** costuma mostrar um campo que pertence a um módulo **opcional**. Com o
módulo desligado, esse campo **some** — em vez de ficar vazio e órfão, oferecendo um cadastro que
aquela empresa não tem. Quem decide é o mesmo provider do menu (`useModulos().tem(...)`).

| Tela (núcleo) | Campo-ponte | Módulo |
| --- | --- | --- |
| Formulário de equipe | "Veículos da equipe" | Frota |
| Ficha do colaborador | "Veículo padrão" | Frota |
| Execução da OS | seletor de veículo | Frota |
| OS › Materiais | separar, reservar, devolver, "Separado X de Y" | Estoque |
| OS / orçamento › Compras | botão "Solicitar compra de material" | Compras |
| Sino (alertas) | filas "a separar"/"a devolver" e avisos de veículo | Estoque / Frota |
| Nova OS | seção "Equipamentos atendidos" e o seletor do chamado | Equipamentos |
| OS › atividade | "Adicionar" e a lista da unidade | Equipamentos |
| Execução da OS e app do técnico | "Escolher da lista" / "Da lista", cadastro em campo | Equipamentos |
| Proposta de contrato | "Equipamentos cobertos" | Equipamentos |
| Dashboard | blocos Equipamentos e Frota | Equipamentos / Frota |
| Execução da OS e app do técnico | "Ler QR Code" | QR Codes |
| Ficha e lista de equipamento | "Gerar QR", "Etiqueta QR", aba QR Code, filtro e atalho "Sem QR" | QR Codes |
| Ações em massa | "Gerar QR" e "Imprimir etiquetas" | QR Codes |
| Dashboard › Equipamentos | KPI "Sem QR Code" | QR Codes |

**A distinção fina, que é o coração da leva do Estoque:** com o Estoque desligado some a **ponte
com o razão** (separação, reserva, devolução, extrato) — mas o **material consumido continua na
OS**, com quantidade, valor e quem informou. O custo do material é da **OS**, não do módulo
Estoque; confundir os dois apagaria da OS uma informação que é dela. O campo "Separado X de Y"
vira "Previsto X", e o consumo já vem preenchido com o previsto do item (não há separação de onde
herdar).

O que **fica** em todos os casos: o dado já gravado. O veículo que a equipe tinha, o pedido de
compra que já existe, o material já consumido. Desligar não apaga; religar devolve a tela.

## Degradação graciosa — a regra mais importante

Onde o **núcleo encosta num módulo opcional**, módulo desligado nunca é erro nem 403:

- `lib/estoque/servidor.ts` › `movimentar`: sem o módulo Estoque, não lança nada e devolve
  `movimentacao: null`. Informar o consumo de material e **concluir a OS** continuam funcionando
  (até com a amarra "exigir prestação de material" ligada); o consumo fica registrado na OS e o
  razão do estoque simplesmente não existe para aquela empresa.
- `app/api/veiculos` (GET): com a Frota desligada devolve **lista vazia**, não 403 — quem chama é o
  formulário da OS, do colaborador e da equipe, que são do núcleo. Tudo o que **escreve** veículo
  passa por `exigirPermissao("veiculos", …)` e é recusado.
- `app/api/pedidos-compra` (leitura): o pedido antigo continua aparecendo na OS depois de Compras
  ser desligado. Só **criar, editar, cancelar e enviar** são recusados.
- `lib/compras/notas.ts › lancarNota`: a NF de compra é um documento de **compra e de dinheiro**.
  Com o Estoque desligado ela **ainda vira conta a pagar** e não mexe no razão — e avisa isso em
  texto. Recusar faria a dívida com o fornecedor sumir por causa de um módulo opcional.
- `app/api/alertas` (o sino, que é do núcleo): não dá 403 — só para de contar o que é de módulo
  desligado, e responde com todo o resto. (Equipamentos e QR Codes não contam nada no sino: não há
  o que calar.)
- `app/api/equipamentos` (GET): com Equipamentos desligado devolve **lista vazia**, não 403 — quem
  chama é a OS e o orçamento, que são do núcleo. Tudo o que escreve equipamento é recusado.
- **Concluir a atividade da OS**: a exigência de "1 equipamento atendido" ganhou a saída `MODULO`
  (`lib/execucao/pendencias.ts`). Com Equipamentos desligado não há o que vincular, e concluir a OS
  é do núcleo: a trava sairia sem saída nenhuma. O vínculo OS↔equipamento é N:N e opcional, então
  nada mais no caminho da conclusão depende do módulo.
- `lib/execucao/cadastro-campo.ts`: com QR Codes desligado o equipamento cadastrado em campo nasce
  **sem etiqueta** — e nasce assim mesmo. Recusar o cadastro inteiro por causa de um módulo opcional
  perderia o equipamento que o técnico tem na frente. Com Equipamentos desligado o app nem oferece
  o cadastro (o retrato vem sem ele).
- `app/api/equipamentos` (POST com `gerarQrCode`): mesma regra — o equipamento é salvo, sem QR.

O 403 é para o **pedido direto** a um módulo desligado; o `if (tem(modulo))` é para o núcleo que
passa por ali. São as duas faces da mesma regra.

## Rotinas automáticas

`empresasComModulo(ids, modulo)` é o filtro dos crons: a rotina pula a empresa que desligou o
módulo e volta a rodar do ponto em que está quando religar — **sem gerar retroativo** do que não
aconteceu. Aplicado na rotina de faturamento de contratos (Financeiro).

## Onde se liga e desliga

**Configurações › Conta › Módulos**, atrás de "Configurações › Gerenciar" (a mesma permissão de
quem mexe em perfis de acesso — ligar módulo é configurar a empresa, não é permissão nova).

A tela oferece **só os módulos com `gateAtivo`**, de propósito: oferecer um interruptor antes de o
gate valer nas três camadas seria apagar a luz de um cômodo e deixar a do outro acesa. Hoje são
Frota, Compras, Estoque, Equipamentos e QR Codes. A loja completa (todos os módulos, por categoria,
com cartões) vem depois.

Com o Estoque na tela, a **cascata Compras→Estoque ficou alcançável pelo clique**: desligar o
Estoque pergunta antes e diz que Compras cai junto; ligar Compras sem Estoque é recusado dizendo
o que falta. A **cascata QR Codes→Equipamentos** funciona igual: o QR é do equipamento, então
desligar Equipamentos arrasta QR Codes na mesma transação (com o aviso antes), e ligar QR Codes com
Equipamentos desligado é recusado dizendo o que falta.

**A dependência PMOC → Equipamentos** está no catálogo, mas o PMOC ainda não tem gate — ele entra
numa leva futura. Por isso a cascata só **arrasta e anuncia** módulos com `gateAtivo`: dizer "o
PMOC vai junto" e o PMOC continuar inteiro no menu seria mentir para quem está desligando. A regra
já vale do outro lado: quando o PMOC for ligável, `dependenciasFaltando` recusa ligá-lo com
Equipamentos desligado.

**O link público do QR não é gateado.** `/qr/<token>` e `/api/qr/<token>/chamado` continuam
abrindo: a etiqueta já está colada no equipamento do cliente, e desligar não apaga o que existe. O
que o módulo desligado impede é a empresa **gerar, imprimir e ler** etiqueta nova. As duas rotas
ficam catalogadas em `rotas` (documentam a superfície do módulo), com o comentário dizendo por quê.

Desligar pergunta antes e diz o que mais cai junto (dependência). Ligar não pergunta nada, mas é
recusado quando falta uma dependência, dizendo qual. Quem ligou/desligou e quando ficam na própria
linha da tabela e aparecem na tela.

## Banco

`empresa_modulos` (`empresa_id`, `modulo` TEXT, `ativo`, `alterado_por_id`, `alterado_em`), única
em `(empresa_id, modulo)`. `modulo` é texto, não enum: a validação mora no catálogo em código, e
módulo novo não exige mexer no banco. SQL aditivo e idempotente em
`prisma/sql/2027-01-18_empresa_modulos.sql`.

## O que ficou de fora (de propósito)

- os outros 21 módulos do catálogo: entram em levas, um a um, cada um com os seus testes;
- o **PMOC**: a dependência está registrada, o gate não (leva futura);
- o **link público do QR**: fica aberto, como está dito acima;
- a loja completa (cartões, categorias, busca);
- `licitacoes` (rota fantasma) e `empresas.plano` (letra morta) — ficam para depois;
- middleware: continua sem ler banco.
