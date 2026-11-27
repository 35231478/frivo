# Pronto pra janeiro 2: as decisões de A a L

Esta leva aplica as decisões tomadas sobre a lista do fim de `docs/pronto-janeiro.md`. **🟢 Sem banco**: nenhuma
coluna nova e nenhum SQL. Tudo usa colunas que já existem.

Dados e prints são **fictícios**. A empresa criada pela tela nova é "Climatização Horizonte Ltda (fictícia)".
A empresa de demonstração é "Refrigeração Nova Era Ltda (fictícia)".

## O que mudou

| # | Decisão | Como ficou | Onde |
|---|---|---|---|
| **B** | Criação de empresa pelo super admin | Nova tela interna **Empresas (Frivo)** em `/admin/empresas`. Tem a lista mínima (nome, CNPJ, data e nº de usuários) e o botão **Nova empresa**. Uma transação só cria a empresa, a configuração padrão, os perfis (A), os tipos de OS (C) e o 1º administrador. A senha inicial é do super admin, e o administrador troca no 1º acesso em **Meu perfil › Senha**. CNPJ repetido (com ou sem máscara) dá 409. E-mail de login já usado em qualquer empresa também dá 409, porque o login procura o e-mail em todas | `lib/empresa/criar-empresa.ts`, `app/api/admin/empresas`, `app/(dashboard)/admin/empresas`, `components/admin/empresas-admin.tsx`, rodapé do menu |
| **A** | 5 perfis padrão ao nascer | Os perfis saem dos presets do código, sem mudar os presets: **Administrador**, **Gestor** (preset Supervisor renomeado), **Financeiro**, **Técnico** e **Vendas** (Personalizado: painel; clientes ver/criar/editar; orçamentos ver/criar/editar; contratos ver). O Vendas não aprova orçamento, não vê custo, não vê financeiro e não vê configurações. O **Auxiliar** deixou de ser criado. Perfis já existentes (mesmo nome, sem olhar acento e caixa) não são tocados | `lib/empresa/padroes.ts` |
| **C** | Tipos de OS de climatização | A empresa nasce com Instalação, Manutenção Preventiva, Manutenção Corretiva, Visita Técnica, PMOC e Orçamento/Vistoria. Com a lista **vazia**, Configurações › Tipos de OS oferece **Usar modelos sugeridos**, que cria só os que faltam. Aparece só para quem grava tipos de OS | `app/api/tipos-os/modelos`, `components/cadastros/modelos-tipos-os.tsx` |
| **D** | "Cliente aprovou" registrado pela equipe | É o espelho do "Cliente recusou": quem aprovou, por onde (telefone, WhatsApp, e-mail, pessoalmente, outro) e uma observação. As travas são as do link: Enviado ou Rascunho, dentro da validade, e troca de status atômica (dois cliques aprovam uma vez). Não grava CPF, assinatura nem IP. O documento mostra **"Aprovação registrada pela equipe"**. A linha do tempo diz quem registrou. Permissão: Orçamentos › Aprovar | `lib/orcamentos/aprovacao-equipe.ts`, `app/api/orcamentos/[id]/aprovacao-equipe`, `components/orcamento/aprovacao-equipe.tsx`, `acoes-envio.tsx`, `orcamento-documento.tsx` |
| **E** | Equipamento só quando o tipo exige | Atividade **sem tipo de OS** deixa de exigir equipamento, também nas empresas atuais. O motivo aparece na tela: "Atividade sem tipo de OS…". A regra por tipo (`exigeEquipamento`) já existia. Os padrões novos exigem só em PMOC e Manutenção Preventiva | `lib/execucao/dados.ts` (`dispensaDaAtividade`), `lib/execucao/pendencias.ts` |
| **F** | Concluir marca os itens executados (servidor) | Ao concluir a **última** atividade aberta da OS, os itens ainda não executados passam a executados. Fica um registro no histórico ("Itens marcados como executados"). O escritório **desmarca** na aba Comercial ("Desmarcar", com histórico), exceto em registro fechado (assinado pelo cliente, faturado ou com nota). Sem banco: o vínculo item↔atividade fica para depois | `lib/execucao/itens-ao-concluir.ts`, `lib/execucao/acoes.ts` (`concluirAtividade`), `app/api/ordens/[id]/orcamento/[itemId]`, `components/os/os-orcamento.tsx` |
| **G** | "Cheguei" inicia (servidor) | O toque passa a atividade de Agendada para Em andamento, na hora do toque. A OS vai para **Em execução** pelo status automático, e o ajuste manual de status da OS é respeitado. Tocar de novo não reinicia. A interface do app não mudou | `lib/execucao/aviso-cliente.ts` (reusa `iniciarAtividade`) |
| **H** | Nome automático sem "…" | O nome junta as partes inteiras (tipo ou serviço + cliente) e só corta no limite do campo (120). A lista de orçamentos já cortava só na tela, com o nome inteiro no `title`, e ficou como estava. Nomes já gravados com "…" não mudam (vale para os orçamentos novos) | `lib/orcamentos/nome.ts` |
| **J** | Assinatura preservada ao redimensionar | No celular, o evento de redimensionar dispara sozinho (barra de endereço, teclado, girar), e o quadro apagava a assinatura. Agora o quadro só redimensiona quando o tamanho muda de fato, e redesenha os traços. Vale para o link do orçamento, do relatório e da medição | `lib/assinatura-quadro.ts` + `clearOnResize={false}` nos três quadros |
| **K** | Nome da empresa do cadastro | O menu, o cabeçalho, o painel e o perfil leem o nome do banco a cada carga, sem mexer no login. O nome é o nome fantasia ou, sem ele, a razão social. Corrige também o texto enviado ao cliente no orçamento, no PMOC e no pedido de compra: empresa sem nome fantasia saía "Segue o orçamento Nº 12 de :" | `lib/empresa/nome.ts`, `app/(dashboard)/layout.tsx`, `dashboard`, `perfil`, rotas de envio |
| **L** | Chips da Implantação clicáveis | O item que leva a uma tela tem borda e texto de link, seta, realce no hover, foco visível e título ("Abrir Logo em Configurações"). O item só informativo fica como etiqueta | `components/implantacao/painel-implantacao.tsx` |
| **CEP** | Teste com ViaCEP simulado | Cobre o CEP encontrado, campos ausentes, CEP inexistente, erro HTTP, rede fora e CEP incompleto (nem consulta). Nenhum teste usa a rede | `tests/unit/cep-viacep.test.ts` |

