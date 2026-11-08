# Glossário do Frivo (um conceito, uma palavra)

Vocabulário oficial dos rótulos de interface (manifesto, princípio 3). Vale para botões, títulos, abas, placeholders, mensagens e tooltips. **Nunca** muda enum, campo, rota nem valor gravado: só o texto exibido. Decisões fechadas na Onda 7 da despoluição (`docs/auditoria-despoluicao-2026-11-08.md`, seção 4, com as escolhas do Zé por cima).

## Ações

| Conceito | Termo | Não usar | Observação |
|---|---|---|---|
| Apagar de vez um registro ou item | **Excluir** | Remover, Apagar, Deletar | Vale para itens de lista e vínculos também: o usuário não distingue |
| Criar um registro novo | **Novo / Nova** + entidade | Adicionar, Criar, Cadastrar, Incluir | "Novo cliente", "Nova OS", "Novo contato", "Novo endereço" |
| Incluir um sub-item dentro de um formulário | **Adicionar** + o que | Novo | "Adicionar item", "Adicionar foto", "Adicionar etapa", "Adicionar material" |
| Confirmar um formulário ou diálogo de edição | **Salvar** | Gravar, Confirmar, Adicionar, Aplicar | "Confirmar" só em diálogo de confirmação; "Aplicar" só em filtro/reajuste |
| Mudar um registro | **Editar** | Alterar, Modificar, Ajustar | Senha: "Trocar senha"; status: "Mudar status" (não são edição de registro) |
| Procurar em lista ou campo | **Pesquisar** | Buscar, Procurar | Consulta a fonte externa (Receita, CEP): "Consultar" |
| Terminar OS ou atividade | **Concluir** | Finalizar, Encerrar, Fechar | "Fechar" só para fechar diálogo; "Fechar mês" = encerrar competência |
| Tirar um cadastro de uso | **Inativar** | Desativar, Arquivar, Excluir | Cadastros: cliente, produto, serviço, perfil… |
| Encerrar um documento ou OS sem concluir | **Cancelar** | Inativar, Anular | OS, orçamento, medição, cobrança |

## Conceitos que ficam distintos (não unificar)

| Par | Quando usar cada um |
|---|---|
| **Faturar / Fatura** × **Medição** | Faturar/Fatura = cobrança de OS ou orçamento avulso. Medição = cobrança periódica de contrato ("Gerar medição") |
| **Cobrança** × **Boleto** | Cobrança = a linha do Contas a receber. Boleto = o título bancário emitido para ela |
| **Inativar** × **Cancelar** | Inativar = cadastro. Cancelar = documento/OS |
| **Produto / Material / Peça** | Produto = cadastro. Material = produto incluso no serviço (separado para a OS). Peça = produto cobrado à parte na OS |
| **Colaborador / Técnico / Equipe** | Colaborador = cadastro da pessoa. Técnico = papel em campo (OS, agenda, app). Equipe = grupo |
| **Anexo** × **Documento** | Anexo = arquivo que o usuário sobe (foto, PDF, contrato assinado). Documento = o que o sistema emite (relatório, orçamento, medição, NF) ou documento legal datado (CNH, ASO, CRLV) |
| **OS** × **Ordem de serviço** | OS em rótulos, colunas e chips; "Ordem de serviço" em título de página e primeira menção em texto |

## Estados e mensagens

| Conceito | Termo |
|---|---|
| Cobrança/conta sem pagamento | **Em aberto** (não "A receber", "Pendente", "Previsto" como status) · "Previsto" fica só para a previsão de orçamento aprovado ainda sem fatura |
| Mensagem de sucesso | Frase curta com ponto: "Salvo.", "Cliente criado.", "Link copiado." (nunca "!" nem "com sucesso") |
| Sem permissão | "Somente leitura: requer a permissão Módulo › ação." |
| Saudação (dashboard, app do técnico) | "Bom dia / Boa tarde / Boa noite, Nome" — nunca "Olá, Nome!" |
| Mensagem a cliente ou fornecedor (e-mail, WhatsApp) | "Prezado(a) Nome," / "Prezados," |

## Grafia

- Títulos, abas, rótulos e botões em caixa de frase: "Contas a receber", "Novo cliente", "Ordens de serviço". Siglas (OS, NF, QR, CNPJ) e nomes próprios (Banco Inter, Minas Gerais) mantêm a caixa.
- Sem emoji; ícone é `lucide-react`.
- "Em branco, …" no lugar de "X = Y".

Guarda automática: `tests/unit/despoluicao-ratchet.test.ts` (emoji, hex, tom, exclamação, Title Case, texto longo) e os testes `despoluicao-*.test.ts` de cada onda.
