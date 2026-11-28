# Leva H — Ficha do cliente profissional

🟢 **Sem banco.** Nenhuma coluna nova, nenhum SQL. O endereço principal usa as colunas que o cliente já tinha
(`clientes.endereco/numero/complemento/bairro/cidade/estado/cep`); os locais de atendimento continuam em `unidades`.

Telas: `/clientes/[id]` (ficha, em consulta) e `/clientes/[id]/editar` (edição). As duas usam o mesmo
`components/forms/cliente-form.tsx`.

## 1. Endereço principal e locais de atendimento

**Endereço principal** é o de cobrança, o que vai na nota fiscal como tomador. Fica em **campos normais** na aba
Dados, logo depois da Identificação, como a razão social:

- **Consultar** (CNPJ) preenche o endereço junto com a razão social e o nome fantasia. Só os campos **vazios**: o que
  a pessoa já digitou fica (`enderecoDaConsulta`, `lib/clientes/endereco-principal.ts`);
- o **CEP** completo busca rua, bairro, cidade e UF uma vez (o mesmo CEP não busca de novo). A lupa busca de novo;
- na consulta, o endereço principal aparece numa linha: `Rua, 250 — Bloco B · Bairro · Cidade/UF · CEP`.

Os **demais endereços** são os **locais de atendimento** (unidades). Decisão: ficam numa **aba própria,
"Endereços"**, e não na aba Dados. Motivos:

- cada local carrega equipamentos, OS, contratos e PMOC; misturar com o endereço de cobrança confundia;
- a aba Dados fica curta, e a lista cresce sem empurrar o resto do cadastro.

A aba Endereços mostra uma **lista enxuta**: nome, selo Principal e o endereço numa linha. As ações ficam na
própria linha: **Editar**, **Tornar principal** e **Inativar**. Os inativos ficam na seção recolhida
"Inativos", com Reativar. **Novo endereço** fica no fim da lista. O formulário do local começa pelo CEP.

- Funciona também na **consulta**, para quem pode editar o cliente. Quem só visualiza vê só a lista.
- A ligação com unidades, contratos e PMOC é a mesma de antes: nada mudou no modelo, nas rotas `/api/unidades`
  nem no impacto/bloqueio ao inativar.
- Saiu o cartão "Técnico mais próximo · disponível em breve" (era só um aviso, sem função).

### Cliente novo

Ao salvar um cliente novo com endereço principal, o servidor cria o local **"Principal"** com esse endereço. As OS,
os equipamentos e o PMOC precisam de um local (`locaisDoClienteNovo`, `app/api/clientes/route.ts`):

- os outros locais informados na aba Endereços entram como **secundários**;
- se um deles já é o mesmo endereço (rua + número, ou CEP + número; sem acento, caixa ou pontuação), não duplica;
- a regra da empresa "exigir endereço" passa a aceitar o endereço principal.

Cliente que já existe não muda: o endereço principal e os locais continuam independentes, como antes.

## 2. Cabeçalho e edição

O cabeçalho segue o padrão da OS (`components/clientes/cabecalho-cliente.tsx`): **voltar**, nome (o fantasia, ou a
razão social), e uma linha com a razão social, o CNPJ e a cidade. Fica preso no topo ao rolar, no desktop.

- **Consulta:** à direita, o botão único **Novo ▾**, depois **Editar** (abre na mesma aba) e **Inativar/Reativar**.
- **Edição:** só **Cancelar · Salvar e continuar · Salvar**. Saíram a barra repetida do rodapé e os atalhos.
- Menos texto de orientação: as frases sob as seções saíram; o que ainda ajuda virou ⓘ.
- Abas com sublinhado, uma linha que rola de lado no celular, alvos de toque com 44 px.
- No celular, os botões descem para baixo do nome; o menu "Novo" nunca sai da tela (`MenuAcoes` encosta à
  esquerda quando faltaria espaço).

Abas: **Dados · Endereços · Histórico · Atendimento · Comunicação · Portal · Anexos**. No cliente novo, só
Dados, Endereços, Portal e Anexos (as outras só existem depois de salvar). As Observações foram para a aba Dados.

## 3. Botão único "Novo ▾"

Na ficha (consulta), de cliente ativo, só com o que o perfil permite (`itensDoNovo`, `lib/clientes/cabecalho.ts`):

| Item | Leva a | Permissão |
|---|---|---|
| Ordem de serviço | `/ordens/nova?clienteId=` | Ordens › Criar |
| Orçamento | `/orcamentos/novo?clienteId=` | Orçamentos › Criar |
| Contrato | `/contratos/novo?clienteId=` | Contratos › Criar |
| Envio de documentação da equipe | `/documentacao-equipe/novo?clienteId=` | Documentos › Enviar ao cliente |

Sem nenhum item permitido, o botão não aparece. Cliente inativo: sem botão.

**Fora do menu, de propósito:**

