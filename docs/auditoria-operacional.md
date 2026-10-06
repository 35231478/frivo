# Auditoria operacional do Frivo — 06/10/2026

> Etapa 1 de 2: **só diagnóstico**. Nenhum código foi corrigido e nenhum banco foi acessado.
> Base auditada: `main` em `b1c8f0e` (após o PR #22).

## Como ler

- 🔴 **Crítico** — perde/duplica dinheiro, vaza dado sensível, abre brecha de segurança ou deixa uma tela/fluxo principal inutilizável.
- 🟡 **Importante** — fluxo funciona pela metade, dá dado errado em casos comuns, ou brecha que exige conhecimento interno.
- 🟢 **Leve** — incômodo, inconsistência, risco baixo ou caso raro.
- **BD** = a correção precisa de SQL no banco de produção (você roda antes do merge).
- **a confirmar** = depende de algo que não dá para ver no código (estado do banco de produção, variável de ambiente, infraestrutura da Vercel).

Premissas: o deploy é na Vercel (`vercel.json`), então o servidor roda em **UTC** e o corpo de requisição tem limite de **~4,5 MB**. O schema é aplicado com `prisma db push` mais os scripts manuais de `prisma/sql/`; o projeto não tem migrations.

### Placar

| 🔴 Críticos | 🟡 Importantes | 🟢 Leves |
|---|---|---|
| 13 (C1–C13, um "a confirmar") | 32 (I1–I32) | 27 (L1–L27) |

Sinais gerais:
- `tsc --noEmit` passa sem erros.
- ESLint **não está configurado**: `next lint` só abre o assistente.
- Não existe nenhum teste automatizado nem workflow de CI.

---

## 🔴 Críticos

### C1. Anexo pode executar script dentro do painel (XSS armazenado)
- **Onde:**
  - `app/api/ordens/[id]/anexos/[anexoId]/route.ts:19-30` (download)
  - `app/api/portal/chamados/route.ts:66` + `lib/validations.ts` (`chamadoPortalSchema.fotos`)
  - `components/os/os-anexos.tsx` (botão "Visualizar")
- **Reproduzir:**
  1. Pelo portal do cliente, abra um chamado mandando uma "foto" cujo `conteudo` é `data:text/html;base64,...` com um `<script>`. Também funciona com um `.svg` enviado por usuário interno.
  2. Um funcionário abre a OS → Anexos → Visualizar.
- **Impacto:** o Content-Type vem do próprio data URL enviado e a resposta sai `inline`, sem `nosniff`. O script roda na origem do painel com a sessão do funcionário e pode chamar qualquer API: criar perfis, mudar permissões, baixar dados.
- **Correção:**
  - lista branca de MIME no upload (imagens e PDF, sem SVG);
  - não confiar no prefixo do data URL;
  - `inline` só para tipos seguros;
  - headers `X-Content-Type-Options: nosniff` e `Content-Security-Policy: sandbox`.
  - Mesmo tratamento nos anexos de cliente e de contrato.

### C2. Senha do portal (hash e senha provisória em texto) exposta para quem só vê clientes
- **Onde:**
  - `app/api/clientes/[id]/contatos/route.ts:17-20` (`findMany` sem `select`)
  - `app/api/clientes/[id]/route.ts:27` (`include contatosCliente`)
  - `app/(dashboard)/clientes/[id]/editar/page.tsx:21` (vai no payload da página)
  - `app/api/clientes/[id]/contatos/[contatoId]/acesso-portal/route.ts:46` grava `senhaProvisoria = d.senha` em texto
- **Reproduzir:** com um perfil Financeiro (tem `clientes.visualizar`), chame `GET /api/clientes/{id}/contatos`.
- **Impacto:** a `senhaProvisoria` é a senha real de login do contato. Qualquer usuário que visualiza clientes entra no portal como o cliente.
- **Correção:**
  - `select` explícito sem `senha`/`senhaProvisoria` (expor só `temAcesso`);
  - mostrar a senha uma única vez na resposta de criação.
  - Opcional, BD: limpar a coluna `senha_provisoria`.

### C3. "Sem perfil" dá acesso total, e dá para se autopromover
- **Onde:** `lib/auth.ts:41-43`, `app/api/usuarios/[id]/route.ts`, `components/config/usuarios-client.tsx:66`.
- **Reproduzir:**
  1. Em Configurações → Usuários, escolha "Sem perfil" para um usuário (ou para si mesmo, se tiver `configuracoes.gerenciar`).
  2. Saia e entre de novo.
- **Evidência:** `usuario.role === "ADMIN" || !usuario.perfilAcesso ? permissoesTotais() : …`
- **Impacto:** quem acha que está restringindo está liberando tudo. O PUT também não impede editar o próprio usuário, atribuir o perfil Administrador, nem usar um `perfilAcessoId` de outra empresa.
- **Correção:**
  - sem perfil → `permissoesVazias()`;
  - bloquear autoedição;
  - validar o perfil por `empresaId`;
  - só ADMIN atribui perfil ADMINISTRADOR.
  - Antes do deploy, conferir quem está hoje sem perfil (consulta de leitura).

### C4. Cerca de 60 handlers de API só checam login, sem checar permissão (RBAC)
O middleware só protege **páginas**. As rotas `/api/*` precisam chamar `exigirPermissao` uma a uma, e estas não chamam (lista completa no Apêndice A):
- **Comercial:**
  - `orcamentos` (POST, `enviar`, `gerar-contrato`; o `PUT {status}` está em C5)
  - `contratos/**` inteiro (CRUD, status, anexos, próximo número)
  - `pedidos-compra/**`
- **Cadastros:**
  - `unidades/**`, `qrcodes/**`
  - `tabelas-preco/**`, `servicos/**`, `produtos/**`
  - `tipos-os/**`, `tipos-problema/**`
  - `formularios/**`, `termo-templates/**`, `prazo-templates/**`
  - `checklist-templates/**`, `checklists`
  - `tipos-equipamento/[id]/formularios/**`
  - `empresa/logo`
- **OS:** `os-prazos/[id]` (DELETE) e `os-prazos/[id]/avancar`.
- **Colaboradores:** `tecnicos/[id]/localizacao`, `tecnicos/proximos`.
- **Leitura de dados pessoais:** `GET /api/tecnicos/[id]` só exige login e devolve **salário, CPF, RG e documentos** (`app/api/tecnicos/[id]/route.ts:11-26`).
- **Reproduzir:** logado como Auxiliar, rode `fetch('/api/tabelas-preco/<id>', {method:'DELETE'})` → 200. Ou `DELETE /api/contratos/<id>`.
- **Impacto:** um técnico ou auxiliar pode apagar tabela de preço, encerrar contrato, gerar 100 QR codes, avançar SLA. O filtro por empresa está presente, então isso não vaza entre empresas.
- **Correção:** `exigirPermissao(modulo, acao)` em cada handler, por domínio (ver plano de levas).

### C5. Orçamento aceita qualquer status pela API, sem permissão e sem assinatura
- **Onde:** `app/api/orcamentos/[id]/route.ts:46-61`.
- **Reproduzir:** qualquer usuário logado faz `PUT /api/orcamentos/{id}` com o corpo `{"status":"APROVADO"}`.
- **Impacto:**
  - aprova sem assinatura e sem gerar a conta a receber;
  - dá para voltar CONVERTIDA → RASCUNHO;
  - status inválido derruba com 500;
  - a permissão `orcamentos.aprovar` existe mas não é usada em lugar nenhum.
- **Correção:** whitelist de transições, com APROVADO manual exigindo `aprovar` e gerando o financeiro.

### C6. Receita duplicada em Contas a Receber, e cliente marcado INADIMPLENTE sem dever
- **Onde:**
  - `lib/financeiro-server.ts:183-250` (previsão do contrato), `:59-80` (conta do orçamento aprovado), `:9-43` (conta da medição)
  - `app/api/medicoes/gerar-mes/route.ts`
  - `lib/status-financeiro.ts:12,44-50`
- **Reproduzir:**
  1. Crie um contrato mensal. Isso gera contas PREVISTO `CT-…/AAAAMM`.
  2. Gere e aprove a medição do mês. Isso cria uma segunda conta `CR-…` para o mesmo mês.
  3. Orçamento aprovado + FATURA_UNICA: a conta PREVISTO do orçamento **e** a conta da medição que o agrega.
- **Impacto:**
  - "A receber" e Fluxo de Caixa inflados.
  - Nada quita nem cancela a PREVISTO quando a medição é paga.
  - Depois do vencimento, `STATUS_EM_ABERTO` inclui PREVISTO, então o cliente vira **INADIMPLENTE** pagando em dia.
  - A conta do orçamento vence na **validade da proposta** (`dataVencimento: orcamento.validadeEm`).
- **Correção:**
  - vincular a conta real à prevista do período e cancelar a prevista;
  - tirar PREVISTO do cálculo de inadimplência;
  - **BD:** `contrato_id` + `periodo` em `contas_receber`, mais um script de limpeza das duplicadas (rodado por você, revisado antes).

### C7. Uma mesma OS pode ser faturada 2–3 vezes, inclusive medições de R$ 0
- **Onde:**
  - `app/api/publico/relatorios/[token]/aprovar/route.ts:36` → `lib/financeiro-server.ts:90-150`
  - `app/api/ordens/[id]/gerar-medicao/route.ts`, `gerar-medicao-completa/route.ts`, `ordens/[id]/medicoes/route.ts`
  - `lib/os-server.ts:12`
- **Reproduzir:**
  - Conclua uma OS com 2 atividades: nascem 2 relatórios de atividade e 1 geral, sem valor. O cliente aprova os 3 → **3 medições de R$ 0 e 3 contas a receber**. No perfil AUTOMÁTICO já nascem como NF_EMITIDA / A_RECEBER.
  - Na OS concluída, clique "Gerar medição" (cabeçalho) e depois "Gerar Medição" (aba Relatórios) → duas medições com o mesmo valor.
- **Impacto:** cobrança em dobro e financeiro poluído. A trava de inativação da OS não enxerga `relatorio.medicaoId`, então dá para inativar uma OS já faturada.
- **Correção:**
  - uma função única `osJaFaturada()` (MedicaoItem + RelatorioOs.medicaoId + OsMedicao) usada pelas 3 rotas e pela inativação;
  - aprovação de relatório só gera medição se `escopo === MEDICAO_COMPLETA` ou valor > 0.

### C8. Aba Financeiro da OS quebra ao gerar medição parcial/final
- **Onde:** `app/api/ordens/[id]/medicoes/route.ts:33` (create sem `include`) + `components/os/os-financeiro.tsx:68` (`m.itensFinanceiro.length`).
- **Reproduzir:** em `/ordens/{id}` → Itens, marque um item como executado → Financeiro → "Gerar medição parcial".
- **Impacto:** TypeError; a página da OS cai na tela de erro até recarregar.

### C9. "Salvar configurações" sempre falha (400 "Dados inválidos")
- **Onde:** `app/api/configuracoes/route.ts:30` (`.strict()`) + `components/forms/configuracoes-client.tsx` (envia o objeto Prisma inteiro, que inclui `qrConfig`).
- **Reproduzir:** como Admin, mude qualquer toggle em `/configuracoes` → Salvar.
- **Impacto:** nenhuma regra de cadastro, OS, notificação ou mapa pode ser alterada pela tela.

### C10. Formulário (checklist de OS) e template de checklist de veículo travam depois do primeiro uso
- **Onde:**
  - `app/api/formularios/[id]/route.ts:8-48`
  - `app/api/checklist-templates/[id]/route.ts:36-44`
- **Reproduzir:**
  1. Responda o formulário numa OS (ou preencha um checklist de veículo).
  2. Volte em Configurações, edite e salve → "Erro ao salvar".
- **Causa:** os dois fazem `deleteMany` + recriação dos campos/itens. As respostas referenciam esses campos sem `onDelete`, então o banco recusa (P2003) → 500.
- **Agravante:** o PUT de formulários repassa o body cru para o `update` (sem zod e sem RBAC), então qualquer logado pode alterar `ativo`, `empresaId` etc.
- **Correção:** diff dos campos (atualizar por id, criar novos, inativar removidos) + zod + `exigirPermissao("configuracoes","gerenciar")`.

### C11. Recorrência de OS por local para depois das 12 primeiras
- **Onde:** `lib/recorrencia-server.ts:108-160` (`aPartirDe: primeira`, `limite = 12`).
- **Reproduzir:** contrato com local MENSAL a partir de jan/2026 → são geradas jan…dez. Salvar o contrato de novo depois disso não cria nada.
- **Impacto:**
  - preventivas somem do calendário em silêncio;
  - não há cron;
  - o botão do calendário só trata a recorrência do contrato, não a por local;
  - se a 1ª data é passada, cria OS AGENDADA retroativas.
- **Correção:** `aPartirDe = max(primeira, hoje)`, gerador mensal (cron) e incluir os locais no botão do calendário.

### C12. Relatório de atividade é público pelo ID, sem token
- **Onde:** `app/(publico)/relatorio/atividade/[id]/page.tsx` + `lib/relatorio-server.ts:147` (`findUnique({ id })`); o middleware libera `/relatorio/`.
- **Reproduzir:** abra `/relatorio/atividade/<id>` em aba anônima.
- **Impacto:** expõe dados completos do cliente, respostas e fotos a quem tiver o link. O id aparece em URLs e históricos e não é segredo.
- **Correção:** usar o `tokenPublico` do relatório (já existe) ou exigir sessão + empresa.

### C13. (a confirmar) Telas de OS dependem de 2 scripts SQL manuais
- **Onde:** detalhe/lista de OS, calendário, relatórios públicos, criação de OS e aceite de solicitação usam:
  - `atividade_tecnicos`
  - `atividades_os.equipe_id` e `atividades_os.veiculo_id`
  - `tecnicos.veiculo_id`
- **Impacto:** se `prisma/sql/2026-10-07_*.sql` e `2026-10-08_*.sql` não rodaram em produção, essas telas dão *server-side exception*.
- **Como confirmar:** rode `docs/sql/verificar-schema-producao.sql` (seção "Schema × produção").

---

## 🟡 Importantes

### Segurança e permissões
- **I1. Referências de outra empresa aceitas no corpo (isolamento entre empresas).** O id do registro principal é checado por `empresaId`, mas os ids **relacionados** vindos do body não são:
  - OS: `unidadeId`, `contratoId`, `responsavelId`, `tipoOsId` — `app/api/ordens/route.ts:105-118`, `ordens/[id]/route.ts:134`, `atividades/route.ts:50`
  - orçamento: `clienteId`, `responsavelTecnicoId`
  - contrato: `clienteId`, `unidadeIds`, técnico, tipo de OS
  - medição: `contratoId`, itens
  - pedido: `ordemServicoId`/`orcamentoId`
  - cliente: `tabelaPrecoId`, RT
  - colaborador: `cargoId`, `perfilAcessoId`, competências
  - veículo: `responsavelId`, `equipeId`
  - checklist: `templateId`, `colaboradorId`
  - usuário: `perfilAcessoId`
  - `gerar-contrato` chega a fazer `tx.cliente.update` no cliente do orçamento.
  - Exploração exige conhecer um cuid; um id inexistente dá 500.
  - **Correção:** helper `garantirDaEmpresa(model, id, empresaId)`.
- **I2. Webhook do Banco Inter confia no token da URL e no corpo.** `app/api/webhooks/inter/route.ts`.
  - Quem tem o `webhookSecret`, que `GET /api/integracoes/inter` devolve a quem tem `configuracoes.visualizar`, forja "RECEBIDO" e baixa contas e medições.
  - Também baixa conta CANCELADA e não confere valor.
  - **Correção:** confirmar no Inter (`consultarBoletoInter`) antes de baixar e não devolver o segredo.
- **I3. Menu e middleware desalinhados.**
  - `/leads-site` (lista nome, celular e valor dos leads) e `/compras` não estão em `ROTA_MODULO` → abertos a qualquer logado.
  - "Checklists" de Frota aponta para `/configuracoes/checklists-veiculo` → técnico vê o link e cai em `/sem-permissao`.
  - O menu inferior do mobile não filtra por permissão.
  - Arquivos: `lib/permissoes.ts:113`, `components/layout/sidebar.tsx:94`, `mobile-bottom-nav.tsx`.
- **I4. Permissões congeladas no login (JWT).** `auth.config.ts:18-33`.
  - Trocar perfil, restringir permissão ou inativar perfil/usuário só vale depois de novo login (sessão de até 30 dias).
  - **Correção:** recarregar role/permissões/ativo a cada N minutos no callback `jwt`.
- **I5. Configurações exigem role ADMIN, não permissão.**
  - `api/configuracoes`, `api/configuracoes/qr-code` e `api/empresa` checam `role !== "ADMIN"`.
  - Quem tem perfil Administrador mas role GERENTE/OPERADOR vê a tela e recebe 403.
  - `pode()` não reconhece `SUPER_ADMIN`.
- **I6. Login do portal ambíguo entre empresas.**
  - `lib/auth-portal.ts:36-43` busca só por e-mail; o mesmo e-mail em duas empresas faz um nunca conseguir entrar.
  - Mesmo padrão em `lib/auth.ts:19` para usuários internos.
- **I7. Cache do PWA serve dados velhos e de outro usuário.**
  - `next.config.ts` faz `NetworkFirst` com timeout de **3s** em todo `/api/*` e em páginas (7 dias).
  - Em rede lenta, a tela mostra o JSON antigo sem avisar (sintoma típico de "salvei e voltou").
  - O logout não limpa o Cache Storage, então num aparelho compartilhado ou offline o próximo usuário pode ver dados do anterior, inclusive anexos.
  - **Correção:** tirar `/api/` do runtimeCaching (ou só rotas públicas estáticas) e limpar caches no logout.

### Ordens de Serviço, Calendário, Solicitações
- **I8. Fuso horário (UTC no servidor × Brasília no usuário) desloca horários e dias.**
  - **Calendário** (`app/(dashboard)/calendario/page.tsx`): 14:00 aparece 17:00; 22:00 cai no dia seguinte.
  - **Aceitar solicitação** (`api/solicitacoes/[id]/aceitar/route.ts:58`): grava 14:00 como 11:00.
  - **Nova atividade na aba Atividades** (`os-atividades.tsx:117`): envia `datetime-local` cru → +3h. Na edição o horário fica certo; na criação, não.
  - **Previsão de conclusão (`type=date`):** mostra o dia anterior.
  - **Filtro `?data=` de `/ordens`:** limites do dia calculados em UTC.
  - **Arrastar no calendário:** opera em UTC.
  - **Validade do orçamento:** expira às 21h do dia anterior e o cliente não consegue aprovar no último dia.
  - **Correção:** padronizar `America/Sao_Paulo` nos cálculos de servidor e sempre ISO no cliente.
  - Dados já gravados pelos fluxos errados ficam deslocados (avaliar correção pontual).
- **I9. Erro de hidratação (console) em todas as telas de OS.** Datas formatadas no SSR (UTC) diferem do navegador (BRT): `os-detalhe`, `os-atividades:170`, `ordens-lista-client:362,398`, `os-prazos`. O React re-renderiza a página inteira.
- **I10. Formulário de execução abre vazio e sobrescreve respostas anteriores.** `components/os/atividade-execucao.tsx:189` + `grupos/respostas/route.ts:76`.
  - **Reproduzir:**
    1. Responda o formulário para 3 equipamentos e salve.
    2. Marque um 4º equipamento e abra "Responder" de novo (vem em branco).
    3. Salve → respostas e fotos dos 3 primeiros são substituídas.
  - **Perda de dado de checklist.**
- **I11. Não existe edição da OS.**
  - `/ordens/[id]/editar` só redireciona; a API `PUT` aceita descrição, prioridade, endereço, contrato, responsável e previsão, mas nenhuma tela usa.
  - Erro de digitação na abertura não tem conserto.
- **I12. QR "chamado só para logado" não funciona.** `app/(publico)/qr/[token]/page.tsx:166` + `api/qr/[token]/chamado/route.ts:48`.
  - A página mostra o formulário ao logado, mas a API sempre devolve 403 (nunca lê a sessão do portal).
  - `logado` aceita portal de qualquer empresa.
  - QR **inativo** continua abrindo chamado.
  - Não há limite de requisições no POST público.
- **I13. Portal do cliente mostra o histórico interno da OS** (motivos de recusa, valores de medição, "item adicionado") e anexos internos; carrega o base64 de todos os anexos. Arquivo: `app/(portal)/portal/(protegido)/chamados/[id]/page.tsx:23-30`. Talvez BD: flag `publico` no histórico/anexo.
- **I14. Fotos e anexos estouram o limite de 4,5 MB da Vercel.**
  - Chamado do portal manda até 6 fotos do celular em base64 sem compressão → 413 → "Erro ao abrir chamado".
  - Anexo de OS e de contrato aceita 5 MB.
  - **Correção:** comprimir/redimensionar no cliente e limitar no servidor.
- **I15. Numeração com colisão (500 por duplicidade).**
  - Medição usa `count()+1` (`ordens/[id]/gerar-medicao:36`); depois de excluir uma medição, o número repete.
  - `count()+1` também em: relatórios (`gerar-medicao-completa:46`), chamado (`portal/chamados:46`, `qr/chamado:58`; sem unique, então duplica) e pedido de compra (`pedidos-compra/route.ts:51`).
  - OS, contrato e QR usam MAX+1 sem retry: dois cliques simultâneos → um 500.
  - **Correção:** helper de próximo número + retry no P2002. Opcional, BD: unique em `chamado_numero`.
- **I16. Excluir item da OS apaga em cascata o item já medido** (`ordens/[id]/orcamento/[itemId]` DELETE + `onDelete: Cascade`). Deixa a medição com total inconsistente. Não há botão hoje, mas a API está exposta.
- **I17. Scanner de QR na execução reinicia a câmera a cada re-render** (`atividade-execucao.tsx:310`, `useEffect([onLer])` com callback inline). A câmera pisca e pode pedir permissão de novo.

### Comercial
- **I18. "Converter em contrato" não liga as pontas.** `app/api/orcamentos/[id]/gerar-contrato/route.ts:56-97`.
  - Cria o contrato com `recorrencia: true` mas não gera OS recorrentes nem a previsão financeira; nada aparece até alguém abrir e salvar o contrato.
  - Sobrescreve `exigePcAntesNf` do cliente com o padrão `false` do formulário: o cliente perde a exigência de PC.
  - `valorTotal` calculado diferente do formulário de contrato.
- **I19. Contrato encerrado ou vencido continua faturando e gerando OS.**
  - `gerar-mes` filtra só `status ATIVO`, sem olhar vigência.
  - O status nunca vira VENCIDO sozinho.
  - Reajuste e renovação são gravados e nunca usados.
  - Encerrar/cancelar não cancela OS AGENDADA futuras nem contas PREVISTO.
  - Mudar o **número** do contrato recria todas as previsões (duplicadas).
  - Mudar o valor não atualiza as previsões existentes.
  - BD recomendável (junto com C6).
- **I20. "Parar lembrete se visualizado" nunca funciona.**
  - `visualizadoEm` só é gravado por `api/publico/orcamentos/[token]`, que nenhuma tela chama; o cliente que já abriu continua recebendo lembretes.
  - Essa rota pública devolve o orçamento inteiro, incluindo CPF e assinatura de quem assinou.
  - **(a confirmar):** o cron da Vercel só autentica se `CRON_SECRET` estiver definida no projeto; sem ela, os lembretes nunca rodam.

### Financeiro
- **I21. Editar medição apaga vínculos dos itens → o orçamento volta a ser cobrado.** `components/medicao/medicao-form.tsx:125-133` não envia `orcamentoId`/`ordemServicoId`/dados fiscais e o PUT faz `deleteMany` + create (`api/medicoes/[id]/route.ts:66`).
- **I22. Medição: estados inconsistentes.**
  - "Registrar pagamento" antes da aprovação marca PAGO mas não cria conta a receber; o recebimento não aparece no financeiro.
  - Cancelar não cancela o boleto.
  - DELETE apaga medição em qualquer status (conta e relatório ficam órfãos).
  - Arquivo: `api/medicoes/[id]/acao/route.ts:103-145`.
- **I23. Boleto do Inter fica ativo depois de cancelar ou quitar manualmente a conta.**
  - Risco de pagamento em dobro.
  - Também é possível emitir boleto para conta CANCELADA/RECEBIDA e editar o valor depois de emitir.
  - Arquivos: `api/contas-receber/[id]/route.ts`, `[id]/boleto/route.ts:32`.
- **I24. Pedido de compra: valor real e fornecedor nunca são preenchidos.**
  - Não há rota/UI para isso (`pedidoCompraItemUpdateSchema` não é usado).
  - A conta a pagar sai com o valor estimado e "Fornecedor a definir", mesmo de pedido cancelado.
  - Status aceita qualquer transição.
- **I25. (a confirmar) Medição de relatório de cliente FATURA_UNICA fica presa em RASCUNHO** e bloqueia a geração do mês desse cliente (`financeiro-server.ts:96-150` × `gerar-mes`).

### Cadastros e Configurações
- **I26. Salvar o cliente desliga o portal recém-concedido.**
  1. Conceda acesso ao portal a um contato (a API liga `portalAtivo` no banco).
  2. Clique em Salvar no formulário (que ainda tem `portalAtivo=false`) → o contato não consegue logar.
  - Arquivos: `components/forms/cliente-form.tsx:142,241`.
- **I27. Não há gestão de usuários do sistema.**
  - Não dá para criar usuário, desativar ou redefinir senha pela tela (só existe o seed).
  - O campo "Perfil de acesso" do colaborador não controla nada (colaborador não tem login), mas dá a impressão de que controla.
- **I28. Respostas pesadas (imagens base64 em listas).**
  - `GET /api/equipamentos` traz as fotos de todos os equipamentos do cliente (usado na Nova OS e no Orçamento).
  - O form de Equipe chama `/api/veiculos` sem `?resumo=1` (todas as fotos).
  - `GET /api/tecnicos` traz o avatar de todos.
  - Logo do cliente (até 2,7 MB) por linha em OS, Orçamentos, Contratos e Contas.
  - Deixa as telas lentas no celular.
- **I29. Supervisor vê o select de perfil vazio no form de colaborador** (`/api/perfis-acesso` exige `configuracoes.visualizar`).
- **I30. Documentos de colaborador e veículo são apagados e recriados a cada salvar** (`deleteMany` + create em `tecnicos/[id]` e `veiculos/[id]`). Os 3 MB de anexos trafegam em todo PUT; perde ids e datas.

### Funcionalidade: PMOC
- **I31. PMOC hoje é rótulo, não funcionalidade.** Todo relatório geral de OS sai com o título "RELATÓRIO DE MANUTENÇÃO — PMOC" (`lib/relatorio-server.ts:87`, `lib/utils.ts:567`), até corretiva de cliente sem contrato, o que é enganoso num documento técnico.
  - **Existe:** ART/RT no contrato, checklists por tipo de equipamento, recorrência preventiva por local, seção "PMOC" no portal.
  - **Falta** (Lei 13.589/2018, Portaria MS 3.523/98, RE ANVISA 09/2003, NBR 13971):
    - entidade **Plano PMOC** por cliente/unidade (ambientes, área, ocupantes, carga térmica, RT/ART, vigência);
    - **cronograma por equipamento × tarefa** com periodicidade própria;
    - **execução amarrada ao plano** (previsto × executado);
    - **relatório PMOC consolidado** assinado pelo RT;
    - **laudos semestrais de qualidade do ar**;
    - **alerta de ART vencendo** (`artVencimento` não é lido em lugar nenhum).
  - É uma feature nova, não um bug (BD: novos modelos).
  - Correção imediata e barata: só usar o título PMOC quando o contrato tiver PMOC.

### Infra
- **I32. Sem rede de segurança automática.** Não há testes, CI, ESLint configurado nem migrations. Toda mudança de schema depende de alguém lembrar de rodar o SQL certo em produção.

---

## 🟢 Leves

**OS / execução**
- **L1. A tela de execução não conclui a atividade.** Não tem botão de iniciar/concluir nem campo de resumo. Também não bloqueia edição de atividade concluída/cancelada (nem na API).
- **L2. O campo "ASSINATURA" do formulário é um input de texto.** Grava o nome digitado, não uma assinatura desenhada; o canvas só existe no aceite público.
- **L3. "Obrigatório para concluir" só é validado no cliente.** O servidor conta linhas, inclusive respostas nulas.
- **L4. Atribuição errada:** `respondidoPorId` grava o responsável da atividade, não quem respondeu; `feitoPorId` nunca é preenchido.
- **L5. Rota `POST /api/ordens/[id]/atividades/[atividadeId]/respostas` está sem uso.** Não valida formulário por empresa e quebra com body inválido. Remover ou validar.
- **L6. Entrada inválida derruba com 500:** `/ordens?status=XYZ`, `?dataInicio=abc`, parâmetros repetidos, status/prioridade inválidos no PUT da OS/atividade.
- **L7. Nova OS:** o front aceita descrição com menos de 5 caracteres e a API devolve "Dados inválidos" sem dizer o campo.
- **L8. "Abrir OS" pela ficha do equipamento não vincula o equipamento à OS** (só escreve na descrição).
- **L9. Solicitação aceita cria atividade sem tipo de OS** → formulários obrigatórios nunca se aplicam.
- **L10. Prazos:**
  - EMAIL/SISTEMA nunca notificam;
  - `notificacaoEnviada=true` mesmo sem telefone;
  - link do cliente aponta para a tela interna;
  - `window.open` depois de `await` é bloqueado como pop-up;
  - ATRASADO só aparece depois de abrir o dashboard.
- **L11. Botões de Financeiro/Itens da OS aparecem sem checar permissão e engolem erros** (`catch {}`). Itens não têm editar nem excluir.
- **L12. Estado local não atualiza depois de `router.refresh()`** (`OsDetalhe`, `OsAtividades`, `OsAnexos`): contadores ficam desatualizados.
- **L13. Concluir a OS pelo select não exige atividades concluídas;** reabrir não limpa `dataConclusao`.
- **L14. Arrastar no calendário move só a 1ª atividade da OS no dia.**
- **L15. Atividade aceita equipamento de outro cliente (mesma empresa);** remover o vínculo deixa respostas órfãs.

**Comercial / financeiro**
- **L16.**
  - `enviar` deixa um orçamento CONVERTIDA/REPROVADA voltar a ENVIADO.
  - Aprovação pública sem trava atômica (duplo clique aprova duas vezes).
- **L17. Numeração por ordenação de texto:** contrato com 3 dígitos quebra depois de `CT-AAAA-999`; OS/MED/ORC depois de 9999 por ano.
- **L18. Periodicidade SEMANAL/QUINZENAL selecionável no contrato,** mas tratada como mensal.
- **L19. Contratos:**
  - `gerar-os` cria OS para contrato em qualquer status;
  - PUT/DELETE de contrato mudam o status sem gravar histórico.
- **L20. Conta a pagar:**
  - aceita pagamento acima do saldo;
  - não há estorno;
  - aceita edição de conta cancelada.
- **L21. Edição de contrato passa `Decimal` do Prisma direto ao componente cliente** (aviso no console).

**Cadastros / configurações / layout**
- **L22. Breadcrumb com links 404** (`/clientes/{id}`, `/compras`, `/configuracoes/financeiro`…) e id cru no lugar do nome (o regex não reconhece cuid).
- **L23. `components/forms/tecnico-form.tsx` é código morto.**
- **L24. Duplicidade (CPF/CNPJ, placa, CPF do colaborador, código do QR) checada antes de gravar, sem tratar a corrida** → 500 raro em vez de 409.
- **L25. Senha do portal:**
  - gerada com `Math.random`;
  - mínimo de 4 caracteres;
  - revogar não apaga a provisória;
  - trocar e-mail do contato não checa duplicidade de acesso.
- **L26. Trocar o e-mail de login no Perfil não pede a senha atual.** O avatar base64 é lido em todo render do layout.
- **L27. Salvar a equipe e vincular veículos não é atômico** (fora de transação).

---

## Schema do Prisma × banco de produção

O que foi checado e o que fica pendente:

1. **Código × schema:** o TypeScript compila sem erros, então todo campo usado no código existe no `schema.prisma`.
2. **Schema × produção:** não dá para ver do código. As 4 mudanças mais recentes de schema (05–06/10) têm script em `prisma/sql/`. As anteriores foram aplicadas com `db push`, e só o banco diz se estão lá.
3. **Como confirmar em 1 minuto:** rode **`docs/sql/verificar-schema-producao.sql`** no banco de produção.
   - É somente leitura: compara as 964 colunas, 74 tabelas e 62 enums que o código espera com o `information_schema`.
   - **Resultado vazio = tudo certo.**
   - Qualquer linha que aparecer é uma tela que vai dar *server-side exception* quando tocar naquele campo.
4. Daqui pra frente, o CI vai checar que toda mudança em `schema.prisma` venha acompanhada de um `.sql` em `prisma/sql/` (ver testes).

---

## Plano de correção em levas

Regras:
- um PR por leva;
- cada um pequeno (≈ 1 tema, poucos arquivos);
- **as levas com BD trazem o `.sql` idempotente em `prisma/sql/`, que você roda antes do merge**;
- cada leva, a partir da T0, entra junto com os testes que provam a correção.

| # | Leva | Itens | BD? |
|---|---|---|---|
| **0** | **Checagens sem código** (você): rodar `verificar-schema-producao.sql`; confirmar `CRON_SECRET` na Vercel; listar usuários sem perfil (consulta de leitura que eu escrevo) | C13, I20, apoio a C3 | só leitura |
| **1** | **Segurança urgente — anexos:** lista branca de MIME, headers `nosniff`/`sandbox`, só imagem/PDF inline (OS, cliente, contrato, portal) | C1 | não |
| **2** | **Segurança urgente — contas e senhas:** `select` sem senha nos contatos; senha mostrada uma vez; "sem perfil" = nada; bloquear autoedição e escalada em Usuários | C2, C3 | não (limpeza opcional de `senha_provisoria`) |
| **T0** | **Esqueleto de testes + CI:** Playwright, seed E2E, workflow do GitHub, ESLint, smoke de todas as páginas | I32 | não |
| **3** | **RBAC — comercial:** `exigirPermissao` em orçamentos (+ whitelist de status), contratos, pedidos de compra | C4 (parte), C5 | não |
| **4** | **RBAC — cadastros e config:** unidades, QR, tabelas de preço, serviços, produtos, tipos, templates, formulários, checklists, logo, técnicos (GET sem salário/CPF), localização, os-prazos | C4 (resto) | não |
| **5** | **Rotas e menu:** `ROTA_MODULO` com `leads-site`/`compras`, link de checklists, menu mobile, configurações por permissão em vez de role, `SUPER_ADMIN` | I3, I5 | não |
| **6** | **Crashes rápidos:** salvar Configurações; aba Financeiro da OS; editar formulário/template já usado (diff em vez de recriar) | C8, C9, C10 | não |
| **7** | **Faturamento da OS sem duplicidade:** `osJaFaturada()` única; aprovação de relatório só fatura com valor; trava na inativação | C7 | não |
| **8** | **Contas a receber sem duplicidade:** vínculo contrato+período, cancelar prevista ao faturar, PREVISTO fora da inadimplência, vencimento correto do orçamento + **script de limpeza** (você revisa a prévia antes) | C6 | **sim** |
| **9** | **Ciclo do contrato:** recorrência por local contínua + cron; converter orçamento gera OS/previsão e respeita PC; vigência no `gerar-mes`; encerrar cancela futuros | C11, I18, I19 | não (usa o BD da leva 8) |
| **10** | **Medições:** editar sem perder vínculos; pagamento antes da aprovação; delete só em RASCUNHO | I21, I22, I25 | não |
| **11** | **Boleto/Inter:** cancelar boleto ao cancelar/quitar; bloquear emissão indevida; webhook confirma no Inter; segredo fora do GET | I2, I23 | não |
| **12** | **Fuso horário + hidratação:** utilitário único America/Sao_Paulo; calendário, solicitações, atividades, previsão, validade do orçamento | I8, I9 | não (+ consulta para achar registros deslocados) |
| **13** | **Execução em campo:** carregar respostas salvas e não sobrescrever; scanner; concluir pela tela de execução; bloquear edição de concluída | I10, I17, L1, L3, L4 | não |
| **14** | **Portal e QR:** relatório de atividade por token; QR "só logado" funcionando; QR inativo; rate limit; histórico/anexos internos ocultos; compressão de fotos | C12, I12, I13, I14 | talvez (flag `publico`) |
| **15** | **Isolamento entre empresas:** `garantirDaEmpresa()` em todos os ids relacionados | I1 | não |
| **16** | **Numeração:** helper de próximo número com retry (OS, medição, relatório, pedido, chamado, contrato, QR) + tratar duplicidade como 409 | I15, L17, L24 | opcional (unique em `chamado_numero`) |
| **17** | **Edição da OS** (tela que falta) | I11 | não |
| **18** | **Usuários e sessão:** criar/desativar/redefinir senha; permissões recarregadas no JWT; login do portal entre empresas | I4, I6, I27 | não |
| **19** | **Desempenho e cache:** `select` sem imagens nas listas; imagens sob demanda; PWA sem cache de `/api` + limpeza no logout | I7, I28 | não |
| **20** | **Cadastros pontuais:** portal desligado ao salvar cliente; perfis para supervisor; documentos com diff; equipe atômica | I26, I29, I30, L27 | não |
| **21+** | **PMOC de verdade** (plano, cronograma, execução, relatório, laudos, alerta de ART). Antes disso, título PMOC só quando houver contrato PMOC. | I31 | **sim** |
| — | **Leves restantes:** distribuídos nas levas do mesmo módulo, ou um PR "varredura" por módulo no fim | L* | não |

Ordem pensada para fechar primeiro o que é **segurança** (1–5), depois o que **quebra tela** (6), depois **dinheiro** (7–11), depois **agenda e campo** (12–14), e por último robustez e evolução.

---

## Proposta: bateria de testes automáticos (Playwright)

### Como roda no CI
- **Workflow:** `.github/workflows/ci.yml`, em todo `pull_request` e `push` na `main`.
- **Job `checks` (~2 min):**
  - `npm ci`
  - `prisma validate`
  - `tsc --noEmit`
  - `eslint`
  - **guarda de schema:** se o PR muda `prisma/schema.prisma` e não adiciona arquivo em `prisma/sql/`, falha com a mensagem "inclua o SQL da produção".
- **Job `e2e` (~8–12 min, dividido em 2–3 shards):**
  - Postgres 16 como *service container* do GitHub Actions: um banco **descartável** criado a cada execução, nunca o de produção.
  - `prisma db push` + `prisma/seed-e2e.ts` com dados fixos:
    - **duas empresas (A e B)** para testar isolamento;
    - um usuário por perfil (Admin, Supervisor, Financeiro, Técnico, Auxiliar);
    - um contato de portal;
    - cliente com unidades;
    - equipamentos com QR;
    - contrato mensal, tipos de OS e formulário.
  - `next build && next start` via `webServer` do Playwright.
  - Servidor em **TZ=UTC** (igual à Vercel) e navegador com `timezoneId: "America/Sao_Paulo"`, `locale: "pt-BR"`: é isso que pega os bugs de fuso.
  - Serviços externos **mockados**:
    - Banco Inter, Resend (e-mail), Anthropic (OCR), BrasilAPI (CNPJ) e geocodificação, via `page.route` ou variáveis apontando para um stub local;
    - nenhuma chamada real sai do CI.
  - **Login uma vez por perfil** no `globalSetup` (`storageState`), para os testes não repetirem o login.
  - **Dois projetos:** `desktop-chromium` e `mobile` (Pixel 7) para o fluxo do técnico em campo.
  - **Falha = trace, screenshot e vídeo** anexados ao PR.
  - **Proteção de branch:** `checks` e `e2e` obrigatórios para mergear.
- **Noturno (cron do Actions):** a suíte completa em mobile + desktop.
- **Bugs conhecidos:** cada bug ainda aberto pode entrar como `test.fail()` com o código do item (ex.: `// C9`). Quando a leva corrige, o teste passa a ser normal.

### Guardas globais (valem em todo teste)
- Qualquer `pageerror`, `console.error` (inclui hidratação) ou resposta **5xx** durante o teste → falha.
- **Smoke de todas as páginas:** lista gerada a partir de `app/**/page.tsx`. Cada página abre como Admin sem 500 e sem erro no console (pega *server-side exception* e coluna faltando no banco).

### Fluxos cobertos

| Suíte | O que prova | Itens que protege |
|---|---|---|
| `rbac.spec` | Matriz perfil × página (espera `/sem-permissao`) **e** perfil × API de escrita (espera 403). Usuário da empresa B acessando ids da empresa A (espera 404). | C3, C4, C5, I1, I3, I5 |
| `seguranca.spec` | Upload de HTML/SVG recusado; download com `nosniff`; `/relatorio/atividade/<id>` sem token = 404; contatos sem `senha`; webhook forjado não baixa conta | C1, C2, C12, I2 |
| `cadastros.spec` | Cliente: criar, editar, inativar + unidade + contato com acesso ao portal (e o portal continua ativo após salvar); equipamento + QR; veículo; colaborador; equipe com veículos | I26, I30, L24 |
| `os.spec` (desktop + mobile) | Nova OS → atividade com técnicos/equipe/veículo → executar (marcar equipamentos, responder formulário, anexar foto, reabrir e ver respostas salvas) → concluir → relatório público → aprovar com assinatura → **exatamente 1** medição | C7, C8, I10, I11, L1 |
| `calendario.spec` | Atividade das 14:00 aparece às 14:00 no dia certo; arrastar reagenda corretamente; 22:00 não pula de dia | I8, I9, L14 |
| `solicitacoes.spec` | Login no portal → chamado com 3 fotos → aparece na gaveta → aceitar → OS no horário escolhido; QR público abre chamado; QR inativo não abre | I12, I14, L9 |
| `comercial.spec` | Orçamento → enviar → página pública (no último dia de validade ainda aprova) → assinar → converter em contrato → OS recorrentes e previsão criadas → **sem contas duplicadas** | C5, C6, C11, I18, I20 |
| `financeiro.spec` | Gerar medições do mês → aprovar → 1 conta a receber → boleto (mock) → webhook RECEBIDO → baixa; cancelar conta cancela boleto; cliente pagando em dia ≠ inadimplente | C6, I21–I23 |
| `config.spec` | Salvar Configurações; editar formulário já respondido; editar template de checklist já usado; perfis e usuários | C9, C10, I27 |

### Primeiro passo (leva T0)
- Playwright, seed E2E, workflow e ESLint.
- Duas suítes iniciais: **smoke de páginas** + **rbac**, as que mais pegam problema com menos código.
- As demais entram junto com a leva que corrige cada módulo, para cada PR já chegar com o teste que impede o bug de voltar.

---

## Apêndice A — handlers de API sem checagem de permissão

Gerado por varredura: handlers sem `exigirPermissao`, `exigirAlgumaPermissao` ou `pode(`. Todos exigem login.

**Esperado (público ou próprio usuário):**
- `auth`, `portal-auth`
- `publico/*`, `qr/[token]/chamado`
- `webhooks/inter`, `email/processar-lembretes`
- `perfil/*`, `push/subscribe`, `alertas`, `cnpj/[cnpj]`

**Precisam de RBAC:**

| Rota | Métodos |
|---|---|
| `contratos`, `contratos/[id]`, `contratos/[id]/status`, `contratos/[id]/anexos/**`, `contratos/proximo-numero` | todos |
| `orcamentos` | GET, POST |
| `orcamentos/[id]/enviar`, `orcamentos/[id]/gerar-contrato` | POST |
| `orcamentos/[id]` | PUT só com `{status}` |
| `pedidos-compra`, `pedidos-compra/[id]` | todos |
| `os-prazos/[id]`, `os-prazos/[id]/avancar` | DELETE, POST |
| `unidades`, `unidades/[id]` | todos |
| `qrcodes`, `qrcodes/[id]` | todos |
| `tabelas-preco/**`, `servicos/**`, `produtos/**`, `tipos-os/**`, `tipos-problema/**` | todos |
| `formularios/**`, `termo-templates/**`, `prazo-templates/**` | todos |
| `checklist-templates/**`, `checklists` | todos |
| `tipos-equipamento/[id]/formularios/**` | todos |
| `configuracoes`, `configuracoes/qr-code`, `empresa` | checam `role` em vez de permissão |
| `empresa/logo` | PUT, DELETE |
| `tecnicos/[id]/localizacao`, `tecnicos/proximos` | todos |
| `tecnicos/[id]` | GET (dados pessoais) |
| `cargos`, `categorias-financeiras`, `tecnicos`, `tipos-equipamento` | só o GET da raiz (leitura de listas; baixo risco) |
