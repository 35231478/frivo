# Tema 3 — listas: inativos nos seletores de equipe e de veículo; busca em veículos

**Sem mudança de banco.**

## Levantamento — o que já existia

Quase tudo já estava feito. Seletor = onde se ESCOLHE/vincula; todos já escondiam inativos e mantinham
o que já estava vinculado (para não apagar o vínculo ao reabrir um cadastro).

| Onde | Escolhe | Situação antes |
|---|---|---|
| OS: nova OS, nova/editar atividade, agendar pelo calendário, gerar OS do orçamento | equipe | Só ATIVAS (`/api/equipes?resumo=1`) |
| Os mesmos | veículo | Só ATIVOS + o já escolhido |
| Cadastro do colaborador › veículo padrão | veículo | Só ATIVOS + o já escolhido |
| Cadastro da equipe › veículos | veículos | Sem INATIVOS + os já vinculados |
| Cadastro do veículo › equipe vinculada | equipe | Só ATIVAS + a já vinculada |
| Checklist do veículo | veículo | Sem INATIVOS |
| Montador de equipes | equipe/veículo | Só ativas; o servidor recusa inativa |
| Lista de colaboradores › filtro de equipe | equipe | Só ATIVAS |
| **Lista de veículos** (`/veiculos`) | — | **Já tinha busca** (placa, modelo, marca, RENAVAM, chassi, responsável, equipe) |

## O que foi criado / corrigido

1. **Equipe inativada não some calada.** Ao editar uma atividade cuja equipe foi inativada depois, o
   seletor ficava como "sem equipe" (ela não está entre as opções), embora o vínculo continuasse.
   Agora mostra **"Equipe inativada (mantida nesta atividade)"**; ela não volta como opção.
2. **"Em manutenção" não é "inativo".** O veículo já escolhido que estava em manutenção saía
   rotulado "(inativo)". Agora "(em manutenção)" — na OS e no cadastro do colaborador.
3. **Busca nos veículos da equipe.** A lista de marcar veículos no cadastro da equipe ganhou pesquisa
   por placa ou modelo (aparece com mais de 6 veículos), com a contagem dos marcados sempre à vista.

## Perguntas para o Zé (não mexi — decisão de produto)

- **"Busca na lista de veículos":** a lista principal já tinha. Interpretei como a lista de veículos
  dentro do cadastro da equipe, que não tinha. Era essa? (Os outros são caixas de seleção simples.)
- **Veículo em manutenção** some dos seletores de OS/colaborador (só ATIVO aparece), mas aparece no
  cadastro da equipe e no checklist. É a regra atual; mantive. Confirmar se é a desejada.
- **O servidor aceita veículo inativo se vier escolhido à força** (as telas escondem, a API não
  recusa): atividade da OS, checklist, veículo padrão do colaborador, veículos da equipe. Quer que a
  API também recuse? Não fiz por mexer em regra de gravação de várias telas.
- **Sugestões da busca de equipes** mostram equipes inativas (etiquetadas "inativa"), e o cartão da
  equipe mostra placas de veículos inativos. São listas/consulta, não seletores — mantive.

## Testes

`tema3-listas-ui` (13 casos): as consultas do servidor; rótulo por status; sugestão automática nunca
propõe inativo/manutenção; busca por placa/modelo; seletor da OS (veículos ativos, já escolhido com o
motivo, equipe ativa, equipe inativada avisada); cadastro da equipe (inativo fora, já vinculado
mantido, sem busca em frota pequena, busca filtrando sem desmarcar).

## Prints

`docs/prints/tema3-listas/` — desktop e celular: cadastro da equipe com a busca; edição de atividade
com a equipe inativada e o veículo em manutenção.
