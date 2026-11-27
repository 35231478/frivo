# Painel de pendências (`/pendencias`)

O que precisa de ação hoje, por área, com um toque para resolver. Fica no menu Início, abaixo de Dashboard, e no topo do sino ("Ver pendências de hoje").

## O que aparece

| Área | Item | Ao tocar | Entra no número do sino |
| --- | --- | --- | --- |
| Operação | OS sem técnico | a OS, quando é uma só; senão, `/ordens?tecnico=sem` | sim |
| Operação | OS atrasadas | `/ordens?prazo=atrasadas` | sim (já entrava) |
| Operação | Atividades esquecidas em andamento | a OS da mais antiga | sim (já entrava) |
| Operação | Comentários novos do campo | a OS, nos comentários | sim (já entrava) |
| Operação | PMOC perto de expirar | `/pmoc?status=VENCENDO` | sim (já entrava) |
| Comercial | Orçamentos vencendo | o orçamento, quando é um só; senão, `/orcamentos?validade=vencendo` | sim |
| Financeiro | Despesas de campo a aprovar | `/financeiro/despesas-campo` | sim (já entrava) |
| Financeiro | Contas a pagar vencendo hoje | Contas a pagar, cartão "Vence hoje", período "Hoje" | **não** |
| Financeiro | Contas a receber vencendo hoje | Contas a receber, cartão "Vence hoje", período "Hoje" | **não** |
| Estoque | Saldo negativo por uso em campo | `/estoque?situacao=negativo` | sim (já entrava) |

- O item com zero não aparece, e a área sem item também não. Sem nada pendente, a tela diz "Nenhuma pendência hoje".
- As contas do dia ficam só no painel: são rotina de todo dia e inflariam o número do sino.

## Uma contagem e uma regra só

- **Contagem:** `contarSino` (`lib/alertas/sino-server.ts`) é a mesma para o sino (`/api/alertas`) e para o painel. A rota do sino só monta o escopo e faz o que é dela depois de responder (NFS-e, PMOC, push).
- **Quem vê:** o escopo do sino (`lib/alertas/sino.ts › escopoDoSino`), com a permissão da tela que o toque abre. No modo técnico, nada aparece. O sino confere de novo na tela pela mesma regra.
- **Rótulo e destino:** o catálogo `lib/alertas/pendencias.ts`. O sino lê dele o rótulo, o ícone e o destino dos itens que mostra também, então não há dois textos nem dois links da mesma coisa.
- **Módulo desligado:** o que é de Orçamentos ou Financeiro some com o módulo, como some do menu.

### As regras novas

| Regra | Onde | O que conta |
| --- | --- | --- |
| OS sem técnico | `lib/os/sem-tecnico.ts` | OS em aberto com atividade em aberto (agendada ou em andamento) sem técnico, ou ainda sem nenhuma atividade (a cancelada não conta). A OS com todas as atividades concluídas não entra: espera o fechamento. |
| Orçamento vencendo | `lib/orcamentos/ciclo.ts › whereOrcamentoVencendo` | Enviado, sem resposta, com a validade de hoje até o prazo do aviso "vence em X dias" da empresa (configuração dos lembretes de e-mail; sem ela, 3 dias). Dia civil de Brasília. |
| Contas do dia | `lib/listas/filtros.ts` (já existia) | A regra do cartão "Vence hoje" das listas, com a mesma URL. |

**O número bate com a lista que o toque abre.** O painel conta com a mesma função da lista e a mesma URL. Os filtros novos também valem na lista:
- **OS:** "Mais filtros › Atribuição › Sem técnico".
- **Orçamentos:** a pílula "Vencem em até N dias", que tira o filtro.
- **Ação em massa:** "selecionar todos do filtro" usa o mesmo prazo.

## Testes

| Arquivo | O que prova |
| --- | --- |
| `pendencias-regras` | quem vê cada grupo, o catálogo (ordem, zero some, destino do toque), as regras como `where` |
| `pendencias-pg` | cada contagem no PostgreSQL, a virada do dia civil, painel igual à lista, permissão, módulo, técnico, empresa, o número do sino sem as contas e a tela |
| `pendencias-ui` | o sino (link, itens novos, contas fora, segunda trava, resposta parcial), o filtro da lista de OS e a pílula de orçamentos |
