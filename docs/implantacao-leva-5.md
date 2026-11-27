# Implantação, leva 5: lote de importação e "Desfazer lote"

Cada importação por planilha vira um **lote**, listado na tela de Implantação. Quem errou a planilha consegue
**desfazer** o que ela criou, desde que ainda não tenha sido usado, sem mexer no que já está em uso e sem desfazer
o que a planilha só atualizou.

## Levantamento: o que existia × o que mudou

| Peça | Antes | Agora |
|---|---|---|
| Registro da importação | Nenhum: a planilha gravava direto nos cadastros | Um **lote** por importação confirmada, com quem, quando, arquivo, planilha e contagens (criados, atualizados, com erro, avisos). Cada registro criado ou atualizado fica no lote, com a linha da planilha |
| Tela de Implantação | Etapas e atalhos | + seção **Importações** (as 30 mais recentes), com a situação de cada lote: *Desfeita*, *Desfeita em parte*, *Só atualizou* |
| Desfazer | Não existia: era preciso apagar um por um pela tela | **Desfazer…** abre a **prévia** (o que será apagado, o que fica e por quê, o que só foi atualizado, o que já não existe) e só depois confirma |
| Importação em si | — | Não muda o que é gravado. Se o lote não puder ser registrado, os dados ficam gravados e o resultado avisa |

Não foram tocadas as telas de cadastro de clientes, OS e orçamentos.

**🔵 Banco: duas tabelas novas, só aditivas.** Estão em `prisma/sql/2027-01-30_importacao_lotes.sql`, que **não foi aplicado**.
São o tipo `AcaoLoteItem` e as tabelas `importacao_lotes` e `importacao_lote_itens`. Nenhum cadastro ganha coluna.
O SQL é idempotente (testado 3×) e não apaga nada.

Sem o SQL aplicado:
- a importação continua funcionando, e o resultado avisa que o lote não foi registrado;
- a tela de Implantação abre sem a lista.

## O que o lote guarda

- **Quem:** o usuário da sessão. Se o usuário for removido, o lote fica, como "usuário removido".
- **Quando** e o **arquivo** (nome, até 200 caracteres).
- **Planilha** e **contagens.**
- **Itens:** cada registro criado ou atualizado pelo lote, com a linha da planilha. Linha igual (nada mudou) não entra.
- **O que a importação cria junto também entra como criado:**
  - a **unidade Principal** de cada cliente novo;
  - os **tipos de equipamento personalizados** que a planilha de equipamentos precisou criar;
  - os **cargos** novos da planilha de colaboradores.
- A **prévia** da importação (antes de confirmar) não cria lote.

## As regras do desfazer

1. **Apaga só o que o lote CRIOU** e que não tem nenhum vínculo fora do que o próprio desfazer apaga junto.
   - O vínculo é qualquer coisa que aponte para o registro: OS, orçamento, contrato, PMOC, movimentação de estoque,
     QR Code, foto, interação, conta, nota etc.
   - A lista **é lida do schema**, então relação nova no futuro já conta sozinha.
   - **Vínculo que apagaria em cascata também segura.** Exemplo: a interação com um cliente apagaria junto com ele; por isso o cliente fica.
2. **Quem fica segura quem depende dele.**
   - Exemplos: a unidade com OS fica → o cliente dela fica; o equipamento com QR Code fica → o tipo personalizado dele fica.
   - O inverso também vale: o que sai junto não conta como uso (o cliente com a unidade Principal sai inteiro).
3. **A unidade Principal só sai com o cliente.** Ela é o endereço dele.
4. **Alterado depois da importação fica**, pela tela ou por outra planilha. O motivo é "alterado depois desta importação".
5. **O que o lote só ATUALIZOU nunca é desfeito.** Não há como "voltar o valor"; ele só é listado na prévia.
6. **Estoque não se desfaz por aqui.** O lote de estoque só atualiza produtos, e o extrato do estoque não se reescreve.
   A prévia explica: importe de novo com o saldo certo, e a planilha lança só a diferença.