## Para o Zé olhar (riscos e avisos)

1. **RBAC, tocado só na criação de empresa** (autorizado nesta leva): os perfis padrão saem dos presets
   **sem alterar** `lib/permissoes.ts`. Perfis de empresas existentes não mudam.
2. **O super admin passa a ver a lista de todas as empresas** (só nome, CNPJ, data e nº de usuários) e a
   criar empresas. É a única exceção ao princípio "SUPER_ADMIN não é chave-mestra entre empresas". Ele
   continua **sem** acesso a nada de dentro de outra empresa. A trava está na página e na API, com 403 e um
   teste para o ADMIN de empresa-cliente. `/admin` não pertence a módulo, então o middleware não bloqueia:
   quem bloqueia é a página e a rota.
3. **Troca de senha no 1º acesso não é forçada.** O fluxo que existe é Meu perfil › Senha, e a tela de
   sucesso diz isso ao super admin. Forçar a troca exigiria uma coluna nova e uma regra no middleware, que é a
   área de login. Fica como pergunta: forçar em uma leva própria?
4. **E muda o comportamento das empresas atuais**: atividade sem tipo de OS conclui sem equipamento.
   Confirmado na decisão.
5. **G e F mudam o que o técnico vê sem mudar a UI do app**: depois do "Cheguei", a atividade aparece Em
   andamento. Depois de concluir a última, os itens estão executados e a aba Financeiro já oferece faturar.
