# Pronto pra janeiro 4: varredura das entregas #285 a #294 no escritório

Antes de importar os dados reais da Termofrio, percorri tudo o que entrou de #285 a #294 como um cliente **novo**, de outra empresa, sem tutorial. Ficaram de fora: as telas de conversa (CHAT-1, outra nuvem) e o app do técnico (outra nuvem).

## Como foi feito

1. **Empresa demo do zero, pela tela.**
   - O super admin criou a "Polar Demo" (fictícia) em Admin › Empresas.
   - O e-mail de login repetido foi recusado com mensagem clara.
   - O 1º administrador entrou, foi obrigado a trocar a senha e chegou ao painel.
2. **Navegação real (Playwright)** nas telas das entregas, em **1366×768, 1920×1080 e celular (390×844)**. Em cada tela conferi:
   - tela de erro e resposta 5xx;
   - estouro de largura;
   - texto cortado;
   - desvio para login ou sem-permissão.

   A varredura "antes" rodou numa cópia **intocada do master** (as correções desta leva não interferem).
3. **Leitura do código por área**: colaborador, ficha do cliente, Leva I/I.2 e comissões. Em cada uma procurei:
   - criar, editar, excluir ou desfazer que falta;
   - botão morto e beco sem saída;
   - mensagem de erro;
   - permissão na tela **e** na API pela URL;
   - isolamento entre empresas;
   - empresa sem regra ou sem módulo.
4. **Comissões com os números à mão**: seis cenários e o fechamento, no PostgreSQL real, pelas mesmas rotas que as telas usam (veja abaixo).

**Resultado.**
- **Navegação:** NAVEGACAO_RESUMO.
- **Lógica:** as pontas soltas estavam **na lógica**, não na navegação. São 77 pontos na tabela; **51 corrigidos nesta leva**, cada um com teste. Os demais são decisão de produto (lista no fim), zona proibida ou baixo impacto.
- **Banco:** nenhum SQL.

Legenda da gravidade:
- **alta**: dinheiro errado, dado perdido ou travamento sem saída;
- **média**: atrapalha o uso ou mostra o que não devia;
- **baixa**: acabamento.

## Comissões (#282, #289, #290, #292, #294)

### Os números conferidos à mão

Seis cenários e o fechamento passam pelas rotas que alimentam **Minhas comissões** (`GET /api/perfil/comissoes`) e a **folha do fechamento**. O teste é `tests/unit/pj4-cenarios-comissoes-pg.test.ts`.

| # | Cenário | Conta à mão | Tela |
|---|---|---|---|
| C1 | Ana vende R$ 23.300 com R$ 2.300 de desconto nos serviços; liberada na aprovação. VRF: Todos + serviço 3%. Split: cargo + categoria 5%. Limpeza: o fixo da Ana, 7%. 3 filtros a R$ 10. | 540 + 90 + 63 + 30 = **723,00** | Liberada 723,00 ✔ |
| C2 | Bruno vende R$ 10.000 a 5%, por recebimento. Entram 4.000; o recebimento é estornado; depois entra tudo. | 200 liberada / 300 prevista → 0 / 500 → **500** | idem ✔ |
| C3 | Bruno vende R$ 8.000 (5% = 400); entram 4.000; a venda passa para a Carla. | Bruno 0 (a linha some); Carla **200 liberada + 200 prevista** | idem ✔ |
| C4 | Carla vende R$ 5.000 (250), liberada na aprovação; a fatura é cancelada e depois refaturada. | +250 → −250 ("Fatura cancelada") → +250 | idem ✔ |
| C5 | Dupla João + Maria numa OS de R$ 2.000 em 2 splits (10% igual), mais uma OS do João de R$ 1.000; teto do João R$ 150. | João 200 → folha **150** (50 vão para o mês seguinte); Maria **100** | idem ✔ |
| C6 | Contrato da Ana de R$ 1.500/mês (10% × 3 meses + R$ 200 no fechamento); a 1ª mensalidade entra em duas metades. | prevista 650 → 175 → **350 liberada**, 300 prevista | idem ✔ |
| — | Fechamento do mês | Ana 1.073 · Bruno 500 · Carla 450 · João 150 · Maria 100: **uma conta a pagar por pessoa**; o extrato passa a "Paga"; a outra empresa não vê nada | idem ✔ |

### Achados

