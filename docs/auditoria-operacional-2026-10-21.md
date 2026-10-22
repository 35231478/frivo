# Auditoria operacional do Frivo — 21/10/2026 (rodada 2)

> **Só diagnóstico.** Nenhuma correção foi feita nesta rodada.
> Base auditada: `master` em `5b2543c` (após os PRs #44–#51: relatório da OS, auth, token do relatório de atividade, estoque E1/E2/E2.1, folha, execução da OS Etapa 1 e app do técnico Etapa 2).
> Substitui a auditoria de 06/10/2026 (`docs/auditoria-operacional.md`), que fica como referência histórica.

## Como foi feita

1. **Leitura de código** módulo a módulo (8 varreduras independentes), cobrindo as ~194 rotas de API e as ~100 páginas.
2. **Navegação real** num servidor local (`next start`) com o banco de demonstração: as **91 páginas** do painel foram abertas como Admin, registrando HTTP ≥ 400, erros de console e erros visíveis.
3. **Sondas de API autenticadas** (admin × técnico) para os itens de dinheiro e permissão: faturar a mesma OS 2×, gerar o mês 2×, aprovar medição, baixar conta 2× ao mesmo tempo, ler segredos, agir fora do perfil.
4. Itens confirmados ao vivo estão marcados **(provado ao vivo)**.

- 🔴 **Crítico** — perde/duplica dinheiro, vaza dado sensível, brecha explorável, ou fluxo principal inutilizável.
- 🟡 **Importante** — fluxo pela metade, dado errado em caso comum, brecha com conhecimento interno.
- 🟢 **Leve** — incômodo, caso raro, inconsistência.
- **BD** = a correção precisa de SQL em `prisma/sql/` (você roda antes do merge, como sempre).

### Placar

| | 🔴 Críticos | 🟡 Importantes | 🟢 Leves |
|---|---|---|---|
| **Achados novos** | **25** (S1–S3, F1–F5, CO1–CO4, OS1–OS3, E1–E4, P1–P4, CA1, T1) | **74** | 10 blocos (≈50 apontamentos) |
| **Antigos ainda abertos por inteiro** | 5 de 13 (C6, C7, C8, C9, C11) | 22 de 32 | 14 de 27 |
| **Antigos resolvidos pela metade** | 2 (C1, C13) | 5 (I1, I3, I4, I15, I24) | 11 |
| **Antigos corrigidos** | 6 (C2, C3, C4, C5, C10, C12) | 5 (I10, I27, I28, I29, I32) | 2 (L3, L15) |

As 10 mais urgentes estão no fim do documento, antes do plano de levas.

---

## Reconciliação — o que sobrou da auditoria de 06/10

O smoke de 91 páginas não achou **nenhum 500** — as telas quebradas da rodada 1 (C13 etc.) foram fechadas. Dos 13 críticos antigos, **6 foram corrigidos, 6 continuam e 1 ficou parcial**; dos 32 importantes, a maioria dos de **segurança** foi fechada e a maioria dos de **financeiro/comercial** continua aberta.

| Item antigo | Status hoje | Evidência |
|---|---|---|
| C1 anexo executa script (XSS) | **PARCIAL** | anexos de OS/portal corrigidos (bytes + nosniff + sandbox, `lib/anexos-server.ts:62-81`); anexos de cliente/contrato ainda voltam como data URL para iframe sem sandbox (`anexos-manager.tsx:84-95`); e a falha **voltou** em foto de equipamento/veículo e avatar (ver R1) |
| C2 senha do portal exposta nos contatos | **CORRIGIDO no código (provado ao vivo)** | `contatoSeguro` em todas as saídas; `senhaProvisoria` gravada null a cada alteração. Pendência **BD**: nenhum SQL limpou as senhas em texto já gravadas em `senha_provisoria` |
| C3 "sem perfil" = acesso total; autoedição | **CORRIGIDO** | sem perfil = só dashboard (`lib/permissoes.ts:124-134`); travas de autoedição/escalada em `lib/cadastros/especificos.ts:158-188` |
| C4 ~60 handlers sem RBAC | **CORRIGIDO na quase totalidade** | sondas: técnico levou 403 em `DELETE tabelas-preco`, `GET tecnicos/[id]`, PUT orçamento; resto no Apêndice A. Sobra: `pedidos-compra/[id]` (ver M-seção compras) |
| C5 orçamento aceita qualquer status | **CORRIGIDO** (2 ressalvas) | whitelist em `app/api/orcamentos/[id]/route.ts:42-76`; ressalvas: `status:"constructor"` → 500 (`:64`); `orcamentos.aprovar` segue sem uso — não há aprovação manual |
| C6 receita duplicada (PREVISTO × medição × orçamento) | **AINDA VALE** | `lib/financeiro-server.ts:183-250` cria PREVISTO sem vínculo; nada quita/cancela ao faturar; `STATUS_EM_ABERTO` inclui PREVISTO (`lib/status-financeiro.ts:12`); banco segue sem `contratoId`/`periodo` |
| C7 mesma OS faturada 2–3× | **AINDA VALE (provado ao vivo)** | OS concluída aceitou `gerar-medicao` 201+201 e `gerar-medicao-completa` 201 → 3 medições (2 de R$ 0) + conta a receber de R$ 0 |
| C8 aba Financeiro da OS quebra ao gerar medição | **AINDA VALE** | `app/api/ordens/[id]/medicoes/route.ts:32-38` (create sem include) × `components/os/os-financeiro.tsx:68` |
| C9 "Salvar configurações" sempre 400 | **AINDA VALE** | form envia o objeto Prisma inteiro (`configuracoes-client.tsx:62,133`) × schema `.strict()`; `qrConfig`/`relatorioOsConfig` sobram → 400 sempre. Agravante: das 21 chaves da tela, só 1 é lida (CA2) |
| C10 formulário/checklist travam após o 1º uso | **CORRIGIDO** | diff + zod + RBAC em `app/api/formularios/[id]/route.ts:31-59`, `checklist-templates/[id]:26-71`, `tipos-equipamento/[id]/checklist:46-73` |
| C11 recorrência por local para nas 12 primeiras | **AINDA VALE** | `lib/recorrencia-server.ts:114,150-159`; sem cron; botão do calendário só trata a recorrência antiga |
| C12 relatório de atividade público pelo id | **CORRIGIDO** (PR #48) | token obrigatório de 32 bytes, 404 uniforme |
| C13 telas dependem de SQL manual | **PARCIAL** | toda coluna nova tem SQL em `prisma/sql/`, e o CI exige; mas já são 7+ scripts encadeados e `docs/sql/verificar-schema-producao.sql` está desatualizado (não cobre checklist_respostas, fotos_atendimento, servicos_adicionais, sync_operacoes, token_relatorio, relatorio_os_config) |
| I1 ids de outra empresa no body | **PARCIAL** | a maioria validada (`validarRefEmpresa`); sobram: medição (`clienteId/contratoId/ordemServicoId/orcamentoId`), conta a pagar (`pedidoCompraId`), pedido (`compradorId`), POST/PUT da OS (`unidadeId/contratoId/responsavelId`), veículo (`responsavelId/equipeId`) — ver F7/F8/OS12/CA10 |
| I2 webhook Inter + segredo exposto | **AINDA VALE (provado ao vivo)** | `GET /api/integracoes/inter` devolve `webhookSecret`; webhook autentica só pelo `?token`, baixa CANCELADA, não confere valor nem consulta o Inter |
| I3 menu × middleware desalinhados | **PARCIAL** | gaveta mobile corrigida; continuam: `leads-site` e `compras` fora de `ROTA_MODULO`, link de Checklists da Frota, menu inferior sem filtro (`mobile-bottom-nav.tsx:8-13`) |
| I4 permissões congeladas no JWT | **PARCIAL** | inativação/troca de senha derrubam a sessão (`lib/sessao-ativa.ts:38-48`); permissões/role/perfil continuam congelados no login, e os textos da tela prometem o contrário (`especificos.ts:89`) |
| I5 configurações por role em vez de permissão | **AINDA VALE** | PUT configuracoes/empresa/qr-code exigem role (`configuracoes/route.ts:54`); `pode()` não reconhece SUPER_ADMIN (`lib/permissoes.ts:111`) |
| I6 login ambíguo entre empresas | **AINDA VALE** | `lib/auth.ts:49-57` e `lib/auth-portal.ts:36-44` buscam só por e-mail |
| I7 cache PWA de /api e dados de outro usuário | **AINDA VALE (e piorou)** | `/api/*` segue NetworkFirst 3s/24h — inclusive `/api/auth/session`; nenhum Sair limpa o Cache Storage/IndexedDB; os caches `pages` do `swe-worker` nunca expiram; só `/api/tecnico/*` saiu do cache |
| I8 fuso horário (calendário, solicitações, atividades) | **AINDA VALE (provado ao vivo)** | a mesma atividade aparece **12:00 no calendário e 09:00 no app do técnico**; `lib/fuso.ts` existe mas só o app do técnico usa |
| I9 hidratação por datas SSR | **AINDA VALE (provado ao vivo)** | React #418 em `/contratos`, `/equipamentos`, `/ordens`, `/ordens/[id]` no smoke |
| I10 formulário sobrescrevia respostas | **CORRIGIDO** | rota `grupos/respostas` removida; gravação incremental (`lib/execucao/acoes.ts`) |
| I11 não existe edição da OS | **AINDA VALE (provado ao vivo)** | `/ordens/[id]/editar` redireciona para o detalhe; o PUT aceita campos que nenhuma tela envia |
| I12 QR: "só logado" quebrado, QR inativo abre chamado | **AINDA VALE** | `app/api/qr/[token]/chamado/route.ts:47`; `qrcode.ativo` não é lido; sem rate limit |
| I13 portal mostra histórico interno da OS | **AINDA VALE** | `portal/(protegido)/chamados/[id]/page.tsx:22-28` |
| I14 fotos do chamado estouram 4,5 MB | **AINDA VALE** | `chamado-form.tsx:27-38` sem `reduzirImagem` |
| I15 numeração com colisão | **PARCIAL** | OS do portal/QR corrigidas; continuam: POST /api/ordens, medição `count()+1`, relatório, pedido, recorrência, contrato |
| I16 excluir item da OS apaga item medido | **AINDA VALE** | `orcamento/[itemId]/route.ts:46-57` + `onDelete: Cascade` |
| I17 scanner reinicia a câmera | **AINDA VALE** | `scanner-qr.tsx:47` com callback inline nos 2 chamadores |
| I18 converter em contrato não liga as pontas | **AINDA VALE** | `gerar-contrato/route.ts:57-100` |
| I19 contrato encerrado continua faturando | **AINDA VALE** | `gerar-mes:26-29` só olha status ATIVO; nada vira VENCIDO; encerrar não cancela futuros |
| I20 visualizadoEm/lembretes; rota pública com CPF | **AINDA VALE** | `publico/orcamentos/[token]/route.ts:34-38` |
| I21 editar medição apaga vínculos | **AINDA VALE** | `medicao-form.tsx:125-133` + PUT `deleteMany` |
| I22 medição: estados inconsistentes | **AINDA VALE** | pagamento antes da aprovação; cancelar não cancela boleto; DELETE em qualquer status |
| I23 boleto ativo após cancelar/quitar | **AINDA VALE** | PUT não chama `cancelarBoletoInter`; emite para PREVISTO |
| I24 pedido de compra sem valor real/fornecedor | **PARCIAL** | NF vinculada preenche `valorReal` (`lib/compras/notas.ts:460-474`); conta do pedido segue com estimado ד Fornecedor a definir", em qualquer status |
| I25 medição RASCUNHO bloqueia gerar-mes | **AINDA VALE, mais amplo** | qualquer medição MENSAL_FIXO do mês (inclusive a de relatório R$ 0) faz o gerar-mes pular o cliente |
| I26 salvar cliente desliga o portal | **AINDA VALE** | o form reenvia `portalAtivo` antigo (`cliente-form.tsx:145,243`) |
| I27 sem gestão de usuários | **CORRIGIDO** (ressalvas) | tela com criar/convite/editar/inativar/reativar; ressalvas: sem e-mail configurado não há como redefinir senha de quem já entrou; e-mail não editável; "perfil de acesso" do colaborador segue decorativo com dica enganosa |
| I28 respostas pesadas (base64 em listas) | **CORRIGIDO (provado ao vivo)** | `/api/equipamentos` 35 KB, `/api/tecnicos` 3 KB, sem base64 |
| I29 supervisor com select de perfil vazio | **CORRIGIDO** | `perfis-acesso.listar` aceita `equipes.gerenciar` (`registro.ts:256`) |
| I30 documentos recriados a cada salvar | **AINDA VALE** | `deleteMany`+create em `tecnicos/[id]:104-113` e `veiculos/[id]:69-77` (e itens de tabela de preço/etapas de prazo trocam de id) |
| I31 PMOC é rótulo | **AINDA VALE** (sem mudança desde 06/10; segue como feature futura) | |
| I32 sem testes/CI | **CORRIGIDO** | CI com typecheck + 1028 testes (PostgreSQL real) + guarda de schema×SQL |
| L1 execução não conclui | **PARCIAL** | tela do escritório tem Concluir; falta resumo/iniciar (o app do técnico tem) |
| L2 assinatura é input de texto | **AINDA VALE** | `execucao-equipamento.tsx:267-268` |
| L3 obrigatório só no cliente | **CORRIGIDO** | `lib/execucao/pendencias.ts:82-85` |
| L4 respondidoPorId errado | **PARCIAL** | checklist grava quem respondeu; formulário do tipo ainda grava o responsável |
| L5 rota respostas sem uso | **PARCIAL** | continua órfã, sem zod, grava em concluída e sobrescreve `resumo` |
| L6 entrada inválida → 500 | **AINDA VALE** | `lib/listas/filtros.ts:16,45`; PUTs de OS/atividade |
| L7 descrição curta na nova OS | **AINDA VALE** | |
| L8 "Abrir OS" do equipamento não vincula | **AINDA VALE** | `equipamento-perfil.tsx:104-112` |
| L9 solicitação aceita sem tipo de OS | **AINDA VALE** | `aceitar/route.ts:10-23` |
| L10 prazos: notificações | **PARCIAL** | ATRASADO agora atualiza pelo sino; resto igual |
| L11 botões sem permissão + catch {} | **AINDA VALE** | os-financeiro, os-orcamento, os-relatorios |
| L12 estado local não atualiza | **AINDA VALE** | os-detalhe, os-atividades, os-adicionais |
| L13 concluir OS sem exigir atividades | **PARCIAL** | execução por equipamento é exigida; atividades CONCLUIDA não; reabrir não limpa dataConclusao |
| L14 arrastar move só a 1ª atividade | **PARCIAL** | card por dia; o PATCH segue movendo só uma |
| L15 equipamento de outro cliente na atividade | **CORRIGIDO** | `lib/execucao/vinculos.ts:8-22` |
| L16 enviar/aprovação pública | **PARCIAL** | enviar com whitelist; aprovação pública segue sem trava atômica |
| L17 numeração por texto | **PARCIAL** | ver I15 |
| L18 SEMANAL/QUINZENAL como mensal | **PARCIAL** | recorrência por local só mensal+; a cobrança do contrato ainda oferece e trata como mensal |
| L19 gerar-os em qualquer status | **AINDA VALE** | |
| L20 conta a pagar: pagar acima do saldo, sem estorno | **AINDA VALE** | `pagamentos/route.ts:29-45` |
| L21 Decimal cru para componente cliente | **AINDA VALE** | `contratos/[id]/editar/page.tsx:21-34` |
| L22 breadcrumbs 404 | **PARCIAL (provado ao vivo)** | prefetch 404 em `/clientes/[id]`, `/compras`, `/configuracoes/financeiro`, `/configuracoes/integracoes`, `/equipes/[id]`, `/veiculos/[id]`, `/ordens/[id]/atividades` |
| L23 tecnico-form.tsx morto | **AINDA VALE** | sem import |
| L25 senha do portal | **PARCIAL** | `randomInt` e revogar limpam; mínimo de 4 caracteres continua, e o login do portal segue sem limite de tentativas (ver R4) |
| L26 trocar e-mail sem senha atual | **AINDA VALE** | `app/api/perfil/route.ts:28-39` |
| L24 duplicidade sem tratar corrida | **AINDA VALE** | clientes, colaboradores, veículos, qrcodes, fornecedores, usuários checam antes de gravar sem tratar P2002 (só a importação trata) |
| L27 equipe + veículos fora de transação | **AINDA VALE** | `equipes/[id]/route.ts:77-86` (só o montador usa transação) |

---

## Achados — por módulo

> Numeração: **S** segurança · **F** financeiro/faturamento · **CO** comercial · **OS** ordens/execução/app · **E** estoque/compras · **P** custo de pessoal · **CA** cadastros/config · **T** transversal. Itens antigos reconfirmados aparecem pelo código antigo (C6, C7…).

---

### 1. Segurança e autenticação

- **🔴 S1. XSS armazenado voltou pelas fotos de equipamento, veículo e avatar do colaborador**
  - Onde: `GET /api/equipamentos/[id]/foto` (route.ts:30-32), `GET /api/veiculos/[id]/foto` (:30-32), `GET /api/tecnicos/[id]/avatar` (:24-25); gravação sem validação em `lib/validations.ts:211,335,371`.
  - Hoje: a rota devolve os bytes com o Content-Type tirado do prefixo do data URL gravado, sem `nosniff`, sem CSP; valor `https://…` vira redirect aberto. O preset Técnico tem `equipamentos.criar/editar`: um técnico grava a "foto" maliciosa e, quando um ADMIN abre a URL, o script roda com a sessão do ADMIN.
  - Esperado: a mesma regra já aplicada aos anexos de OS (validar pelos bytes ao gravar; servir por `respostaAnexo`).
  - Correção: validar com `TIPOS_IMAGEM` + servir pelo helper + limpar registros que não são imagem. **BD: sim** (limpeza).
- **🔴 S2. Webhook do Inter permite marcar boletos como pagos (I2 completo, provado ao vivo)**
  - Onde: `app/api/integracoes/inter/route.ts:37` + `app/api/webhooks/inter/route.ts:12-50`.
  - Hoje: quem tem só `configuracoes.visualizar` lê o `webhookSecret` no GET **(provado ao vivo)** e pode mandar `{situacao:"PAGO"}`: a conta vira RECEBIDO e a medição PAGO, sem conferir valor, status (baixa até CANCELADA) nem consultar o Inter.
  - Impacto: fraude financeira com conhecimento interno.
  - Correção: tirar o segredo do GET, girar o segredo, reconsultar a cobrança no Inter antes de baixar. BD: não.
- **🔴 S3. Login do portal do cliente sem limite de tentativas e com senha mínima de 4 caracteres**
  - Onde: `lib/auth-portal.ts:29-48`; `acesso-portal/route.ts:51`.
  - Hoje: rota pública sem `conferirBloqueio`; sem bcrypt fictício (o tempo de resposta revela se o e-mail tem acesso); o gestor pode definir senha "1234". Um anônimo adivinha a senha e vê financeiro, boletos e OS do cliente.
  - Correção: aplicar `lib/acesso/limite.ts` (a tabela já existe), hash fictício e mínimo 8. BD: não.
- **🟡 S4. Sessão do portal nunca é reconferida** — revogar acesso/inativar contato ou cliente não derruba o JWT de 30 dias (`lib/auth-portal.ts:18,69-77`). Correção: recarga do banco no callback, como o painel já faz. BD: não.
- **🟡 S5. Permissão `verOS` do portal não é aplicada** — agenda, chamados e dashboard do portal mostram OS a qualquer contato (`lib/validations.ts:55`; nenhuma página consulta). BD: não.
- **🟡 S6. Limite de tentativas do login interno burlável em paralelo** — o registro da tentativa acontece depois do bcrypt (`lib/auth.ts:46-60`); N requisições simultâneas passam. Se a tabela `tentativas_acesso` faltar, o limite é ignorado em silêncio (`limite.ts:56-58`). BD: não.
- **🟡 S7. Redirect aberto no login** — `login-form.tsx:24,56` aceita `callbackUrl=https://evil`. Aceitar só caminhos começando com `/` (e não `//`). BD: não.
- **🟡 S8. Não há 2FA** — nada de TOTP no sistema. Sugerido: TOTP opcional, obrigatório para `configuracoes.gerenciar`/financeiro. **BD: sim.**
- **🟡 S9. Troca de e-mail de login mal protegida (L26 ampliado)** — sem senha atual, sem confirmação do novo endereço, 409 revela e-mail de outra empresa, e grava sem minúsculas enquanto o login compara texto exato (a pessoa pode ficar sem entrar). `app/api/perfil/route.ts:28-39`. BD: não.
- **🟡 S10. Cron de lembretes disparável por qualquer ADMIN/GERENTE logado via GET, para todas as empresas** — e aceita `?secret=` na URL (fica em log). `processar-lembretes/route.ts:11-20`. Correção: só `Authorization: Bearer`. BD: não.
- **🟡 S11. Rotas públicas de chamado sem rate limit** — `POST /api/qr/[token]/chamado` (token impresso no equipamento) e `POST /api/portal/chamados`, sem limite nem `.max()` em descrição/nome: dá para encher a fila de OS. BD: não.
- **🟢 S12. `update()` da sessão aceita nome/e-mail do navegador** sem reler o banco (`auth.config.ts:37-40`) — falsifica o nome nos históricos. BD: não.
- **🟢 S13. Sem cabeçalhos de segurança globais** — sem CSP/frame-ancestors/referrer-policy (`next.config.ts` sem `headers()`). BD: não.
- **🟢 S14. Menores**: DELETE `/api/push/subscribe` apaga inscrição de outro usuário pelo endpoint (:41); `GET /api/fotos-atendimento/[id]` sem o escopo do técnico (:13); `GET /api/produtos` devolve `saldo`/`margemVenda` a qualquer logado; documentos de colaborador/veículo aceitam qualquer data URL e não têm onde ser abertos; portal sem "esqueci a senha"; bloqueio por e-mail permite travar a conta de um colega (5 erros/15 min); seed cria ADMIN com senha conhecida (não rodar em produção).

**OK verificado:** esqueci-senha sem enumeração (resposta única, limites por e-mail e IP) **(provado ao vivo)**; convite/recuperação com HMAC + uso único; troca de senha exige a atual e derruba as outras sessões; login interno com bcrypt fictício e bloqueio por e-mail+IP; sessão cai na hora para usuário/empresa inativados; cookies `__Secure-`/httpOnly/Lax; anexos de OS e fotos do atendimento validados pelos bytes e servidos com nosniff+sandbox; sem segredo real versionado.

---

### 2. Faturamento e financeiro (dinheiro)

Os críticos antigos **C6, C7, C8, I21–I25 e L20 continuam valendo** (ver reconciliação). Por cima deles:

- **🔴 F1. Faturar a OS tem 4 caminhos desconectados e cumuláveis (C7 provado ao vivo)**
  - Onde: `gerar-medicao/route.ts:19-39`, `gerar-medicao-completa/route.ts:33-46`, `publico/relatorios/[token]/aprovar/route.ts:36`, `ordens/[id]/medicoes/route.ts` (OsMedicao interna), `servicos-adicionais/[servicoId]` (Cobrar não gera nada).
  - Hoje **(provado ao vivo)**: numa OS concluída, `gerar-medicao` devolveu 201 duas vezes seguidas e `gerar-medicao-completa` mais 201 → 3 medições (2 de R$ 0) + conta a receber de R$ 0. O botão do cabeçalho fatura **todos** os itens (até não executados) e funciona em OS não concluída; a trava de um não enxerga a medição do outro; a aprovação pública de qualquer relatório cria medição de R$ 0 (A_RECEBER no perfil automático); a `OsMedicao` da aba Financeiro nunca vira conta e ainda bloqueia a inativação; o "Cobrar" do serviço adicional não gera cobrança.
  - Correção: uma função única `osJaFaturada()` + exigir OS concluída + aprovação de relatório só fatura `MEDICAO_COMPLETA`/valor > 0 + decidir o destino de `OsMedicao` (provavelmente remover). BD: não.
- **🔴 F2. "Gerar Medição" da aba Relatórios cobra a mensalidade inteira do contrato a cada OS**
  - Onde: `gerar-medicao-completa/route.ts:39-41` usa `contrato.valorMensal`.
  - Hoje: 3 preventivas no mês = 3 mensalidades + a PREVISTO do contrato + a medição do gerar-mes. Cobrança em dobro/triplo. BD: não.
- **🔴 F3. Qualquer medição MENSAL_FIXO do mês (até a de relatório R$ 0) cala o gerar-mes do cliente**
  - Onde: `lib/financeiro-server.ts:122-124` (medição de relatório nasce MENSAL_FIXO) × `gerar-mes/route.ts:54-67` ("já existe").
  - Hoje: um relatório de atividade R$ 0 aprovado faz a mensalidade do contrato **não ser faturada**, e a tela só diz "N ignorada(s)". Medição manual (tipo padrão MENSAL_FIXO) bloqueia igual (I25 ampliado). Receita perdida em silêncio. Correção: tipo próprio (ADICIONAL) e `jaExiste` olhando contrato/tipo. BD: não.
- **🔴 F4. Cancelar medição deixa orçamento e OS presos para sempre**
  - Onde: `gerar-mes/route.ts:103` e `gerar-medicao-completa/route.ts:33-36` contam itens/relatórios de medição CANCELADA.
  - Hoje: cancelou a medição → o orçamento some do gerar-mes e a OS devolve o token da medição cancelada ("jaExistia"). Nunca mais são cobrados. BD: não.
- **🔴 F5. Boleto do Inter sobre a conta PREVISTO + portal mostrando PREVISTO = cliente cobrado 2×**
  - Onde: `contas-receber/[id]/boleto/route.ts:27-34` (aceita PREVISTO) + C6 (PREVISTO × medição sem vínculo) + portal `financeiro/page.tsx:29` e `dashboard/page.tsx:24-31` (PREVISTO listada como "boleto em aberto"/"vencido").
  - Hoje: a PREVISTO do contrato e a conta da medição do mesmo mês aceitam um boleto cada; o cliente vê 12 meses de previsão como "boletos vencidos". Correção: não emitir para PREVISTO; portal só A_RECEBER/ATRASADO; e o BD do C6 (vínculo contrato+período). **BD: sim (o do C6).**
- **🟡 F6. Vencimento da medição cai no próprio mês de referência** — `lib/medicao-helpers.ts:50-60` com `diaFaturamento` padrão 1: medição de outubro aprovada dia 20 "vence" em 01/10, nasce ATRASADA, marca o cliente INADIMPLENTE e o Inter recusa a data. BD: não.
- **🟡 F7. Medição aceita ids de outra empresa** — PUT grava `clienteId` sem validar (devolve o cliente da outra empresa no GET), POST/PUT gravam `contratoId`/`ordemServicoId`/`orcamentoId` sem validar (`medicoes/route.ts:114,134-135`; `[id]/route.ts:62-63,79-80`) — trava o faturamento da outra empresa. BD: não.
- **🟡 F8. Conta a pagar: `pedidoCompraId` sem validação de empresa e sem trava de duplicidade** — `contas-pagar/route.ts:68`; dá para vincular pedido que já tem conta (2 dívidas) e consumir o pedido de outra empresa. BD: não.
- **🟡 F9. Pedido com conta CANCELADA fica travado** — `lib/compras/notas.ts:351-353` conta contas canceladas e bloqueia o lançamento da NF; a mensagem manda cancelar a conta, que já está cancelada. Sem saída. BD: não.
- **🟡 F10. Listas de contas cortadas** — `take: 500`/`take: 300` ordenando pelas MAIS ANTIGAS (`contas-receber/page.tsx:35-36`, `contas-pagar/page.tsx:60-61`): com histórico grande, as contas do mês somem e os cards somam só o recorte. BD: não.
- **🟡 F11. Fuso nas contas: vencimento D-1, "Vencido 1 dia" no próprio dia, ATRASADO gravado às 21h** — datas gravadas 00:00Z e exibidas no navegador (`contas-receber-view.tsx:41,241`; `lib/financeiro-status.ts:25-31`); `resumoFinanceiro`/páginas marcam ATRASADO com "hoje" UTC; WhatsApp/e-mail de cobrança saem com a data errada. A NF já grava 12:00Z — a mesma lista mistura as duas convenções. BD: não (opcional normalizar).
- **🟡 F12. "Valor recebido" é ignorado; não há recebimento parcial nem estorno** — o campo existe e não é enviado (`conta-receber-acoes.tsx:312-325`); baixa dupla via PUT passa sem conflito **(provado ao vivo)**; "Editar" disponível em conta RECEBIDA/CANCELADA. **BD: sim** (se houver parcial com histórico).
- **🟡 F13. Cancelar conta de medição não mexe na medição; boleto manual × boleto Inter são dois mundos** — `contas-receber/[id]/route.ts:53-59`. BD: não.
- **🟡 F14. Sincronizar boletos**: grava `dataRecebimento: new Date()` (não a do pagamento), baixa conta cancelada e `take:200` sem ordem (acima disso, parte nunca sincroniza) — `inter/sincronizar/route.ts:18-30`. E a "baixa automática" prometida não existe: `configurarWebhookInter` nunca é chamada. BD: não.
- **🟡 F15. Aprovação de medição sem trava atômica e conta sem unique** — duplo clique/corrida gera 2 contas com o mesmo número (`publico/medicoes/[token]/aprovar:22-42`; sem unique em `medicaoId`). **BD: sim** (unique).
- **🟡 F16. Dashboard × listas com números diferentes** — cards apontam para filtros que a lista não lê (`financeiro/page.tsx:18-19` × `contas-receber/page.tsx:13`); "a receber" tem 3 definições; ATRASADO nunca volta ao editar o vencimento. BD: não.
- **🟡 F17. Fluxo de caixa não tem saídas** — só lê `contaReceber` (com as PREVISTO duplicadas); contas a pagar e folha não entram (`fluxo-caixa/page.tsx:28-38`). BD: não.
- **🟡 F18. Conta a pagar paga pode ser cancelada sem estorno; boleto repetido em 2 contas não é detectado** — `conta-pagar-acoes.tsx:42`; sem índice/aviso pela linha digitável. BD: não (opcional índice).
- **🟢 F19. Leves**: `count+1` nas medições de OS → 500 com buraco de numeração; `cancelar()` sem `res.ok` (403 silencioso); data inválida → 500; menu "Mais ações" cortado pelo overflow; conta a receber não mostra a origem (dificulta achar duplicada); "Gerar Medição" sem checar permissão/status; `/financeiro/contas-bancarias` é "Em breve" no menu; `enviarLembreteVencimento`/`enviarMedicao` nunca chamados; e-mail "boleto emitido" sai sem link nem linha digitável (`lib/email.ts:214`); comprovante de pagamento gravado mas sem como ver.

---

### 3. Comercial (orçamentos, contratos, recorrência, portal/QR, leads)

Os antigos **C11, I12–I14, I18–I20, L9, L16–L19, L21 continuam** (ver reconciliação). Fluxo de ponta a ponta hoje: a proposta assinada gera uma conta avulsa; a conversão não gera OS nem previsão; só o salvar do contrato gera 13 previsões (com valor por período errado se a cobrança não é mensal); o gerar-mes cria medições por cima; encerrar/cancelar não limpa nada; e as PREVISTO aparecem ao cliente no portal como boleto vencido.

- **🔴 CO1. Frequência das visitas vira periodicidade de cobrança: 4 valores diferentes para o mesmo contrato**
  - Onde: `gerar-contrato/route.ts:65` (`periodicidade: frequenciaContrato`); `lib/financeiro-server.ts:189-209` (uma conta de `valorMensal` por "passo"); `gerar-mes:83-94` (cobra mensal sempre); lista ×12 (`contratos/page.tsx:139`) × form ×meses (`contrato-form.tsx:331`).
  - Hoje: contrato com visita trimestral de R$ 1.000/mês → previsão de R$ 4 mil/ano, lista mostra R$ 12 mil/ano, medição cobra R$ 1.000/mês. BD: não.
- **🔴 CO2. Contrato CANCELADO (ou VENCIDO/EM_RENOVACAO) volta a gerar previsões e OS ao salvar**
  - Onde: `lib/financeiro-server.ts:191` só pula ENCERRADO/SUSPENSO; `recorrencia-server.ts:22`; o PUT sempre roda os geradores (`contratos/[id]/route.ts:102-105`).
  - Hoje: salvar um contrato cancelado cria 12 PREVISTO + OS AGENDADA, que depois viram ATRASADO. Receita fantasma e cliente "inadimplente". Correção: helper único `contratoGeraFinanceiro(status, vigência)` + cancelar PREVISTO/OS futuras ao encerrar. BD: não.
- **🔴 CO3. Proposta de contrato aprovada gera conta avulsa PREVISTO (duplica o contrato) vencendo na validade da proposta**
  - Onde: `publico/orcamentos/[token]/aprovar:44` → `gerarContaReceberDoOrcamento` (`financeiro-server.ts:59-80`), sem olhar o tipo do orçamento; `dataVencimento: validadeEm`.
  - Hoje: a assinatura cria conta do `totalGeral`; depois o contrato cria as mensais; a conta vira ATRASADO no dia seguinte à validade e ainda impede cancelar o orçamento. BD: não.
- **🔴 CO4. Vigência de "12 meses" vira 13 previsões (e total ×13)**
  - Onde: `lib/utils.ts:325-332` (fim = início + N meses no mesmo dia) + contagem inclusiva no form (`contrato-form.tsx:323-331`) + `financeiro-server.ts:208-210`.
  - Hoje: 01/01–01/01 do ano seguinte = 13 contas PREVISTO e uma cobrança extra depois do fim. BD: não.
- **🟡 CO5. Relatório de contratos e botão "Gerar recorrentes" só enxergam a recorrência antiga, que o formulário novo não liga** — contratos novos nunca aparecem no relatório (`contratos/relatorio/page.tsx:24-27`); contratos vindos de proposta ficam com a recorrência antiga ligada às escondidas (sem tela para desligar) e geram **OS em dobro** (antiga + por local) a cada salvar. BD: não.
- **🟡 CO6. Aba "Gestão" do contrato grava e nada usa** — reajuste automático, renovação automática, alerta por e-mail, `exibirRTPDF`: nenhum código lê; "Reajustes aplicados" nunca tem linhas. Prometem automação que não existe. BD: não.
- **🟡 CO7. Conversão proposta→contrato perde dados** — dia de faturamento vai para o campo errado (`diaVencimento`), dia 29–31 vira 1, descrição vai para Observações, SLA/horário/visitas se perdem, tipo é sempre Preventiva, número duplicado dá 500 (`gerar-contrato/route.ts`). Junto com I18. BD: não.
- **🟡 CO8. Recorrência por local: pontas soltas** — ativar sem "data da 1ª OS" não gera nada e não avisa; mudar/desativar não cancela as OS criadas; `fimSemana` sem campo; prévia ignora a vigência (`recorrencia-server.ts:123`; `recorrencia-locais.tsx:44-68`). BD: não.
- **🟡 CO9. Erros de geração engolidos** — `.catch(() => 0)` em `contratos/route.ts:89-92` e `[id]:102-105`: falhou a geração (ex.: colisão de número), a tela diz "salvo" sem OS nem previsão. BD: não.
- **🟡 CO10. "Leads do Site" aberto e com risco entre empresas** — página sem módulo (qualquer logado vê nome/WhatsApp/valores); sem `TERMOFRIO_EMPRESA_ID` o lead cai na empresa ativa mais antiga; o upsert por telefone **renomeia um cliente existente**; CPF provisório `SITE-…` sai em documentos (`publico/leads/route.ts:85-94,177-184`). BD: não.
- **🟡 CO11. Orçamento: sem "voltar a rascunho" e sem "gerar OS" após aprovado** — o contorno (cancelar+reabrir) exige permissão de excluir e desliga lembretes para sempre; o lembrete "aprovado sem OS" vai para o **cliente**, e a empresa não é avisada da aprovação (`acoes-envio.tsx:85-149`; `processar-lembretes:63-77`). BD: não.
- **🟡 CO12. Fuso comercial** — validade expira às 21h da véspera (cliente não aprova no último dia); datas de contrato D-1 nas listas; "vencido" no último dia; horários +3h em telas servidor (`orcamentos/[id]/page.tsx:95`). BD: não.
- **🟡 CO13. Anexo de contrato grande não baixa** — resposta JSON com base64 passa de 4,5 MB a partir de ~3,3 MB de arquivo, e o erro é engolido (`contratos/[id]/anexos/[anexoId]/route.ts:14-17`). BD: não.
- **🟢 CO14. Leves**: contrato abre sempre em modo edição para quem só visualiza (403 no salvar); menu de status aceita CANCELADO→ATIVO sem efeito; `/orcamentos?status=XYZ` → 500; KPI "vencidos" ≠ filtro "Vencido"; janela de "vencendo" 30d × 60d entre telas (`alertaDias` ignorado); relatório de contratos filtra técnico pelo campo errado (nunca casa); tipos de OS inativos ofertados; "WhatsApp/Copiar link" disparam e-mail e marcam ENVIADO a cada clique; limite de 1000 caracteres bloqueia contrato antigo e `descricaoServicos` não aparece em documento nenhum; status `"constructor"` no PUT do orçamento → 500; aprovação pública sem trava atômica (L16).

---

### 4. OS, execução, app do técnico e calendário

Os antigos que continuam aqui: **C8, C11, I8, I9, I11, I16, I17, L2, L6–L14** (ver reconciliação). A fundação nova (trava de conclusão, execução por equipamento, sync offline idempotente, escopo do técnico nas rotas de execução, relatório fiel) **está sólida** — os problemas são as bordas:

- **🔴 OS1. OS sem equipamento nunca conclui**
  - Onde: `lib/execucao/pendencias.ts:120-128`; não há exceção nem override.
  - Hoje: visita técnica, levantamento, cliente sem equipamento cadastrado, OS legada e **as OS recorrentes do contrato** (nascem sem vínculo) só concluem depois de vincular ≥ 1 equipamento. Sem conclusão, não nasce relatório nem medição.
  - Correção: flag "não exige equipamento" no tipo de OS (ou conclusão justificada). **BD: sim** (flag em `tipos_os`).
- **🔴 OS2. OS cancelada ou concluída continua no Meu dia do técnico e aceita execução**
  - Onde: cancelar a OS não cancela as atividades (`lib/acoes-massa/regras.ts:46-60`); o app e o contexto só olham o status da **atividade** (`lib/tecnico/dia.ts:77,97`; `lib/execucao/contexto.ts:51-59`).
  - Hoje: o técnico vai à visita cancelada e grava checklist/fotos/adicional numa OS CANCELADA; o relatório público (dinâmico) muda depois de enviado.
  - Correção: cancelar OS cancela atividades abertas; contexto recusa OS CANCELADA/CONCLUIDA. BD: não.
- **🔴 OS3. Fuso rasga a operação: calendário e app do técnico mostram a MESMA atividade com 3 h de diferença (provado ao vivo)**
  - Onde: calendário todo em UTC (`calendario/page.tsx:31-57,145`); app em America/Sao_Paulo (`lib/fuso.ts`). Entradas erradas: aceitar solicitação (`aceitar/route.ts:51-52`, grava −3 h), nova atividade pela aba (`os-atividades.tsx:117`), recorrência ao meio-dia (`recorrencia-helpers.ts:50`).
  - Hoje **(provado ao vivo)**: atividade gravada 12:00 UTC aparece **12:00 no calendário e 09:00 no app**. Dependendo do caminho de criação, o certo é um ou o outro — o técnico chega 3 h fora.
  - Correção: padronizar `lib/fuso.ts` no calendário e em todas as entradas + consulta para corrigir o que já foi gravado deslocado. BD: não (dados a revisar).
- **🟡 OS4. O escritório não consegue gerenciar o que o técnico cria**
  - Serviço adicional: sem editar, excluir, criar ou anexar foto pelo escritório (só o PATCH de cobrança); a tela Executar carrega os adicionais e não os exibe. Áudio: só ouve, não apaga. Medição: corrige o valor, não a unidade. Foto: só pela tela Executar com atividade aberta.
  - Correção: rotas REST sobre `contextoExecucao` + seção de adicionais na tela Executar. BD: não.
- **🟡 OS5. Reabrir atividade concluída é um select genérico sem confirmação** — reabre com a OS concluída (o relatório público muda sem aviso), checklist novo do tipo passa a ser exigido, e concluir de novo não regenera o `RelatorioOs`. BD: não.
- **🟡 OS6. A execução não alimenta o status da OS** — iniciar/concluir atividades não muda `ordemServico.status` nem `dataInicio/dataConclusao`; relatórios só nascem quando o escritório troca o select. BD: não.
- **🟡 OS7. O horário real do atendimento não é registrado** — `AtividadeOs` não tem início/fim; o sync ignora o `em` do aparelho (`lib/tecnico/sync.ts:27`); offline, tudo fica com a hora da sincronização, e o relatório mostra o agendado. **BD: sim** (`iniciada_em`/`concluida_em`).
- **🟡 OS8. Atividade sem data agendada some do app do técnico** — `lib/tecnico/dia.ts:78,97` filtram por `dataAgendada`, que é opcional. Correção: seção "sem data" no Meu dia ou exigir data. BD: não.
- **🟡 OS9. Abas "Relatórios" e "Formulários" da OS leem o modelo antigo** — contam fotos/respostas de `AtividadeResposta` (zero na execução nova) e "Equipamentos" = todos os da unidade (`ordens/[id]/relatorios/route.ts:41-51`). BD: não.
- **🟡 OS10. Aprovação/assinatura do relatório ficou órfã, mas a rota antiga ainda fatura** — a UI só linka `/relatorio/os/<token>` (sem aprovação); `/relatorio/<token>` aceita o mesmo token, tem aprovação e **gera medição + conta** (`aprovar/route.ts:36`). Decidir: aprovação no relatório #44 ou desligar a rota antiga. BD: não.
- **🟡 OS11. Relatórios públicos com horário em UTC** — início/conclusão +3 h em documento enviado ao cliente (`relatorio-os-documento.tsx:155,185`; `atividade-documento.tsx:51`). BD: não.
- **🟡 OS12. Escopo do técnico e ids do body fora das rotas de execução** — o preset Técnico tem `ordens.editar`, e `PUT/PATCH /api/ordens/[id]`, `POST .../orcamento`, `.../atividades`, `.../anexos`, `DELETE .../equipamentos/[vinculoId]` e `GET /api/ordens` não aplicam o escopo: pela API o técnico conclui/edita qualquer OS e lança item com valor. `GET /api/fotos-atendimento/[id]` idem. POST/PUT da OS não validam `unidadeId`/`contratoId`/`responsavelId` por empresa. BD: não.
- **🟡 OS13. Prazos (SLA) não acompanham a OS** — concluir/cancelar a OS não encerra os prazos; o ATRASADO fica eterno no sino (`lib/prazo-server.ts:38`). BD: não.
- **🟡 OS14. Checklist veicular: só criar** — sem histórico, detalhe, edição ou exclusão (o GET não é usado); "o gestor será notificado" não notifica; o alerta é calculado no cliente. BD: não.
- **🟢 OS15. Leves**: nada da execução entra no `OsHistorico` (vincular, foto, adicional, áudio); "Checklist x/y" do detalhe ignora itens de medição (`atividade-equipamentos.tsx:115`); botões Ler QR/Concluir/arrastar sem checar permissão; rotas órfãs (`POST ordens/[id]/relatorios`, `DELETE orcamento/[itemId]`, `respostas`); relatório de atividade ignora a config de impressão; histórico do equipamento conta atividades canceladas/futuras; duplo clique em "Marcar executado" cria 2 itens financeiros; `resumo` com 2 significados; export CSV ignora `?data=`; tabela de itens sem rolagem no celular.

**OK verificado:** trava de conclusão (servidor, mensagem por equipamento) **(provado ao vivo, 422)**; escopo do técnico nas rotas de execução; sync offline idempotente; foto/áudio validados pelos bytes com nosniff+sandbox; vínculo só do cliente; remoção bloqueada com execução; relatório de atividade com token; Meu dia com "hoje" de Brasília; relatório #44 fiel (cliente × interna).

---

### 5. Estoque e compras

- **🔴 E1. Não existe saída de estoque: usar material na OS não baixa o saldo**
  - Onde: SAIDA/DEVOLUCAO existem em `lib/estoque/regras.ts:30-32` e **ninguém chama**; o lançamento manual só aceita ENTRADA/AJUSTE/INVENTARIO; `OsItemOrcamento` não tem `produtoId`.
  - Hoje: o saldo só sobe; o alerta de mínimo nunca dispara por uso; "saldo negativo" é inalcançável. O estoque da tela fica errado em operação normal.
  - Correção: tabela de material aplicado (OS × produto × qtd) + `movimentar(SAIDA, origem OS)` na execução/conclusão + saída avulsa manual. **BD: sim.**
- **🔴 E2. Nota lançada não tem estorno; movimentação não se estorna nem edita; nota importada não se exclui**
  - Onde: `app/api/compras/notas/**` sem DELETE/estorno; enum sem ESTORNADA; conciliação recusa LANCADA; razão imutável; chave única impede reimportar.
  - Hoje: fator errado (1 em vez de 13,6) → saldo e custo errados para sempre (o custo errado alimenta margem e preço), contas canceladas uma a uma, NF cancelada/devolução sem saída, nota importada por engano fica "Importada" eternamente.
  - Correção: "Estornar nota" transacional (movimentos inversos + cancelar contas sem pagamento + status ESTORNADA + permitir relançar), "Descartar" para não lançada, estorno de movimentação manual. **BD: sim.**
- **🔴 E3. Duas portas para a mesma dívida: pedido de compra × NF**
  - Onde: vínculo com pedido é opcional na central (`conciliacao-nota.tsx:84,181-193`); `gerarContaPagarDoPedido` só procura conta do próprio pedido; botão aparece em qualquer status (até CANCELADO).
  - Hoje: NF lançada sem marcar o pedido + "Gerar conta a pagar" no pedido = **2 contas** (uma com valor estimado). BD: não.
- **🔴 E4. NF sem cobrança ou já paga à vista sempre vira conta a pagar PENDENTE**
  - Onde: `parcelasDaNf` sempre gera parcela (`lib/compras/parcelas.ts:29-33`); tPag 90 "sem pagamento" é ignorado; indPag "à vista" só exibido; tpNF/finNFe/CFOP não são lidos.
  - Hoje: remessa em garantia, bonificação e compra paga no balcão geram dívida "vencida"; NF de devolução vira compra. Risco de pagamento em dobro/indevido.
  - Correção: opção "sem financeiro"/"já pago" + alerta para finNFe=4 e tpNF=0. BD: não.
- **🟡 E5. Custo de entrada ignora frete, IPI, ST, seguro e descontos** — custo = vUnCom ÷ fator (`lib/estoque/preco.ts:28-30`); os totais lidos do XML nunca entram. Margem e preço por margem saem distorcidos. BD: opcional.
- **🟡 E6. Corrida "Salvar rascunho" × "Confirmar e lançar" desfaz o LANCADA** — `conciliar` regrava o status sem condição (`notas.ts:273-279`): com 2 abas, a nota volta a CONCILIADA e pode ser **lançada de novo** (estoque e contas duplicados). Correção: `updateMany where status != LANCADA`. BD: não.
- **🟡 E7. Lançamento irreversível sem confirmação e com números frouxos** — sem modal de resumo; soma das parcelas ≠ total só avisa; `lerNumero("1.500")` vira **1,5** no financeiro da nota e na quantidade manual; avisos da importação (duplicatas ≠ vNF, XML sem protocolo) são descartados. BD: não.
- **🟡 E8. Pedido × nota pela metade** — o pedido não mostra a NF que o atendeu; só 1 NF por pedido (entrega parcial não fecha); "Total estimado" sem multiplicar por quantidade (≠ conta gerada); lançar NF não avança o status (fica "Compras pendentes" no sino); vencimento da conta do pedido = `prazoNecessario`. BD: sim (qtd recebida).
- **🟡 E9. RBAC e empresa em compras** — telas `/compras/**` fora de `ROTA_MODULO` (qualquer logado vê pedidos e preços); `compradorId` sem validação de empresa; `PUT /api/pedidos-compra/[id]` muda status com `financeiro.visualizar`. BD: não.
- **🟡 E10. Preço novo (margem/linha da NF) não recalcula tabela de preço com desconto %** — `valorFinal` congelado (`especificos.ts:293`) prevalece no orçamento. BD: não.
- **🟡 E11. Estoque mínimo e alerta isolados** — `/api/estoque/alertas` sem consumidor; fora do sino e do dashboard; `estoqueMinimo` é Int (não aceita 2,5 kg); sem atalho "gerar pedido". BD: sim (Decimal).
- **🟡 E12. Produto com saldo pode ser inativado ou trocar de unidade sem aviso** — `contarUsos` ignora saldo/movimentações/notas/de-para; inativo some da lista e dos alertas com saldo preso; na planilha, a coluna "estoque" vira estoque **mínimo**. BD: não.
- **🟡 E13. Busca de produto na central provavelmente cortada** — dropdown `absolute` dentro de card `overflow-hidden` (`conciliacao-nota.tsx:148,357`). BD: não.
- **🟢 E14. Leves**: numeração CP por findFirst+1 (colisão → 500, com rollback); deadlock possível entre 2 notas com os mesmos produtos; fornecedor novo criado fora do try; lista de notas formata emissão em UTC (detalhe usa Brasília) e "criado em" do pedido em UTC; `prazoNecessario` à meia-noite UTC aparece D-1; extrato com custo em 2 casas (gravado com 4), sem link para a NF, sem filtro/exportação; inventário sem data retroativa e sem contagem em lote; fator em branco grava 1 com status "pronto para lançar" (a API lança); `Decimal(15,4)` arredonda vUnCom de 10 casas; resultado soma contas canceladas; quem só tem `estoque.visualizar` vê contas e linha digitável; **nenhum perfil pré-definido além de Admin consegue lançar NF** (SUPERVISOR sem fluxoCaixa, FINANCEIRO sem estoque.gerenciar); empresa sem CNPJ nunca importa NF; "Ver conta a pagar" faz POST e leva para a lista; rotas GET de estoque/notas sem consumidor.

**OK verificado:** dedup por chave de acesso com DV + P2002; lançamento transacional com reserva atômica (2º lançar recusado); trava por produto com teste de concorrência; fator aplicado coerente; XXE bloqueado e limite de 2 MB; DVs do boleto correto; divisão de parcelas sem perder centavos; central funciona no celular; produto DELETE só inativa.

---

### 6. Custo de pessoal (folha) e demissão

O módulo hoje é um **cadastro de custo + foto do mês**. Não há lançamento mensal, rescisão nem ligação com o financeiro.

- **🔴 P1. Diarista: o custo-hora gravado usa 220 h/mês** — a prévia mostra dias×8, mas o PUT grava `horasMes ?? 220` (`folha/colaboradores/[id]/route.ts:87`) e a importação não manda horas: custo-hora subestimado ~2,75× e o "custo-hora médio" da tela junto. **BD: sim** (`horas_mes` anulável) ou gravar dias×8.
- **🔴 P2. O modelo padrão de encargos pode ser desativado/trocado de regime sem aviso** — a trava só conta uso explícito (`lib/cadastros/especificos.ts:113-147`): dá para deixar todos os CLT **sem encargos** em silêncio (folha perde ~55%), com o modal dizendo "não está em uso". BD: não.
- **🔴 P3. Quem entra ou sai no mês distorce o custo (sem proporcional)** — inativado antes de "Fechar mês" some do mês inteiro; admitido dia 28 entra cheio (`lib/folha/server.ts:101,121-134`). **BD: sim** (data de desligamento + proporcional).
- **🔴 P4. Salário antigo sem dados de folha é tratado como CLT com 55,24%** — PJ/diarista antigo com `salario` e sem `colaborador_folha` ganha INSS/FGTS/provisões e não aparece como pendência (`server.ts:52-56,91`). BD: não.
- **🟡 P5. Demissão/rescisão não existem** — nenhuma ocorrência no código; `Tecnico` não tem data de desligamento; inativar só grava `ativo:false`. Sem verbas (saldo, aviso, férias+1/3, 13º, multa FGTS) nem conta a pagar. **BD: sim.**
- **🟡 P6. A folha não chega ao financeiro** — não gera contas a pagar, não entra no fluxo de caixa, provisões nunca são baixadas, e o "custo-hora como insumo da margem das OS" não tem quem use. **BD: sim** (vínculo conta↔competência).
- **🟡 P7. Fechamento frágil** — a tela só fecha o mês corrente (perdeu o dia, perdeu a foto); a API refaz competências passadas com os dados **de hoje** (corrompe histórico) e dois cliques dão P2002→500 (`fechar-mes/route.ts:21-22`). BD: não.
- **🟡 P8. Sem lançamento mensal, histórico de salário nem visão do mês fechado** — HE/dias/descontos moram no cadastro e se repetem todo mês; salário sobrescrito sem trilha; o snapshot não tem tela nem exportação. **BD: sim.**
- **🟡 P9. Importação da folha cria/edita colaborador e cargo com permissão só de folha** (`importar/route.ts:27,62-94`), enquanto o POST normal exige `equipes.gerenciar`. BD: não.
- **🟡 P10. Importação sem desfazer**; readmitido aparece sem indicação de inativo e continua fora do custo; erros só na tela. BD: sim (lote p/ desfazer).
- **🟡 P11. CPF com e sem máscara duplica a pessoa (custo em dobro)** — form sem máscara × planilha formatada; índice único por string exata. **BD: sim** (normalizar). [mesma causa do CA4]
- **🟡 P12. Modelo CLT de referência subestima encargos** — sem incidência de INSS/FGTS sobre as provisões (+6,96 p.p.) nem multa de 40% do FGTS (~+3,5 p.p.): ~R$ 210–320/mês por salário de R$ 3.000. BD: não.
- **🟢 P13. Leves**: % do Excel em formato porcentagem vira 0,3%; colaborador importado sem telefone trava a edição posterior (schema exige 8+); ações em massa de modelos liberadas por `financeiro.visualizar`; indicadores "ao vivo" divergem do mês fechado sem aviso; AFASTADO/FÉRIAS com custo cheio; tooltip do gráfico cortado.

**OK verificado:** RBAC e empresa em todas as rotas de folha; modelos de encargos no padrão (um padrão por regime, DELETE só inativa); importação com prévia, transação, limites e dedup; cálculo sem divisão por zero e sem provisão em dobro; fechamento idempotente por índice único; salário não vaza em listas/exportações; fuso da competência correto.

---

### 7. Cadastros e configurações

#### Matriz CRUD (rota **e** botão)

Legenda: ✓ = rota + botão · ✗ = rota existe, falta botão · ✗✗ = falta rota · **D** = por desenho o sistema só inativa (não apaga) — padrão correto para quem tem histórico.

| Cadastro | Criar | Listar | Editar | Inativar | Reativar | Impacto antes de inativar | Excluir |
|---|---|---|---|---|---|---|---|
| Clientes | ✓ (form, rápido, planilha) | ✓ | ✓ | ✓ | ✗ na linha (só na ficha/massa) | ✗✗ só `confirm()` | D |
| Contatos do cliente | ✓ | ✓ só ativos | ✓ | ✓ | ✗✗ | ✗✗ | D |
| Unidades (só dentro do cliente) | ✓ | ✓ só ativas | ✓ | ✓ | ✗✗ | ✗✗ (não olha OS/contrato) | D |
| Equipamentos (+foto, QR) | ✓ | ✓ | ✓ | ✓ | ✓ | ✗✗ `confirm()` | D · importação por planilha ✗✗ |
| Tipos de equipamento (+checklist) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | D |
| Colaboradores | ✓ + rápido | ✓ | ✓ | ✓ (+login junto) | ✓ | ✓ | D · importação só pela folha |
| Equipes (+montador) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | D · ações em massa ✗✗ |
| Veículos | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | D · editar manutenção ✗✗ · importação ✗✗ |
| Modelos de checklist veicular | ✓ | ✓ só ativos | ✓ | ✓ (erro engolido) | ✗ | ✗✗ | D |
| Usuários | ✓ convite | ✓ | ✓ nome/perfil (**e-mail ✗✗**) | ✓ | ✓ | ✓ | D |
| Perfis de acesso | ✓ + duplicar | ✓ | ✓ | ✓ | ✓ | ✓ | D |
| Produtos / Serviços | ✓ + planilha | ✓ | ✓ | ✓ | ✓ | ✓ | D |
| Cargos / Categorias / Centros de custo | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | D |
| Fornecedores | ✓ + planilha | ✓ | ✓ | ✓ | ✓ | ✓ | D |
| Tabelas de preço / Termos / Prazos | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | D |
| Tipos de OS / Tipos de problema (tela antiga) | ✓ | sem paginação | ✓ | ✓ `confirm()` | ✓ escondido | ✗✗ | D |
| QR codes | ✓ | **sem busca nem paginação** | vincular ✓ / desvincular só na ficha | ✗ (PATCH sem botão) | ✗ | ✗✗ | ✗ **DELETE físico sem botão** |
| Templates de e-mail | ✗✗ (só restaurar padrões) | ✓ | ✓ | ✓ | ✓ | — | ✗ rota sem botão |

Importação em massa existe para clientes, fornecedores, serviços e produtos; **não** existe para equipamentos, colaboradores e veículos.

- **🔴 CA1. Campo de moeda dos cadastros padronizados grava "1.500" como R$ 1,50**
  - Onde: `lib/cadastros/registro.ts:102-108` troca só a 1ª vírgula; o campo é texto livre (`cadastro-padrao.tsx:413-418`).
  - Hoje: em produtos, serviços e alíquotas, "1.500" vira 1,5 e "1.500,00" dá 400 — enquanto o cadastro rápido e a planilha entendem o formato brasileiro. Preço errado segue para orçamento e tabela de preço.
  - Correção: usar o `numero()` da importação + máscara; limitar alíquotas. BD: não.
- (**🔴 S1** — o XSS das fotos/avatar foi achado também por aqui; está no módulo Segurança.)
- **🟡 CA2. Das 21 chaves da tela de Configurações, só 1 tem efeito** — além do C9 (salvar sempre dá 400), `clienteExigirUnidade` é a única chave lida; obrigatoriedades, regras de OS, notificações e mapa são decorativos (`configuracoes-client.tsx:258-291`). Corrigir o C9 e ligar (ou remover) cada chave. BD: não.
- **🟡 CA3. Modelos de e-mail e avisos que nunca disparam** — `enviarLembreteVencimento`, `enviarMedicao`, `enviarOS`, `COBRANCA_ATRASO`, `CONTRATO_ASSINATURA` sem chamador; os toggles `notif*` e `diasLembreteVencimento` não fazem nada. BD: não.
- **🟡 CA4. CPF/CNPJ sem normalização nem dígito verificador** — form grava como digitado × planilha grava formatado: cliente/colaborador duplicado passa pelo índice único (é o mesmo P11 da folha). **BD: sim** (normalizar existentes).
- **🟡 CA5. Inativar cliente não mostra impacto** — contrato ativo, OS aberta e recorrência continuam (a recorrência não olha `cliente.ativo`). Criar `/api/clientes/[id]/impacto` como nos demais. BD: não.
- **🟡 CA6. Tabela de preço** — item com desconto % congela o valor na gravação (mudar o preço do produto não recalcula — mesmo ponto do E10); "preços bloqueados" só vale no navegador; várias tabelas "padrão" aceitas e só a mais antiga vale. BD: não.
- **🟡 CA7. Cliente importado por planilha fica sem Unidade** — endereço vai para o cliente e nenhuma unidade é criada: **não dá para cadastrar equipamento nem abrir OS** para ele. BD: não.
- **🟡 CA8. E-mails de faturamento, cópias e preferências do cliente não têm onde ser preenchidos** — estados sem setter no form (`cliente-form.tsx:140-154`), mas são usados no envio de boleto e nos relatórios. BD: não.
- **🟡 CA9. Ficha do colaborador manda CPF, RG, endereço e documentos ao navegador para quem só tem `equipes.visualizar`** — a API exige `gerenciar`; a página não (`colaboradores/[id]/editar/page.tsx:17-37`). BD: não.
- **🟡 CA10. Veículo aceita responsável e equipe de outra empresa** (`veiculos/route.ts:64-65`; `[id]:65-66`). BD: não.
- **🟡 CA11. Importação em massa sem desfazer e sem lote/log**; atualiza registro inativo em silêncio. BD: sim (lote p/ desfazer).
- **🟡 CA12. QR codes: tela fora do padrão** — sem busca/paginação, inativar sem botão (e o "ativo" é ignorado no fluxo público — I12), DELETE **físico** por rota sem botão (quebraria etiqueta já colada), carrega tudo num `<select>`. BD: não.
- **🟢 CA13. Leves**: telas antigas (`CrudCadastro`, QR) sem checar permissão nos botões, `confirm()` sem impacto e tabela cortada no celular; L24 (P2002 sem tratamento) e L27 (equipe fora de transação); usuários — sem e-mail configurado não há como redefinir senha de quem já entrou, e-mail não é editável, quem só visualiza vê "Sem permissão"; `GET /api/tecnicos` com `?tipo` inválido → 500; divergências de permissão entre tela/rota/massa (fornecedores, encargos); contato com `tipo` inválido → 500; frequência do checklist veicular decorativa (pendente é sempre diário); editar preço não limpa `margemVenda`; NCM/CEST não editáveis; `senha_provisoria` morta no schema.

**OK verificado:** rota genérica com validação de tipo, permissão por ação, empresa da sessão e vínculos validados; travas de perfis/usuários (anti-autopromoção, último admin); convite assinado de uso único; inativação com impacto em colaboradores/equipes/veículos/tipos; exportação CSV protegida contra fórmula; ações em massa conferem permissão item a item.

---

### 8. Transversal — fuso, navegação, PWA, responsivo, limpeza

- **🔴 T1. Páginas e sino fora do RBAC**
  - `/compras/**` e `/leads-site` sem módulo em `ROTA_MODULO` (qualquer logado entra; leads mostra nome/WhatsApp/valores — ver CO10) e o detalhe do pedido não chama `podeVerPedido`.
  - As telas do financeiro ignoram as **sub-permissões**: quem tem só `financeiro.visualizar` (sem "contas a receber") vê contas, fluxo de caixa e medições — a API nega, a página não (`contas-receber/page.tsx`, `medicoes/page.tsx:46`, `fluxo-caixa/page.tsx:29`).
  - O sino mostra "Compras pendentes"/"Boletos pagos" a técnico/auxiliar e os links entram (`api/alertas/route.ts:7-27`).
  - Correção: mapear as rotas, checar sub-permissão nas páginas e filtrar o sino por `pode()`. BD: não.
- **🟡 T2. Fuso horário: o Apêndice B lista as ~30 ocorrências** (arquivo:linha → sintoma). Os pontos de maior dano: calendário em UTC (OS3), contas ATRASADO/INADIMPLENTE a partir das 21h, validade do orçamento expirando na véspera, documentos do cliente com hora +3 h, filtros de/até deslocados, datas-só-dia exibidas D-1. Correção transversal: `formatarData*` com `timeZone: America/Sao_Paulo` + "hoje"/limites por `lib/fuso.ts` + gravar datas-só-dia às 12:00Z (como a NF já faz). BD: não (consulta para dados já deslocados).
- **🟡 T3. PWA (I7, piorou)** — `/api/*` (inclusive `/api/auth/session`) em NetworkFirst 3 s/24 h; páginas 7 dias; nenhum "Sair" limpa Cache Storage/IndexedDB; os caches `pages` do `swe-worker` nunca expiram nem são limpos; a tela offline leva **qualquer usuário** (admin incluso) ao `/tecnico` guardado do usuário anterior. Correção: tirar `/api` do cache (exceto estáticos públicos), limpar caches no signOut, desligar `cacheOnFrontEndNav`. BD: não.
- **🟡 T4. Ao voltar a conexão, o escritório recarrega a tela e perde o formulário em edição** (`recarregar-ao-voltar.tsx:12-14`) — num 4G instável, um orçamento meio preenchido some. BD: não.
- **🟡 T5. Responsivo** — QR codes com a coluna de ações inalcançável no celular (`overflow-hidden`); "Itens da OS" empurra a página (tabela ~400 px sem overflow); contas a pagar/receber escondem a coluna Vencimento no celular; zoom bloqueado (`userScalable:false`) + app travado em retrato; `PageHeader` espremido. BD: não.
- **🟡 T6. Dashboards divergentes** — o principal conta "vence hoje" como vencida (corte 03:00Z × gravação 00:00Z), pula o dia 1 no faturado do mês e tira a garantia que vence hoje de "vigente" (`lib/dashboard/dados.ts:144-174`); o `/financeiro` corta em UTC puro: números diferentes nas duas telas. BD: não.
- **🟢 T7. Leves/limpeza** — busca global do topo sem handler (`header.tsx:164-171`); atalhos do sino com filtros que as listas não leem; `confirm()` em 23 arquivos × Modal nos demais; `alert()` em 5 componentes; botão Salvar em 4 posições; breadcrumbs "Calendario/Orcamentos/Contas-receber" sem acento e links 404 (L22). **Código morto**: `tecnico-form.tsx`, `lib/use-permissoes.ts`, rotas sem chamador (`/api/tecnicos/proximos`, `/api/tecnicos/[id]/localizacao`, `/api/estoque/alertas`, `/api/folha/modelos`, `/api/clientes/[id]/status-financeiro`, aliases `/api/cargos|categorias-financeiras|perfis-acesso|tabelas-preco|…`), campos de schema nunca lidos (`Cliente.ultimaPesquisaEm`, `MovimentacaoEstoque.localId`, `AtividadeEquipamento.feitoPorId`, `RelatorioOs.pdfUrl`, `Contrato.adicionar*`/`itensInclusos`), permissões órfãs (módulo `licitacoes`, `relatorios.visualizar`), cache `pages` nunca lido, `senha_provisoria`.

**OK verificado:** gaveta do celular filtrada por permissão; menu lateral sem link morto; `/estoque`, `/financeiro/fornecedores`, `/financeiro/custo-pessoal` e centros de custo mapeados; modal com rolagem; listas principais com cartões no celular; barras de ação acima da navegação; app do técnico sem erro de hidratação e com IndexedDB por usuário; manifest/offline/instalar ok.

---

## As 10 coisas mais urgentes

1. **S1 — XSS armazenado nas fotos de equipamento/veículo e no avatar**: um técnico escala para admin. (Leva 1)
2. **S2/I2 — Webhook do Inter**: o segredo sai no GET e qualquer corpo forjado marca boleto como pago. (Leva 1)
3. **S3 — Login do portal sem limite de tentativas e senha mínima de 4** — força bruta no financeiro do cliente. (Leva 2)
4. **F1/C7 — Faturamento da OS sem trava (provado ao vivo: 3 medições na mesma OS)** + F2 (mensalidade do contrato cobrada por OS). (Leva 4)
5. **F3 — Medição de R$ 0 de relatório cala o gerar-mes**: mensalidade do contrato deixa de ser faturada em silêncio. (Leva 4)
6. **C6 + F5 — PREVISTO × medição sem vínculo, com boleto para as duas e o portal mostrando tudo como "boleto vencido"**: cliente cobrado 2×. (Leva 5, BD)
7. **CO2/CO3/CO4 — Contrato cancelado volta a gerar receita; proposta aprovada duplica; 12 meses viram 13 previsões.** (Leva 5)
8. **OS3/I8/T2 — Fuso horário**: calendário × app do técnico com 3 h de diferença (provado ao vivo), ATRASADO/INADIMPLENTE às 21 h, validade expirando na véspera, documentos do cliente com hora errada. (Leva 6)
9. **E1 + E2 — Estoque sem saída e sem estorno**: o saldo não reflete a operação e um lançamento errado não tem conserto. (Levas 8–9, BD)
10. **P1–P4 — Folha**: diarista com 220 h, modelo padrão de encargos desativável, mês sem proporcional e salário antigo virando CLT — o custo de pessoal sai errado nos casos comuns. (Leva 10)

Menções honrosas: **OS1** (OS sem equipamento nunca conclui — trava o fluxo principal de visita técnica), **CA1** ("1.500" vira R$ 1,50 no cadastro de produto), **T1** (telas do financeiro ignoram sub-permissões), **OS2** (técnico executa OS cancelada).

---

## Plano de correção em levas (um PR por leva)

Regras de sempre: cada leva pequena (1 tema), com testes que provam a correção e rodada de mutação; levas 🔵 trazem o `.sql` idempotente em `prisma/sql/` para você rodar antes do merge. Ordem: **segurança → dinheiro → telas quebradas → pontas de CRUD → desconexões → limpeza → robustez**.

| # | Leva | Itens | BD? |
|---|---|---|---|
| **1** | **Segurança urgente**: fotos/avatar validados pelos bytes e servidos por `respostaAnexo` (sem redirect); anexos de cliente/contrato idem (resto do C1); webhookSecret fora do GET + girar segredo + webhook confirma no Inter antes de baixar; headers globais (nosniff, frame-ancestors) | S1, C1, S2/I2, S13 | 🔵 (limpeza de fotos/anexos não-imagem e de `senha_provisoria`) |
| **2** | **Portal e público**: rate limit + senha mínima 8 no portal; sessão do portal reconferida; `verOS` aplicado; histórico/anexos internos fora do portal; QR (ativo, "só logado" funcionando, rate limit); compressão das fotos do chamado | S3, S4, S5, S11, I12, I13, I14, L25 | não |
| **3** | **Acessos internos**: `ROTA_MODULO` para compras/leads; sub-permissões do financeiro nas páginas; sino filtrado; ficha do colaborador por `gerenciar`; configurações por permissão (I5 + SUPER_ADMIN); redirect do login; troca de e-mail com senha; cron só por Bearer; tentativas em paralelo; menu mobile filtrado (I3) | T1, CO10, CA9, I5, S7, S9/L26, S10, S6, I3 | não |
| **4** | **Faturamento da OS**: `osJaFaturada()` única (itens + relatórios + OsMedicao), exigir OS concluída, aprovação de relatório só fatura MEDICAO_COMPLETA/valor>0, tipo próprio p/ medição de relatório (destrava o gerar-mes), cancelamento solta vínculos, C8 (include), decidir OsMedicao, "Cobrar" do adicional vira origem de cobrança | F1/C7, F2, F3, F4, C8, I25 | não |
| **5** | **Contrato × previsão** 🔵: `contratoId`+`periodo` em contas_receber + script de limpeza das duplicadas; quitar/cancelar PREVISTO ao faturar; PREVISTO fora da inadimplência e do portal; boleto só p/ conta real; helper `contratoGeraFinanceiro` (status+vigência); vigência N meses (não N+1); proposta não gera conta avulsa; periodicidade ≠ frequência de visita; conversão completa (I18/CO7); vencimento da medição (F6) | C6, F5, CO1–CO4, I18, I19, CO5, F6 | **🔵 sim** |
| **6** | **Fuso horário**: `formatarData*` com timeZone; "hoje"/limites via `lib/fuso.ts` em listas, dashboards, alertas e status; calendário inteiro em Brasília; entradas (aceitar solicitação, nova atividade, arrastar) convertidas; datas-só-dia às 12:00Z; documentos públicos; hidratação (I9) | OS3, I8, I9, T2, T6, F11, CO12 | não (consulta p/ dados deslocados) |
| **7** | **Contas**: editar medição sem perder vínculos (I21); ações da medição consistentes (I22) e boleto cancelado junto (I23); recebimento parcial/estorno (F12) + unique por medição (F15); saldo na conta a pagar (L20) + estorno; validação de empresa nos ids (F7, F8, OS12-ids, CA10); pedido com conta cancelada (F9); sincronizar boletos (F14); listas paginadas (F10); fluxo de caixa com saídas (F17) | I21–I23, F7–F18, L20 | 🔵 (unique) |
| **8** | **Estoque — reversibilidade** 🔵: estornar nota (transacional) + descartar importada + estorno de movimentação; corrida salvar×lançar; confirmação com resumo e `lerNumero` BR; NF sem cobrança/à vista; pedido×NF (porta única, status avança, parciais) | E2, E6, E7, E4, E3, E8, I24 | **🔵 sim** |
| **9** | **Estoque — saída e custo** 🔵: material aplicado na OS baixa estoque (SAIDA/DEVOLUCAO) + saída avulsa; custo com frete/IPI/desconto; alerta no sino/dashboard + mínimo Decimal; travas de produto com saldo; RBAC compras (E9) | E1, E5, E11, E12, E9 | **🔵 sim** |
| **10** | **Folha** 🔵: horas do diarista; trava do modelo padrão; pendência p/ salário sem folha; proporcional de admissão/desligamento; fechamento seguro (competência passada); encargos sobre provisões; importação (permissão, inativos, desfazer); CPF normalizado (junto CA4) | P1–P4, P7, P9–P12, CA4 | **🔵 sim** |
| **11** | **Telas quebradas e erros silenciosos**: C9 + ligar/remover as 21 chaves (CA2); campo moeda (CA1); 500s de entrada inválida (L6, CO14, CA13); erros engolidos (CO9, F19, CA13); status `constructor` | C9, CA1, CA2, L6, CO9 | não |
| **12** | **Pontas de CRUD**: edição da OS (I11); escritório gerencia adicional/áudio/medição/foto (OS4); reabrir com confirmação (OS5); QR codes no padrão (CA12); unidades com reativar/impacto; usuários (e-mail, redefinição local); importação de equipamentos/colaboradores/veículos; cliente importado com unidade (CA7); e-mails de faturamento editáveis (CA8); editar manutenção do veículo | I11, OS4, OS5, CA12, CA7, CA8, CA11 | não |
| **13** | **Desconexões da OS**: execução alimenta status/horários da OS (OS6, OS7 🔵); OS cancelada cancela atividades (OS2); OS sem equipamento por tipo (OS1 🔵); atividade sem data no app (OS8); abas Relatórios/Formulários no modelo novo (OS9); aprovação do relatório #44 decidida (OS10); prazos acompanham a OS (OS13); recorrência contínua + cron + relatório de contratos (C11, CO5, CO8); escopo do técnico nas rotas restantes (OS12) | OS1–OS13, C11 | **🔵 sim** (flag tipo, horários) |
| **14** | **PWA e sessão**: cache sem `/api`, limpeza no signOut, swe-worker; recarregar sem perder formulário; permissões recarregadas no JWT (I4); login multiempresa (I6); 2FA 🔵; salvar cliente sem desligar portal (I26); docs com diff (I30); equipe em transação (L27) | T3, T4, I4, I6, S8, I26, I30 | 🔵 (2FA) |
| **15** | **Robustez e limpeza**: numeração única com retry (I15/L17/L24); checklist veicular completo (OS14); tabela de preço recalculada (CA6/E10); impacto do cliente (CA5); responsivo (T5); código morto e aba Gestão (T7, CO6, CA3 — ligar ou remover); PMOC segue como feature futura (I31) | I15, OS14, CA5, CA6, T5, T7, CO6, CA3 | não |

---

## Apêndice A — RBAC hoje (varredura das 194 rotas)

A reforma pegou: os ~60 handlers do C4 têm `exigirPermissao`/fábricas, e as sondas ao vivo confirmaram 403 para o técnico em tabelas de preço, dados de colaborador, folha e orçamento. O que resta hoje:

| Rota | Métodos | Situação |
|---|---|---|
| `/api/configuracoes`, `/api/configuracoes/qr-code`, `/api/empresa` | PUT | checam **role** ADMIN em vez de `configuracoes.gerenciar` (I5) |
| `/api/tecnicos` | GET | só login — devolve telefone e avatar de todos (RBAC leve recomendado) |
| `/api/pedidos-compra/[id]` | PUT | escrita liberada com `financeiro.visualizar` |
| `/api/produtos` | GET | só login — expõe `saldo` e `margemVenda` |
| `/api/fotos-atendimento/[id]` | GET | sem o escopo do técnico (áudio e adicional têm) |
| `/api/push/subscribe` | DELETE | apaga inscrição de qualquer usuário pelo endpoint |
| GETs de catálogo (`listar: null`): produtos, serviços, cargos, categorias, tipos-equipamento, tabelas-preço (com itens/valores), prazos, centros de custo | GET | por desenho (seletores); avaliar tabela de preço |
| Públicos intencionais | — | auth, portal-auth, publico/* (tokens), qr/[token] (sem rate limit — S11), webhooks/inter (S2), cron (S10) |

## Apêndice B — Fuso horário: mapa de ocorrências

| Onde (arquivo:linha) | Sintoma para o usuário |
|---|---|
| `calendario/page.tsx:31-57,120-122,145,171` | 14h vira 17h; 22h cai no dia seguinte; "hoje" muda às 21h |
| `api/ordens/[id]/route.ts:85-89` | arrastar atividade noturna grava no dia anterior |
| `os-atividades.tsx:117` + `atividades/route.ts:57` | nova atividade 14h → 11h na OS e no app (técnico chega 3h antes) |
| `solicitacoes/[id]/aceitar/route.ts:51-52` | chamado aceito para 14h vira 11h |
| `recorrencia-helpers.ts:50` | OS recorrente "meio-dia" fica 9h no app, 12h no calendário |
| `api/ordens/route.ts:128` → `os-detalhe.tsx:207`, `ordens-lista-client.tsx:379,418` | previsão 21/10 aparece 20/10 |
| `lib/prazo-server.ts:33-35,52`, `lib/dashboard/dados.ts:29` | "em atraso"/"vencendo hoje" virando às 21h |
| `lib/listas/filtros.ts:28-31,45-46,86-90,114-115`; exports | filtros por dia/período deslocados 3h |
| `contas-receber/page.tsx:17-22`, `contas-pagar/page.tsx:27-31`, `financeiro-server.ts:351-363` | ATRASADO/VENCIDO gravados às 21h do próprio vencimento |
| `lib/dashboard/dados.ts:144-174` | conta de hoje em "Vencidos"; faturado do mês pula o dia 1; garantia de hoje fora de "vigente" |
| `lib/financeiro-status.ts:25-31` + `contas-receber-view.tsx:41,241` | vencimento D-1 e "Vencido 1 dia" no próprio dia |
| `lib/status-financeiro.ts:26-29` | cliente INADIMPLENTE às 21h do vencimento |
| `lib/veiculo-server.ts:13`, `veiculo-listagem.ts:51`, `colaborador-listagem.ts:58` | checklist pendente/documentos "vencidos" virando às 21h |
| `(publico)/orcamento/[token]/page.tsx:47` + `aprovar:26` + `lib/email.ts:284` | orçamento expira às 21h da véspera |
| páginas públicas e documentos (`orcamento-documento:287,306`, `medicao-documento:229`, `relatorio-*`, portal) | "Aprovado às 17:00" (foi 14:00); horários +3h no PDF do cliente |
| `prazos/page.tsx:102`, `leads-site:136`, `compras/pedidos/[id]:83`, `estoque/notas/page.tsx:59,78` | datas/horas +3h ou D+1 em telas servidor |
| `lib/inativacao-server.ts:167`, `qrcodes/route.ts:51` | hora UTC gravada no texto; ano do QR em UTC |
| `equipamento-perfil:227-281`, `contratos-lista-client:182,225`, `cliente-contratos:87`, `compras-secao:179`, `conta-receber-acoes:40,76`, `equipamento-form:56`, `colaboradores-lista-client:220`, `selos.tsx:24` | datas-só-dia exibidas um dia antes |
| `medicao-acoes:38`, `conta-pagar-acoes:59`, `conta-receber-acoes:311` | data de pagamento sugerida = amanhã após as 21h |

---

*Auditoria executada sobre o preview local (`next start`, banco de demonstração) + leitura integral do código. Nada foi corrigido nem commitado além deste relatório.*