- **Pedido do cliente:** não existe tela para criar um pedido solto; ele nasce da OS ou do orçamento.
- **PMOC:** o PMOC nasce do contrato, e a tela de novo PMOC não recebe o cliente pela URL.

Ficam como pergunta no PR.

Salvar um cliente **novo** leva à ficha dele, onde está o Novo ▾. "Salvar e continuar" segue na edição.

## 4. Só o que importa

Sinais do cabeçalho (`sinaisDoCliente`), só quando há algo a dizer:

- **Inativo**: só para cliente inativo. "Ativo" é o normal e não aparece.
- **Inadimplente · R$ X em atraso**: só com valor vencido em aberto (o que falta das parcelas vencidas, já
  abatida a baixa parcial). Para quem vê o contas a receber, é link para as vencidas daquele cliente, em todo o
  período. Adimplente não mostra nada.
- **N contrato(s) ativo(s)**: só com contrato ativo, como link para os contratos do cliente.
- **A receber em 30 dias · R$ X**: só com valor.
- **★ 4,7 (12)**: a média do aceite das OS, só com avaliação. Substitui a seção Satisfação.

Saíram os selos fixos "Adimplente", "Sem contratos" e "Ativo".

## 5. Histórico automático

Saíram o botão manual **Registrar interação** e a aba **Relacionamento**. Links antigos (`?aba=relacionamento`)
abrem o **Histórico**. É uma linha do tempo montada com o que o sistema já registra
(`lib/clientes/historico-server.ts`, `GET /api/clientes/[id]/historico`):

| Tipo (filtro) | De onde vem |
|---|---|
| Ordens de serviço | OS criadas e concluídas |
| Orçamentos | criados, enviados (e-mail/WhatsApp), aprovados, recusados |
| Faturas e pagamentos | faturas criadas e pagas, recebimentos e estornos |
| Pedidos do cliente | pedidos registrados, conferidos ou recusados |
| Ações do cliente | OS aberta pelo portal, orçamento aberto, aceite confirmado, pedido enviado pelo portal, documentação aberta/baixada |
| E-mails e lembretes | e-mails das OS, fatura enviada, cobrança enviada, lembrete do pedido de compra, documentação enviada |
| Contratos | cadastro e mudanças de situação |
| Notas | as interações manuais antigas, que continuam visíveis |

- Agrupado por mês (fuso de Brasília), do mais recente ao mais antigo, com quem fez e o link para o registro.
- Filtro por tipo com a contagem; só aparecem os tipos que têm algo.
- Carrega na primeira vez que a aba abre; no máximo 100 por fonte e 300 no total (os mais recentes).
- **Faturas, pagamentos e cobranças só para quem vê o financeiro** (contas a receber ou faturas). Cliente de outra
  empresa: 404.
- **Limite honesto:** não existe log de acesso ao portal. As "ações do cliente" vêm do que já é gravado: OS aberta
  pelo portal, orçamento visualizado, aceite, pedido e documentação.

## 6. Pontas soltas conferidas

- **Editar:** abre na aba em que a pessoa está. **Voltar** e **Cancelar** levam à ficha, na mesma aba.
- **Inativar/Reativar:** o mesmo botão padrão dos cadastros (impacto, motivo, permissões `excluir`/`editar`), na
  consulta.
- **Permissões:**
  - sem `clientes.editar`, não há Editar nem ações nos locais;
  - o Novo ▾ segue as permissões de criar;
  - o histórico financeiro segue o financeiro.
- **Celular:** cabeçalho em duas linhas, abas com rolagem lateral, menu dentro da tela, alvos de 44 px.

## Testes

- Regras puras: `tests/unit/levah-ficha-cliente.test.ts`
  - endereço da consulta, linha única, local Principal, mesmo endereço;
  - sinais e Novo ▾;
  - histórico (ordem, repetidos, filtro, meses de Brasília, corte);
  - seção Endereço principal.
- PostgreSQL real: `tests/unit/levah-ficha-cliente-pg.test.ts`
  - cada fonte do histórico, isolamento por cliente e por empresa, financeiro só com permissão, limites;
  - API (404/403);
  - local Principal do cliente novo;
  - valor em atraso.
- Tela: `tests/unit/levah-ficha-ui.test.ts`
  - cabeçalho, Novo ▾ e abas;
  - histórico (carregar, filtrar, vazio, erro);
  - CNPJ e CEP;
  - locais só leitura, aviso do Principal, "exigir endereço", destinos após salvar.
- Expectativas atualizadas, com a mudança intencional anotada em cada teste:
  - `cliente-abas-enxugar-ui`, `cliente-cnpj-autofill-ui`, `cadastros-pontas-ui`, `cadastros-pontas2-ui`;
  - `documentacao-telas-ui`, `golive-acabamentos-ui`, `leva2-telas-ui`, `ux2-cliente`.