| Tela / lugar | Problema | Gravidade | Corrigido? / decisão |
|---|---|---|---|
| Comissão do técnico (recálculo) | Desativar a regra, inativar o login do técnico ou mudar o cargo **estornava a comissão já liberada ou paga** ("relatório incompleto"); o técnico ficava com saldo negativo. | alta | **Corrigido.** A trava de qualidade agora é a da unidade (serviço feito e relatório completo) e da pessoa ainda estar na atividade. Tirar a pessoa da atividade continua estornando. |
| Fechamento (por recebimento) | Recebimentos de dois meses pegos num recálculo só iam **inteiros para a data do último**. O fechamento de outubro feito em 5/11 perdia a parte de outubro. | alta | **Corrigido.** Cada mês leva a parte do dinheiro que entrou nele (vendedor e técnico). |
| Contrato | Voltar de "Aguardando assinatura" para "Ativo" depois de já ter comissão **gerava de novo** o fixo e um ciclo novo (8 comissões em vez de 4). | alta | **Corrigido.** |
| Contrato (renovação com "enquanto ativo") | A mesma mensalidade era comissionada **duas vezes** (ciclo antigo e o da renovação). | alta | **Corrigido.** A janela antiga fecha onde começa a nova; o mês já liberado fica no ciclo antigo e os previstos passam ao novo (o antigo fica no histórico). |
| Contrato | Depois de liberar uma parte, um reajuste podia liberar **mais que o valor congelado**. | baixa | **Corrigido.** |
| Minhas comissões | Venda cancelada, OS cancelada e contrato cancelado ou encerrado **continuavam como Prevista**, e somavam no total. | média | **Corrigido.** |
| Minhas comissões / app | Os totais contavam só as 600 comissões mais recentes (técnico de PMOC passa disso em poucas OS). | média | **Corrigido.** Os totais contam todas. |
| Divisão entre técnicos | A parte arredondada a 4 casas perdia ou criava centavos (3 técnicos: 2.999,70 em vez de 3.000; 6 técnicos: 3.000,60). | média | **Corrigido.** Divisão pelo maior resto. |
| Configurações › Comissões | Editar uma regra **desativada a reativava** sozinha. | média | **Corrigido.** |
| Configurações › Comissões | "Instalação" e "Instalacao" eram aceitas como duas regras diferentes. | baixa | **Corrigido.** Mesma regra (409). |
| Comissão por recebimento | O denominador da fração difere da fatura: com ISS no orçamento e fatura pela OS sem ISS, ou com desconto, **nunca libera 100%**. | média | **Decisão 1.** |
| Reaprovar venda cancelada e editada | Fica valendo a comissão antiga (congelada). | média | **Decisão 2.** A correção simples descongelaria comissões. |
| Limite do mês | As comissões usam UTC; o Desempenho usa Brasília. A aprovação às 22h do dia 31 cai no mês seguinte. | média | **Decisão 3.** Não dá para só trocar o fuso: os recebimentos são gravados à meia-noite UTC do dia, e o recebimento do dia 1º iria para o mês anterior. |
| OS com equipamento vinculado depois | As unidades antigas ficam com a conta antiga de equipamentos; a soma passa de 100% da linha. | média | **Decisão 4.** |
| Contrato "enquanto ativo" | Desativar a regra não encerra as mensalidades futuras. | média | **Decisão 5.** |
| Relatório "por emissão" | Comissão do técnico estornada (qualidade ou revisão) entra pelo valor cheio. | baixa | Para a próxima leva de comissões. |
| Teto | O par −/+ do teto fica preso a uma comissão (a linha daquela venda mostra o ajuste). | baixa | Para a próxima leva (os totais estão certos). |
| Trocar vendedor do contrato | A rota pede só "Trocar vendedor" de Orçamentos, sem nenhuma permissão de Contratos. | baixa | **Zona proibida (RBAC).** Recomendo exigir também "Contratos › Visualizar". |

## Colaborador (#285)

