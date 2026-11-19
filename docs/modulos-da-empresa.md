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
- `dependeDe` → Compras depende de Estoque, NFS-e e Custo de pessoal dependem do Financeiro;
- `gateAtivo` → **a migração é módulo a módulo**. Só o módulo marcado assim tem o gate valendo nas
  três camadas. Os outros 24 estão catalogados e seguem exatamente como sempre foram.

Na fase 1, `gateAtivo` existe só em **Frota** e **Compras** (o piloto).

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

O 403 é para o **pedido direto** a um módulo desligado; o `if (tem(modulo))` é para o núcleo que
passa por ali. São as duas faces da mesma regra.

## Rotinas automáticas

`empresasComModulo(ids, modulo)` é o filtro dos crons: a rotina pula a empresa que desligou o
módulo e volta a rodar do ponto em que está quando religar — **sem gerar retroativo** do que não
aconteceu. Aplicado na rotina de faturamento de contratos (Financeiro).

## Onde se liga e desliga

**Configurações › Conta › Módulos**, atrás de "Configurações › Gerenciar" (a mesma permissão de
quem mexe em perfis de acesso — ligar módulo é configurar a empresa, não é permissão nova).

Nesta fase a tela oferece **só os dois do piloto**, de propósito: oferecer um interruptor antes de
o gate valer nas três camadas seria apagar a luz de um cômodo e deixar a do outro acesa. A loja
completa (todos os módulos, por categoria, com cartões) vem no PR seguinte.

Desligar pergunta antes e diz o que mais cai junto (dependência). Ligar não pergunta nada, mas é
recusado quando falta uma dependência, dizendo qual. Quem ligou/desligou e quando ficam na própria
linha da tabela e aparecem na tela.

## Banco

`empresa_modulos` (`empresa_id`, `modulo` TEXT, `ativo`, `alterado_por_id`, `alterado_em`), única
em `(empresa_id, modulo)`. `modulo` é texto, não enum: a validação mora no catálogo em código, e
módulo novo não exige mexer no banco. SQL aditivo e idempotente em
`prisma/sql/2027-01-18_empresa_modulos.sql`.

## O que ficou de fora (de propósito)

- os outros 24 módulos do catálogo: entram em levas, um a um, cada um com os seus testes;
- a loja completa (cartões, categorias, busca);
- `licitacoes` (rota fantasma) e `empresas.plano` (letra morta) — ficam para depois;
- middleware: continua sem ler banco.