6. **J não foi aplicado ao aceite da OS** (`components/os/aceite-assinatura.tsx`), porque esse componente é
   o mesmo do app do técnico (`components/tecnico/aceite-cliente.tsx`), fora desta leva. A correção é de uma
   linha mais o hook. Pergunta: aplicar lá também?
7. **I** (o aviso "Only plain objects… Decimal" na página da OS) fica para uma **leva técnica própria**,
   como decidido.

## Testes

- `tests/unit/pronto-janeiro-2-pg.test.ts` (16, PostgreSQL real):
  - **Nova empresa:** sem sessão 401; ADMIN 403; transação completa com os 5 perfis, os 6 tipos, o admin com
    hash e o perfil Administrador; CNPJ e e-mail repetidos 409 sem criar nada; validação 400; completar sem
    duplicar nem alterar; "modelos sugeridos" com 403 e criando só os que faltam.
  - **Cliente aprovou:** aprovação com linha do tempo; Rascunho; já aprovado; reprovado; validade vencida;
    validação; 403 e 404; dois cliques simultâneos geram um evento só.
  - **F:** atividade aberta não marca; a última concluída marca e registra uma vez; desmarcar com histórico;
    registro assinado não desmarca; 403 sem Ordens › Editar.
  - **G:** "A caminho" não muda nada; "Cheguei" põe a atividade Em andamento na hora do toque e a OS Em
    execução; repetir não reinicia; status manual é respeitado.
- `tests/unit/pronto-janeiro-2.test.ts` (20, regras puras e telas): perfis e tipos padrão; máscara de CNPJ;
  a tela Nova empresa (envio, aviso de entrega da senha e erro do servidor); modelos sugeridos (oferta,
  empresa que já tem tipos, sem permissão); modal "Cliente aprovou"; E (SEM_TIPO, TIPO, trava); "Desmarcar"
  (aparece, some em registro fechado e sem permissão); J; K; L.
- `tests/unit/cep-viacep.test.ts` (7).
- **Expectativas atualizadas de propósito**, sem mascarar nada:
  - `orcamento-nome-banco.test.ts` (H): o nome agora vem inteiro, e o exemplo "longo" foi encurtado para
    caber em 120.
  - `modulos-equip-pg.test.ts` (E): a prova de que o módulo desligado tira a trava precisa de uma atividade
    **com tipo que exige** equipamento. Sem tipo, a trava já não existe.
  - `execucao-os-pg.test.ts` e `os-central-pg.test.ts` (E): as provas da trava de equipamento criavam atividade
    **sem tipo**. Agora usam um tipo que exige equipamento (Manutenção Preventiva), com o técnico competente
    nele. O que elas provam (a trava, a mensagem, o status automático) continua igual.
  - `prazos-pr4-pg.test.ts` (G): depois do "Cheguei", a atividade está Em andamento (antes, Agendada). A hora
    do comparecimento e os limites prometidos continuam os mesmos.
  - `orcamento-acabamento-pg.test.ts` (H): o nome automático do orçamento novo vem inteiro.
  - `aviso-cliente-pg.test.ts` (G): o cabeçalho dizia que o aviso não começa o atendimento. Isso continua
    valendo para "A caminho", e o teste do "Cheguei" agora confere que a atividade começa.
- **Ciclo de importação evitado**: o "Cheguei" chama o início da atividade por `import()` tardio. No topo,
  fecharia o ciclo `acoes → sincronizar-status → aceite-server → aviso-cliente → acoes`, que travava a carga
  dos testes do app do técnico.
- **Um defeito pego pelos testes antes do PR**: o "Desmarcar" usava a trava da linha, que sempre existe em
  item executado. Por isso o botão nunca aparecia. Agora usa só a trava do registro fechado.

## Prints (dados fictícios)

`docs/prints/pronto-janeiro-2/`, desktop e celular.