| Tela / lugar | Problema | Gravidade | Corrigido? / decisão |
|---|---|---|---|
| Ficha do colaborador | Ficha antiga com os dias marcados e sem horário **não salvava mais nada** ("faixa 1: Informe a entrada e a saída"). | alta | **Corrigido.** Só os dias, sem horário, é "sem jornada". |
| Lista › Novo colaborador | O modal ainda tinha o "Função" de 5 opções: "Administrativo" virava **Campo** (aba Campo, mapa) e o próximo Salvar da ficha trocava o tipo sozinho. | alta | **Corrigido.** O servidor grava função e equipe sempre coerentes; o modal tem as mesmas duas chaves da ficha. |
| Link da admissão | Se o código de e-mail não sai (modelo inativo, provedor fora), o candidato **ficava preso para sempre** no fim. | alta | **Corrigido.** Sem código enviado, segue; a mensagem é amigável, não o erro cru. |
| Ficha | Responsável técnico podia ser salvo **sem CREA** pela ficha (o CREA vai no PMOC, na ART e no orçamento). | média | **Corrigido.** Recusa na ficha, no Novo e no servidor. |
| Link da admissão | E-mail não confirmado só aparecia no último passo, sem caminho de volta. | média | **Corrigido.** Volta para Dados com o aviso. |
| Link da admissão | O celular vindo do preenchimento automático ("+55 11 9…") era cortado e recusado. | média | **Corrigido.** |
| OS | As especialidades sumiam da tela ao mudar o status ou o técnico (até recarregar). | baixa | **Corrigido.** Seguem a configuração da empresa. |
| Cadastro | "Dados inválidos" genérico. | baixa | **Corrigido.** Mostra o que está errado. |
| Cadastro | Especialidades sem limite e repetidas ("VRF" e "vrf" no PDF). | baixa | **Corrigido.** Até 20, de até 60 letras, sem repetir. |
| Ficha | Esvaziar o e-mail de quem tem login deixava o login solto no e-mail antigo. | baixa | **Corrigido.** Recusa com a explicação. |
| Configurações › Impressão da OS | A leitura não devolvia "mostrar especialidades". | baixa | **Corrigido.** |
| Ficha | A dica de "Usa o app de campo" prometia custo-hora (que segue a função). | baixa | **Corrigido.** O texto foi acertado. |
| Código morto | `tecnico-form.tsx` (o formulário antigo) | baixa | **Removido.** |
| Admissão | O contrato pode ser assinado com `{{jornada}}` vazio. | média | **Decisão 6.** |
| Implantação (planilha) | Colunas `funcao` e `equipe` independentes podem gravar uma combinação incoerente; RT sem CREA; não há coluna de especialidades. | média | **Decisão 7.** Recomendo corrigir **antes da importação**. |
| Relatório interno da OS | Ignora "Ver só os próprios". | média | **Zona proibida (RBAC).** Recomendo aplicar o mesmo escopo da OS. |
| Documentos para o cliente | As especialidades só aparecem em 3 dos lugares (o relatório da atividade, a medição e a agenda do portal mostram só o nome). | baixa | **Decisão 8.** |
| Sair sem salvar na ficha | Chips de dia, faixas e chaves não armam o aviso. | baixa | Para a próxima leva de acabamento. |
| Admissão | E-mail obrigatório do candidato (ajudante sem e-mail). | média | **Decisão 9.** |
| Jornada | Turno noturno (22h–6h) e 12x36 não cabem nas faixas. | média | **Decisão 10.** |
| Jornada | Nenhum aviso acima de 44 h/semana ou 10 h/dia. | baixa | **Decisão 11.** |
| Ficha | Desligar "Usa o app de campo" escolhe um perfil de acesso sozinho. | baixa | **Zona proibida (RBAC).** |

## Ficha do cliente (#287)

| Tela / lugar | Problema | Gravidade | Corrigido? / decisão |
|---|---|---|---|
| Cadastro de cliente | O **mesmo CNPJ** importado com pontuação e digitado sem virava **dois clientes**; CNPJ/CPF com dígito errado passava. | alta | **Corrigido.** O repetido é achado pelos dígitos; documento novo ou trocado precisa ser válido. O que está gravado não muda. |
| Cabeçalho da ficha | "Inadimplente · R$ X" e "A receber em 30 dias · R$ X" apareciam para **quem não tem o financeiro** (e iam ao navegador). | média | **Corrigido.** Sem a permissão, nem o valor sai do servidor. |
| Histórico do cliente | Mostrava OS, orçamentos, contratos e documentação para **quem não vê esses módulos**. | média | **Corrigido.** Cada módulo só com a permissão dele. |
| Consultar CNPJ | Montava um **endereço misturado** (a rua digitada com o CEP e a cidade da Receita, que vão para a nota). | média | **Corrigido.** Tudo ou nada. |
| Consultar CNPJ (cliente existente) | Trocava o nome fantasia e o Simples sem avisar. | média | **Corrigido.** Só preenche o que está vazio. |
| Consultar CNPJ | Com a BrasilAPI fora do ar, dava erro sem tentar a reserva. | média | **Corrigido.** |
| Cliente novo | Podia ficar **sem local principal** (a planilha de equipamentos recusava depois). | média | **Corrigido.** |
| Histórico | Contrato importado aparecia como "suspenso", sem o motivo e com o status cru; fatura cancelada aparecia como "criada". | média | **Corrigido.** |
| Endereços do cliente novo | Excluir que não fazia nada; dois locais "Principal". | baixa | **Corrigido.** |
| Edição | "Cancelar" saía sem perguntar; "Salvar e continuar" perguntava depois de salvar. | baixa | **Corrigido.** |
| Histórico | Pedido "Resolvido por outro meio" aparecia como "conferido"; o pagamento do dia 1º caía no mês anterior. | baixa | **Corrigido.** |
| Cabeçalho | "N contratos ativos" levava a /sem-permissao (sem a permissão) e abria sem o filtro. | baixa | **Corrigido.** |
| Cadastro | "Exigir endereço" valia só na tela. | baixa | **Corrigido.** Vale no servidor. |
| Consultar CNPJ | Com menos de 14 dígitos, o botão não fazia nada. | baixa | **Corrigido.** |
| Endereços | "Tornar principal" que falhava não dizia nada; PJ → PF deixava o nome travado. | baixa | **Corrigido.** |
| Doc da Leva H | Falava de uma lupa que o CEP não tem mais. | baixa | **Corrigido.** |
| Endereço principal × local Principal | Corrigir um não muda o outro; a OS segue para o endereço antigo. | média | **Decisão 12.** |
| Histórico | Cortado nos 300 mais recentes, sem aviso. | baixa | **Decisão 13.** |
| Selo de satisfação ★ | Conta as OS de todos, mesmo para quem só vê as próprias. | baixa | **Decisão 14.** |
| Alerta de perdas, pedidos do cliente e lembretes | Continuam para quem só tem Clientes. | baixa | Para a próxima leva (mesmo padrão do item acima). |