7. **Permissão em duas camadas:**
   - ver e desfazer lotes pede **Configurações › Gerenciar** (a mesma da tela de Implantação);
   - cada registro ainda pede a permissão de excluir do cadastro dele, senão fica com o motivo "você não tem permissão para …";
   - **módulo desligado** (Equipamentos, Frota) também segura: "o módulo de … está desligado".
8. **Outra empresa** não vê nem desfaz (404).
9. **Seguro contra corrida, tudo ou nada.** O desfazer roda numa transação só:
   - **trava** as linhas que o lote criou (`FOR UPDATE`): enquanto isso, nada novo consegue se ligar a elas;
   - **reconfere** o "pode sair" ali dentro: o que passou a ser usado entre a prévia e o clique fica;
   - apaga **filhos antes dos pais**.
   - Se algo não bater, **nada é apagado** e a tela pede para tentar de novo.
10. **Pode ser repetido.** O que ficou por estar em uso sai depois, quando o uso sumir. A lista mostra *Desfeita em parte* e quantos já foram apagados.

| Cadastro | Permissão para o desfazer apagar |
|---|---|
| Clientes, unidades, contatos | Clientes › Excluir |
| Equipamentos | Equipamentos › Excluir (e o módulo ligado) |
| Veículos | Frota › Excluir (e o módulo ligado) |
| Colaboradores | Equipes › Excluir |
| Produtos, serviços, fornecedores | a mesma de **inativar** do cadastro (eles não têm "excluir") |
| Tipos de equipamento e cargos criados pela planilha | Configurações › Gerenciar |

## Decisões tomadas (para o Zé revisar)

- **Produtos, serviços e fornecedores** usam a permissão de *inativar* no desfazer, porque não têm "excluir".
  O desfazer só apaga o que a própria planilha criou e ninguém usou.
- **"Alterado depois" fica:** se alguém corrigiu o registro pela tela, apagar perderia esse trabalho.
  A tolerância é de 2 s entre a gravação e o registro do lote.
- **Estoque nunca é desfeito**, pela regra do extrato que não se reescreve. A correção é reimportar o saldo certo.
- **O desfazer não pede o motivo** nem grava um registro à parte. Fica no próprio lote quando foi desfeito, por quem e quantos registros apagou.

## Testes

- `tests/unit/implantacao-5.test.ts` (15) cobre:
  - as regras puras: situação do lote, contagens, ordem de apagar, ponto fixo, permissão e motivo;
  - todo cadastro de planilha tem regra de desfazer;
  - a tela: lista, prévia, confirmar, erro 409 e erro da prévia.
- `tests/unit/implantacao-5-pg.test.ts` (9) roda no **PostgreSQL real** e cobre:
  - o lote em cada importação (com a Principal, os tipos e os cargos);
  - o uso em cascata, o "alterado depois", a regra da Principal e o desfazer repetido;
  - o QR Code e os tipos; o colaborador responsável de veículo; o estoque;
  - as permissões, o módulo desligado e a outra empresa;
  - o uso que aparece entre a prévia e o clique;
  - o **tudo ou nada** (nada apagado e 409 pela rota);
  - o SQL rodado 3× e comparado com o schema do Prisma.
- **Mutação:** 57 mutantes, **57 mortos**. Cada um quebra uma regra (situação, ordem, ponto fixo, permissões, uso em cascata,
  "alterado depois", Principal, prévia, desfazer, gravação do lote, rotas e tela). A 1ª rodada deixou 3 vivos, que viraram testes:
  - o desfazer reconferindo com o módulo desligado;
  - o tipo de equipamento que já existia não entra no lote;
  - gravar sem arquivo não cria lote.
- **Navegador real** (Playwright, banco local de prints com o SQL aplicado só nele): 14 conferências ok.

## Prints

- `docs/prints/implantacao-5-antes/`: a Implantação sem a lista (desktop e celular).
- `docs/prints/implantacao-5-depois/`, com dados fictícios:
  - a lista com o lote;
  - a prévia com o que sai, o que fica (e por quê) e o que só foi atualizado;
  - a lista *Desfeita em parte*;
  - no celular, a lista e a prévia sem nada a apagar.
