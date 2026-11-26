# Acabamentos do go-live (leva 3)

Seis itens, um PR, commits por área. Sem banco e sem SQL. Nenhum arquivo do checklist de veículo, do app do
técnico ou da Frota foi alterado (o sino só **usa** o escopo do técnico, `lib/tecnico/escopo`, sem mudá-lo).

## a) Orçamentos: um termo só — "Vencido"

Antes: a lista e a tela diziam "Expirado"; o card, "Vencidos"; a página do cliente, "Orçamento expirado"; o
lembrete por e-mail, "vence em X dias… antes que expire"; o e-mail seguinte, "expirou".

**Escolha: "Vencido".** É o par natural do campo que o cliente vê ("Validade" / "Válido até"), é o termo do
comércio no Brasil ("validade vencida") e o lembrete já falava em "vence". "Expirado" soa a termo técnico.
A chave interna `EXPIRADO` continua (é derivada da data; não vai ao banco).

Mudou: selo e marco do ciclo, página pública, erro da aprovação/recusa pelo link, e-mails padrão (lembrete e
"venceu"), descrição do lembrete em Configurações › E-mail. Admissão, PMOC e boleto têm vocabulário próprio e
ficaram como estão. Quem já personalizou o texto dos e-mails mantém o dele.

## b) Clientes › Satisfação

A coluna passa a mostrar a **média das notas do aceite das OS** do cliente (`aceite.avaliacao`, só aceites
confirmados), com a quantidade: "★ 4,8 (4)". Na ficha, aba Relacionamento: "4,8 de 5 · 4 avaliações no
aceite das OS". O campo de estrelas digitado à mão sumiu da tela; o valor continua no banco, e a API passou a
só gravar o campo se ele vier explícito (antes, salvar sem ele apagaria). A coluna continua fora do padrão e
deixou de ser ordenável (é calculada).

## c) Sino

1. **RBAC + escopo.** No modo técnico, a API `/api/alertas` devolvia contagens da empresa inteira para quem
   tinha "OS › Visualizar" (o preset Técnico tem): OS atrasadas de outros técnicos, chamados do portal,
   prazos, veículos. Agora a regra é pura (`lib/alertas/sino.ts › escopoDoSino`): o técnico recebe só os
   aceites das OS em que tem atividade e a NF dos pedidos que ele mesmo fez.
2. **Nota baixa do aceite** (1 ou 2 estrelas — não havia configuração na empresa para isso, então é uma
   constante, `NOTA_BAIXA_ACEITE`): aviso próprio "Avaliações baixas do cliente", com o link para a OS, só
   para o escritório. Sai do sino quando alguém do escritório abre a OS (o mesmo "visto" do aceite). Cada
   confirmação conta num aviso só: com ressalva › nota baixa › confirmada.

## d) PMOC: Renovar exige `pmoc.criar`

Renovar cria um plano novo, mas a rota pedia `pmoc.editar` e o botão também — quem só editava criava planos
por ali. Agora o botão, a prévia (GET) e a renovação (POST) exigem `pmoc.criar`, como "Novo PMOC" e "Criar
cópia". A frase "Use Renovar…" do aviso de vencimento também só aparece para quem cria.

## e) Módulo fantasma "licitacoes"

Levantamento: existia **só** em `lib/permissoes.ts` — no cadastro de perfis (com as ações Visualizar e
Gerenciar), no mapa do portão de rotas e ligado no preset Financeiro. Nenhuma tela, rota de API, item de menu,
tabela ou SQL. Removido do código. **Dados:** a chave continua nos perfis já gravados (`perfis_acesso.permissoes`,
JSON) — nada foi apagado. Para que essa chave invisível não trave quem edita um perfil ("não é possível
conceder acessos além dos seus"), a conta de excedentes passou a ignorar módulos que não existem mais
(`MODULOS_REMOVIDOS` registra o porquê).

## f) Trilha do topo

Cliente, OS e orçamento mostram o nome do registro ("Clientes › Clínica Vida Plena", "Ordens de serviço ›
OS-2024-0001", "Orçamentos › ORC-…") em vez de "Detalhes". A página de detalhe já carregou o registro e
informa o nome (`<NomeNaTrilha>`): sem consulta nova e sem permissão nova. O nome é guardado só no navegador
(nunca no servidor, onde seria compartilhado entre requisições e empresas). As outras telas continuam com
"Detalhes".