## Leva I / I.2 (#286, #288)

| Tela / lugar | Problema | Gravidade | Corrigido? / decisão |
|---|---|---|---|
| Faturar pelo orçamento | Com a OS gerada, o material lançado em campo ("Cobrado à parte") **ficava fora da fatura sem aviso** e a conferência ficava pendente para sempre. | alta | **Corrigido.** A mesma trava da OS. |
| Exportar contas a receber, OS, folha/bônus, modelos e ação em massa | O CSV **não protegia contra fórmula** (`=HYPERLINK(...)` executava no Excel). | alta | **Corrigido.** Todas as exportações usam a mesma proteção. |
| Implantação | A planilha troca o e-mail de contato com portal e de colaborador com login **sem a checagem de e-mail único**. | alta | **Decisão 15.** O que precisa está descrito; recomendo antes da importação. |
| Material de campo › Confirmar | Aceitava qualquer preço, **sem a trava do preço de tabela**. | média | **Corrigido.** Pede a permissão e o motivo, com trilha. |
| Dados da empresa | CNPJ inválido passava; CNPJ de outra empresa dava erro 500. | média | **Corrigido.** "CNPJ inválido." / 409 com a mensagem. |
| Admin › Empresas › Histórico | Mostrava a trilha de preço do cliente ("PRECO_TABELA_FATURA", cru) ao dono do Frivo. | média | **Corrigido.** Fica fora do histórico do admin. |
| Sair sem salvar | "Cancelar"/"Voltar" do contrato saíam sem perguntar; os painéis que gravam sozinhos (locais, contatos, portal, anexos, acesso ao app, logo) **avisavam à toa**; envio recusado desligava o aviso; "Descartar" no perfil não limpava. | média | **Corrigido.** |
| Colunas da lista | A reserva no navegador era de todos os usuários do aparelho. | baixa | **Corrigido.** É por usuário. |
| Reajuste em massa | Sem aviso do que foi feito; a vírgula ("8,5") zerava o campo. | baixa | **Corrigido.** "8,5" e "−3,5" funcionam e o aviso aparece. |
| Material de campo | "Excluir da cobrança" sem perguntar. | baixa | **Corrigido.** |
| CEP | Fora do ar, o mesmo CEP nunca era consultado de novo; o cadastro rápido não dizia nada. | baixa | **Corrigido.** |
| /ordens | Com "Sem agendamento", a barra do período continuava ali, sem efeito. | baixa | **Corrigido.** Sai da tela. |
| Admin › Editar empresa | Sem os dados (leitura falhou), abria vazio com Salvar ligado. | baixa | **Corrigido.** |
| Gavetas de edição | Fecham no Esc/fundo sem perguntar (30 preços digitados se perdem). | média | **Decisão 16.** |
| Material de campo | Sem sino nem filtro "a conferir"; OS de contrato fatura pela medição e não pega o material. | média | **Decisão 17.** |
| Reajuste | O desfazer vai em cadeia (o lote anterior). | baixa | **Decisão 18.** |
| Admin › Nova senha do 1º admin | A confirmação não diz quem terá a senha trocada. | baixa | **Zona proibida (segurança de login).** Recomendo mostrar nome e e-mail. |

## Navegação (1366, 1920 e celular)

NAVEGACAO_TABELA

## Para o Zé decidir (com a minha recomendação)

1. **Comissão por recebimento × fatura diferente da venda (ISS, desconto, fatura pela OS).** Recomendo: a fração recebida usar como base o **total faturado da venda** quando ela estiver toda faturada. Assim, receber tudo libera 100%.
2. **Reaprovar a venda cancelada e editada.** Recomendo: ao **reativar** um orçamento cancelado para rascunho, marcar as comissões dele como substituídas. A nova aprovação gera com o valor e as regras do dia.
3. **Mês das comissões em Brasília.** Recomendo: uma leva própria que converta as datas que são dia civil (recebimento) e as que são instante (aprovação, conclusão) separadamente, com teste nas viradas de mês.
4. **Equipamento vinculado à OS depois de comissões já nascidas.** Recomendo: congelar a conta de vinculados na 1ª unidade, ou refazer só as que ainda estão previstas.
5. **Desativar a regra de contrato "enquanto ativo".** Recomendo: as mensalidades futuras param de ser criadas; as já criadas seguem.
6. **Contrato da admissão com `{{jornada}}` vazio.** Recomendo um aviso no painel do RH, sem bloquear.
7. **Planilha de colaboradores.** Recomendo, **antes da importação**: função e equipe juntas e coerentes, RT sem CREA recusado e uma coluna `especialidades` (separadas por ";").
8. **Especialidades em todos os documentos do cliente** (relatório da atividade, medição, agenda do portal). Recomendo que a configuração valha para todos.
9. **E-mail do candidato.** Recomendo "não tenho e-mail", com o RH confirmando.
10. **Turno noturno e 12x36.** Recomendo a faixa que passa da meia-noite (saída < entrada = dia seguinte) e uma opção "escala" em texto.
11. **Aviso da CLT.** Recomendo um aviso suave acima de 44 h/semana ou 10 h/dia, sem bloquear.
12. **Endereço principal × local Principal.** Recomendo perguntar "Atualizar também o local Principal?" quando os dois eram iguais. Nunca sincronizar sozinho.
13. **Histórico do cliente cortado.** Recomendo um aviso "mostrando os mais recentes" e "Carregar mais".
14. **Selo de satisfação com "Ver só os próprios".** Recomendo esconder, ou contar só as OS da pessoa.
15. **E-mail único na Implantação.** Recomendo, **antes da importação**, a mesma checagem da ficha:
    - contato com portal;
    - colaborador com login (troca o login junto);
    - repetido dentro da planilha.
16. **Gavetas de edição.** Recomendo perguntar ao fechar só nas que guardam rascunho (tabela de preço, produto, serviço).
17. **Material de campo a conferir.** Recomendo um filtro e uma pendência no sino. Para a OS de contrato, decidir se a medição puxa o material.
18. **Desfazer do reajuste.** Recomendo só o último lote.

## Testes

- **Novos:**
  - `pj4-cenarios-comissoes-pg` (os 6 cenários e o fechamento);
  - `pj4-comissoes`;
  - `pj4-cliente-*` (regras, tela, PostgreSQL);
  - `pj4-levai*` (regras, tela, PostgreSQL);
  - `pj4-colaborador*` (regras, tela, PostgreSQL, admissão);
  - casos novos em `com2-executor(-pg)`, `com12-contrato-pg`, `comissoes-pg` e `leva-j-colaborador`.
- **Atualizados de propósito** (afirmavam o comportamento antigo):
  - `levah-ficha-cliente(-pg)`: o histórico só com a permissão de cada módulo; CNPJ válido;
  - `levah-ficha-ui`, `leva2-telas-ui`, `padronizacao-leva6a-ui`: Cancelar/Voltar viraram link;
  - `cliente-abas-enxugar-ui`: o link de contratos já filtrado;
  - `leva3-cadastros`: CNPJ válido;
  - `leva-i2c-pg`: o motivo do preço de tabela ao confirmar o material;
  - `padronizacao-leva8c`: a folha mudou só no CSV;
  - `leva-j-colaborador-ui`: RT com CREA;
  - `leva4-acesso`: e-mail de quem tem login;
  - `leva-relatorio-os`: a chave das especialidades na leitura;
  - `despoluicao-baseline`: o arquivo morto saiu.
- **Mutação:** MUTACAO_RESUMO
- **Suíte inteira:** SUITE_RESUMO
- **Typecheck** limpo; **build** BUILD_RESUMO.
