# Auditoria de Usabilidade e Experiência — 22/10/2026

> **Escopo**: usabilidade, praticidade, agilidade, simplicidade e funcionalidade no dia a dia — **não** é a auditoria de bugs/segurança (essa está em `docs/auditoria-operacional-2026-10-21.md`).
> **Método**: simulação real de uma empresa de climatização no preview (build atual, banco demo), **clicando de verdade** em desktop (1366×900) e celular (390×844), em 3 papéis — ESCRITÓRIO, TÉCNICO e CLIENTE — medindo cliques/toques, campos e telas por tarefa; mais uma **varredura estática do código** medindo a cobertura dos 6 princípios de UX da casa com evidência `arquivo:linha`.
> **Nada foi corrigido**: este documento é só o relatório.
>
> *Ajustes feitos no banco **demo** só para viabilizar o teste (anotar): criado login de técnico (`fernanda.alves@…`, role TECNICO + perfil "Técnico de Campo" — sem o perfil o login caía no sistema inteiro, o que virou o achado T7); senha conhecida para o contato do portal (`maria@hospitalsc.com.br`); 1 atividade reagendada para hoje.*

## Resumo executivo

| Severidade | Qtde | Leitura |
|---|---|---|
| 🔴 atrapalha muito o dia a dia | **7** | Concentrados em DINHEIRO (lançar despesa, preço de adicional, contas a receber em escala) e nos dois pontos de contato com o cliente (fatura invisível no portal, QR sem foto) |
| 🟡 incomoda | **17** | Feedback inconsistente (sem toast; alert/confirm/prompt nativos), travas sem saída inline, polimentos do app técnico, portal/QR |
| 🟢 polimento | **17** | Consistência visual, a11y, atalhos, rótulos |

**Nota por papel** (velocidade + clareza percebidas no caminho feliz):
- **Técnico (app, celular): excelente** — ~10 toques + 7 campos do login à OS concluída; offline de verdade (fila, contador, sync automático, PWA abre sem internet); travas honestas que nomeiam o que falta. Só polimento.
- **Escritório: bom com buracos pontuais** — navegação ~1s, faturar em 2 cliques, "quanto entra este mês?" em 1 clique; mas cadastrar equipamento esbarra numa busca de cliente quebrada, e lançar despesa manda o usuário "sair, cadastrar e recarregar".
- **Cliente (portal/QR): bom para acompanhar, fraco para pagar e para mostrar o problema** — chamado em 4 interações com protocolo e timeline, PDF em 3 toques; mas a fatura é inachável e o QR não aceita foto.

---

## Os 6 princípios da casa — cobertura medida

### (1) Criação inline ("criar sem sair da tela")
**Respeitado** — existe componente exemplar, `components/ui/select-cadastro-rapido.tsx` (busca, "+ Novo…" em modal, RBAC, já seleciona o criado): Nova OS (cliente/unidade/equipamento), form de equipamento (4 campos, incl. "+ Novo tipo"), contrato/orçamento (cliente), cadastro por foto, seletor de técnicos.
**Violado** — dos **31** campos que referenciam outro cadastro, **19 não têm criação inline**: o `SeletorCadastro` (`components/cadastros/seletor-cadastro.tsx:59-73`) é um `<Select>` simples e é o que o financeiro/compras/RH usam — fornecedor, categoria e centro de custo na conta a pagar (`conta-pagar-form.tsx:86,100,105`) e na importação de NF (`financeiro-nota.tsx:130,135`); categoria na cobrança; cargo/perfil no colaborador; produto no pedido de compra; mais selects crus (tipo de OS na atividade `os-atividades.tsx:241,281` e na recorrência do contrato; equipe no veículo).

### (2) CRUD visível conforme permissão
**Respeitado como padrão forte**: páginas com gate (`redirect("/sem-permissao")`), botões condicionados por `pode(...)` (listas de OS, equipamentos, clientes), CadastroPadrao e select-cadastro-rapido com RBAC embutido. Amostra de 8 telas: ok.
**Observação** 🟢: "Nova Cobrança" (`contas-receber-view.tsx:123`) aparece para quem só pode ver (a sub-permissão não distingue ver×criar; o servidor valida, mas o clique pode terminar em 403).

### (3) Feedback sempre
**Respeitado**: o padrão de estado local (`setErro/setMsg`) existe em ~90 componentes; `Button loading` nos salvamentos; a melhor mensagem do sistema é a trava de conclusão da OS (nomeia atividade, equipamento, itens sem resposta e fotos faltantes).
**Violado**:
- **Não há sistema de toast** (nenhuma lib, nenhum `components/ui/toast`): cada tela resolve sozinha, a mensagem aparece num lugar diferente a cada tela; convivem **14 `alert()`**, **21 `confirm()`** e **2 `window.prompt()`** nativos — o pior deles pedindo o **preço do serviço adicional** (`os-adicionais.tsx:40`).
- Gravações **mudas**: criar item do orçamento da OS tem `catch {}` vazio e marcar "executado" não tem ramo de erro (`os-orcamento.tsx:27-45` — coração do faturamento); vincular orçamento à OS, salvar template de e-mail e relatório de contratos idem.
- Pós-salvar cliente volta à lista sem toast e sem destacar o criado.

### (4) Responsivo de verdade
**Respeitado**: zero overflow horizontal nas telas conferidas (/ordens, /financeiro, /clientes); listas viram cards; bottom-nav própria; app do técnico com alvos ≥44px em quase tudo; portal idêntico em celular e desktop.
**Violado** (pontual): thumbnails de foto no app técnico são botões de 24×24px — difícil tocar com o dedo.

### (5) Escala (busca/filtro/paginação)
**Respeitado**: paginação de servidor nas listas grandes novas (clientes, OS, orçamentos, equipamentos, estoque) e nos 12 cadastros do CadastroPadrao (busca com "/", contagem, Ativos/Inativos).
**Violado**: **Contas a Receber `take: 500`** e **Contas a Pagar `take: 300`** sem paginação nem busca de servidor (o que passa do limite SOME sem aviso — e é a tela mais usada do escritório); Medições `take: 100` com filtros de data + botão "Filtrar" fora do padrão; Prazos 300 / Pedidos 200 / Leads 200; a **busca de cliente do form de equipamento não filtra** (ver achado E1).

### (6) Consistência entre telas
**Respeitado**: datas/moeda centralizadas (`formatarData/formatarMoeda`), rótulo "Salvar" consistente, `FormField` com asterisco de obrigatório, CadastroPadrao idêntico em todas as telas.
**Violado**: três padrões de criação (página própria × drawer × modal ad hoc) e três de confirmação (confirm nativo × modal próprio × prompt); erro ora inline ora `alert()`; dois componentes diferentes para "escolher cliente" (um bom na OS, um quebrado no equipamento); Medições com filtros fora do padrão das demais listas; breadcrumbs crus ("Medicoes", "Contas-pagar").

---

## Medições por papel (tarefas reais, contadas)

### Escritório (desktop)
| Tarefa | Interações | Atrito (1=liso, 5=trava) |
|---|---|---|
| Cadastrar cliente (mínimo útil) | 6 cliques + 4 campos / 2 telas | 2 |
| Cadastrar equipamento | 8 cliques + 4 campos | **4** (busca de cliente não filtra) |
| Abrir OS + agendar (técnico+veículo+data) | 6 cliques + 3 campos | 2 (vira 4 se o tipo não tem técnico com competência) |
| Executar + concluir OS no desktop | ~24 cliques (17 itens um a um) | 3 |
| Gerar medição/faturar | **2 cliques** até a medição com e-mail/WhatsApp/link | 1 |
| Lançar conta a pagar | 4 cliques + 4 campos | **3** (3 cadastros sem inline) |
| Importar NF-e (até o upload) | 2 cliques (dropzone na lista) | 1 |
| "Quanto entra este mês?" | 1 clique (dashboard financeiro) | 1 |
| Cadastros (serviços/produtos/categorias/tipos) | 2 cliques até qualquer um | 1 |

Navegação consistente em ~1s; nenhuma tela lenta encontrada.

### Técnico (celular)
| Tarefa | Interações | Atrito |
|---|---|---|
| Login → Meu dia (cartão com hora/cliente/endereço/rota) | 1 toque + 2 campos | 1 |
| Checklist caminho feliz (11 itens) | 2 toques ("TUDO OK") | 1 |
| 6 medições numéricas (chips de unidade) | 6 campos | 1 |
| Item "Atenção" (foto + observação obrigatórias) | 4 toques + 1 campo | 1 |
| Serviço extra | 2 toques + 1 campo | 1 |
| Concluir equipamento com pendência | banner nomeia a falta, mas não leva ao item | 2-3 |
| Concluir atividade | diálogo lista pendências **clicáveis** → resumo → concluída | 1 |
| Offline no meio da execução | header "Offline · N", sync automático ao voltar (~3s); PWA recarrega sem internet | 1 |
| **Total caminho feliz** | **≈10 toques + 7 campos** do login à OS concluída | — |

### Cliente (portal/QR, celular)
| Tarefa | Interações | Atrito |
|---|---|---|
| Abrir chamado pelo QR (anônimo) | 2 toques + 2 campos → protocolo CHM | 2 |
| Login no portal | 3 interações | 2 (erro apaga o e-mail) |
| Acompanhar o chamado (timeline) | 2 toques | 1 |
| Relatório até o PDF | 3 toques | 1 |
| **Ver boleto/fatura** | **não encontrável** (sem "Financeiro" na nav; URL → "sem permissão"; medição escondida em Documentos) | **4** |

---

## Achados 🔴 (atrapalham muito o dia a dia)

**E1. Form de Equipamento › busca de cliente NÃO filtra.** Digitando "hospital" o dropdown segue mostrando os 144 clientes em ordem alfabética, sem "nenhum resultado" (`components/ui/cliente-combobox.tsx`); **o mesmo campo na Nova OS funciona** (componente diferente). *Impacto*: toda pessoa cadastrando equipamento, várias vezes ao dia; com 500+ clientes, inviável. *Melhoria*: usar no equipamento o mesmo seletor da Nova OS. *(princípios 5 e 6)*

**E2. Lançar dinheiro exige "sair, cadastrar e RECARREGAR".** Na Nova Conta a Pagar, fornecedor/categoria/centro de custo são selects simples com a instrução literal *"Não está na lista? Cadastre o fornecedor e recarregue esta tela"* (perdendo o que foi digitado) — e a MESMA tripla se repete no lançamento financeiro da NF importada (`conta-pagar-form.tsx:86,100,105`; `financeiro-nota.tsx:130,135`). *Impacto*: financeiro lança despesa todo dia; fornecedor novo é frequente. *Melhoria*: trocar pelos `select-cadastro-rapido` que já existem no resto do sistema. *(princípio 1 — violado 5× nas duas telas mais quentes do financeiro)*

**E3. Preço do serviço adicional entra por `window.prompt`.** Caixa nativa do navegador, sem máscara de moeda, sem validação visual, estética de 1999 — e é **entrada de dinheiro** (`os-adicionais.tsx:40`). *Impacto*: toda cobrança de adicional. *Melhoria*: modal próprio com campo de moeda (padrão já existe no sistema). *(princípios 3 e 6)*

**E4. Contas a Receber corta em 500 (e Pagar em 300) sem avisar.** Fatia fixa + filtro só no navegador (`contas-receber/page.tsx:39`, `contas-pagar/page.tsx:63`): passou do limite, contas SOMEM da tela e o mês "fecha" errado. *Impacto*: a tela mais usada do escritório; cresce todo mês. *Melhoria*: paginação/busca de servidor no padrão das outras listas (infra pronta). *(princípio 5)*

**E5. Cliente não tem "ficha" — e o caminho mais comum não tem atalho.** `clientes/[id]/` só tem `editar/`; a ficha é o formulário. Dali **não há "Nova OS" nem "Novo orçamento"** (o atalho existe no equipamento e na solicitação — só falta no lugar onde o telefone toca). E ao salvar um cliente novo, a tela volta à lista (página 1, "Academia…"), sem toast e sem destacar o criado — é preciso procurá-lo para continuar o cadastro. *Impacto*: "cliente ligou → abrir OS" é o fluxo nº 1 do balcão. *Melhoria*: página de perfil do cliente (ou cabeçalho de ações no editar) com "Nova OS/Novo orçamento"; pós-salvar aterrissar no cliente criado. *(princípios 3 e 6)*

**C1. Portal: fatura/boleto INVISÍVEL para o contato padrão.** Nav = Início/Chamados/Equipamentos/Documentos/Agenda — sem "Financeiro"; `/portal/financeiro` por URL → "Você não tem permissão"; a medição existe, mas escondida em Documentos com rótulo técnico "REL-2026-0004 · Medição". O texto do login promete financeiro. *Impacto*: a pergunta mensal "cadê meu boleto?" segue indo por WhatsApp/telefone — o portal não desafoga o escritório. *Melhoria*: item "Faturas" na nav quando o contato tiver a permissão + revisar a permissão-padrão ao conceder acesso + rótulo leigo ("Fatura de Outubro/2026"). *(princípio 6 + propósito do portal)*

**C2. QR: o chamado anônimo NÃO aceita foto.** O form do QR pede nome/e-mail/telefone/descrição — sem campo de foto; o form equivalente do portal logado comprime e envia fotos. O QR é exatamente onde o cliente está NA FRENTE do problema. *Impacto*: toda abertura visual (vazamento, gelo, painel apitando) vira descrição pobre → retriagem por telefone. *Melhoria*: reusar o `chamado-form` do portal (com `reduzirImagem`) na página do QR. *(princípio 6)*

## Achados 🟡 (incomodam)

**Transversais**
- **Y1. Sem toast + 14 `alert()` / 21 `confirm()` / 2 `prompt()` nativos.** Confirmações ora em modal bonito (`inativar-registro.tsx`), ora em caixa do navegador (medições, pedidos, orçamentos, contratos, `crud-cadastro.tsx:102-114`...); o usuário nunca sabe onde a mensagem vai aparecer. *Melhoria*: um componente de toast/confirm da casa e varredura substituindo os nativos. *(3, 6)*
- **Y2. Gravações mudas**: criar item do orçamento da OS (`os-orcamento.tsx:27-33`, `catch {}` vazio) e marcar "executado" (`:37-45`, sem erro); vincular/desvincular orçamento (`os-orcamentos-vinculados.tsx:64,80`); salvar template de e-mail (`email-templates-client.tsx:50`); relatório de contratos (`relatorio-contratos-client.tsx:74`). "Cliquei e não aconteceu" exatamente onde nasce o faturamento. *(3)*
- **Y3. Criação inline faltando fora do financeiro** (além do 🔴 E2): tipo de OS na nova atividade (`os-atividades.tsx:241,281`) e na recorrência do contrato; cargo/perfil no colaborador; produto no pedido de compra; categoria na cobrança. *(1)*
- **Y4. Medições fora do padrão de lista**: filtros de data `mm/dd/yyyy` + botão "Filtrar" (as outras listas têm busca live/chips), sem paginação/contagem, `take: 100`. *(5, 6)*
- **Y5. Fatias fixas menores**: Prazos `take:300`, Pedidos `take:200`, Leads `take:200`. *(5)*

**Escritório**
- **Y6. Trava de competência na Nova OS sem saída inline.** Tipo "Higienização" → "Nenhum técnico com competência" (mensagem ótima, com link), mas o form trava: ou perde o tipo, ou abandona. *Melhoria*: "agendar mesmo assim" com confirmação, ou marcar a competência inline. 
- **Y7. "Buscar CNPJ" com erro genérico** ("Erro inesperado… tente novamente") — não diz se o problema é o CNPJ ou a conexão.

**Técnico**
- **Y8. Banner "falta X" do equipamento não leva ao item** — nomeia a pendência no topo, mas o técnico caça o item entre 17 blocos (o diálogo da ATIVIDADE já tem pendência clicável que pula ao equipamento — copiar o padrão). *(3, 6)*
- **Y9. "Foto (pedida)" não muda após anexar** — só o thumbnail pequeno denuncia; o técnico reabre "ver o que falta" à toa. *(3)*
- **Y10. Thumbnails de foto de 24×24px** (aria-label enganoso "Tirar foto N") — alvo pequeno demais para dedo. *(4)*
- **Y11. Usuário técnico sem perfil cai no sistema inteiro "vazio"** (menu só Dashboard) em vez do app — pegadinha real de onboarding. *Melhoria*: na tela de Usuários, avisar quando role=Técnico sem perfil ligado/sem e-mail casando com o cadastro de Técnicos.

**Cliente (portal/QR)**
- **Y12. Login errado APAGA o e-mail digitado** (e mantém a senha mascarada!). Redigitar e-mail longo no celular irrita. *(3)*
- **Y13. Sem "Esqueci a senha" no portal** — cliente travado fora do horário comercial fica sem saída.
- **Y14. QR: dois botões "Abrir chamado" simultâneos e o rascunho é DESCARTADO sem aviso** ao alternar o painel (reproduzido: texto some). *(3)*
- **Y15. QR: placeholder-como-label** (obrigatório só pelo "*" no placeholder; telefone sem `type=tel` → teclado errado). *(4)*
- **Y16. "Próxima manutenção: —" × OS "Agendada 20/10" (passada)** nos Chamados — a visita atrasada some do radar do cliente. 
- **Y17. Confirmação do QR é beco sem saída**: protocolo CHM sem botão copiar, sem "e agora?", e o anônimo não tem onde consultar depois. Além disso o chamado gravou `contatoOrigemId: null` mesmo com portal ativo — a triagem não sabe quem abriu além do texto.

## Achados 🟢 (polimento)

- **G1.** Datas nativas `mm/dd/yyyy` dependentes do SO (Nova OS, Medições, Conta a Pagar) — padronizar máscara pt-BR.
- **G2.** Labels sem `htmlFor` nos forms de cliente/equipamento (a11y + automação).
- **G3.** Ordenação alfabética "numérica" ("Academia 103" antes de "…19") — collation natural.
- **G4.** **Checklist no desktop é 1 clique por item (17×)** — trazer o "TUDO OK" do app técnico para a execução desktop.
- **G5.** Breadcrumbs crus: "Medicoes", "Contas-pagar", "Fluxo-caixa".
- **G6.** QR inválido → 404 cru do Next, sem marca/orientação ("etiqueta não encontrada — ligue para X").
- **G7.** Chamados do portal sem busca/filtro de status (canceladas misturadas; ruim com 50+).
- **G8.** Documentos do portal com rótulo técnico ("REL-2026-0202 · PMOC") e link abrindo nova aba sem indicação.
- **G9.** Relatório público mostra "—" em campos vazios (omitir a linha fica mais limpo).
- **G10.** Equipamentos do portal sem busca; cards sem o local.
- **G11.** Técnico: progresso "X de 17" sem legenda (17 = 11 itens + 6 medições + fotos).
- **G12.** Técnico: redirect de área proibida é mudo (um aviso curto evitaria confusão com link do escritório).
- **G13.** Técnico: select de equipamento do serviço extra com nomes repetidos sem o local ("Split Hi-Wall" 2×).
- **G14.** "Nova Cobrança" visível para quem só pode ver (`contas-receber-view.tsx:123`) — clique pode dar 403.
- **G15.** Selects menores sem inline: equipe no veículo, tabela de preço no cliente, termo de referência na proposta, modelo de prazo na OS.
- **G16.** Interações do cliente `take: 50` sem "ver mais".
- **G17.** Medição recém-gerada nasce "Rascunho" sem nenhum aviso na OS de que precisa ser enviada (o fluxo de aprovação é a Leva 5 já desenhada — registrado aqui só como lacuna de UX atual).

---

## O que JÁ ESTÁ BOM (preservar)

**Escritório**
- **Form de Novo Equipamento é referência**: "Só 5 campos são obrigatórios", preenchimento por foto com IA, checklist "Obrigatórios 0/5" virando ✓, barra fixa "Faltam N campo(s)", tipo com busca + "+ Novo tipo" inline.
- **Nova OS em 1 tela/6 cliques**: tipo filtra colaboradores por competência (com explicação), veículo puxado automaticamente, aterrissa no detalhe criado.
- **Trava de conclusão da OS**: a melhor mensagem do sistema — nomeia atividade, equipamento, itens sem resposta e fotos faltantes.
- **Vincular equipamento na atividade**: painel inline com busca por nome/TAG/local/tipo + "+ Novo equipamento" — é o modelo a copiar.
- **Faturar em 2 cliques** (OS → Gerar medição → e-mail/WhatsApp/link) e **"quanto entra este mês?" em 1 clique** (dashboard financeiro com A receber/Recebido/Vencido/A pagar/Saldo previsto).
- **CadastroPadrao consistente** (contagem Ativos/Inativos, busca com "/", importar planilha, paginação, CRUD à vista) e **Notas de compra com dropzone + dedup avisado**.
- **Mobile sem overflow** nas telas quentes; erro de form guiado por aba ("há obrigatórios na aba 'Dados Gerais'").

**Técnico**
- Login → **Meu dia direto** (saudação, cartão com hora/duração/cliente/endereço/"Rota no mapa").
- **Fluxo guiado exemplar**: TUDO OK explicado, "Atenção" exigindo foto+observação com botão travado até cumprir, Ditar/Gravar áudio (e o Ditar some offline com dica certa), fotos antes/depois, medições com chips de unidade.
- **Offline de verdade**: "Offline · N", fila local, sync automático, PWA recarrega sem internet, Perfil com estado da sincronização.
- **Serviço extra com expectativa certa** ("não cria outra OS; o escritório decide a cobrança") e pós-conclusão em modo leitura.

**Cliente**
- **Página do QR gera confiança**: identifica aparelho/local e mostra o histórico de manutenção na hora do scan; chamado em 4 interações com protocolo.
- **Detalhe do chamado com linha do tempo** em linguagem de leigo ("Técnico: A designar"); dashboard enxuto; nav de 5 itens idêntica no celular e no desktop.
- **Relatório público no celular excelente**: Baixar PDF/E-mail/WhatsApp fixos, checklist por equipamento com fotos e destaque "Atenção" — 3 toques até o PDF.
- Login com mensagem genérica (não revela e-mail) e portal 100% isolado do sistema interno.

---

## Plano de melhoria em levas pequenas (1 PR por leva, todas 🟢 — nenhuma mexe em banco*)

Prioridade = o que mais acelera o dia a dia por hora de trabalho.

| Leva | Nome | Conteúdo | Resolve |
|---|---|---|---|
| **UX-1** | **Dinheiro sem atrito** | Fornecedor/categoria/centro com `select-cadastro-rapido` na Conta a Pagar E no financeiro da NF; preço do adicional em modal de moeda (fim do `prompt`); consertar as gravações mudas do orçamento da OS | E2, E3, Y2 (parte) |
| **UX-2** | **Achar o cliente e agir** | Busca de cliente do form de equipamento (usar o componente da Nova OS); ações "Nova OS/Novo orçamento" na ficha do cliente; pós-salvar aterrissando no cliente criado | E1, E5 |
| **UX-3** | **Toast da casa** | Componente único de toast + confirm próprio; varredura substituindo os 14 `alert`/21 `confirm` nativos; demais gravações mudas; aviso no redirect do técnico | Y1, Y2 (resto), G12 |
| **UX-4** | **Financeiro em escala** | Contas a Receber/Pagar com paginação+busca de servidor (infra pronta); Medições no padrão das listas; fatias de Prazos/Pedidos/Leads | E4, Y4, Y5 |
| **UX-5** | **Portal que cobra sozinho** | Item "Faturas" na nav (permissão padrão revista) com rótulo leigo; "Esqueci a senha"; login preservando o e-mail | C1, Y12, Y13 |
| **UX-6** | **QR completo** | Foto no chamado do QR (reusar o form do portal); labels + `type=tel`; CTA único e rascunho preservado; confirmação com "copiar protocolo" + próximo passo; 404 amigável; `contatoOrigemId` quando identificável | C2, Y14, Y15, Y17, G6 |
| **UX-7** | **Polimento do app técnico** | Pendência do banner clicável (padrão do diálogo); "Foto ✓ (1)"; thumbnails ≥44px; legenda do progresso; local no select do extra; aviso "técnico sem perfil" na tela de Usuários | Y8–Y11, G11, G13 |
| **UX-8** | **Consistência miúda** | "TUDO OK" no desktop; saída inline na trava de competência; inline nos selects restantes (tipo de OS etc.); datas pt-BR; breadcrumbs; `htmlFor`; ordenação natural; "Nova Cobrança" por permissão; agenda do portal com "visita a reagendar" | Y3, Y6, Y16, G1–G5, G14, G15 |

*\*Única exceção possível: se "Faturas" no portal pedir uma permissão-padrão nova por contato, a UX-5 vira 🔵 com SQL aditivo — decidir na hora.*

Cada leva segue o rito de sempre: testes reais (PostgreSQL + DOM), rodada de mutação, prints desktop+celular, sem merge.

## Top-10 — o que mais deixaria o sistema rápido e simples

1. **Fornecedor/categoria/centro inline** na conta a pagar e na NF (E2) — fim do "cadastre e recarregue" diário.
2. **Preço do adicional em modal de moeda** (E3) — a pior entrada de dinheiro do sistema hoje.
3. **Busca de cliente do form de equipamento** (E1) — 1 componente trocado, tarefa diária destravada.
4. **Ficha do cliente com "Nova OS daqui"** + aterrissar no cliente criado (E5) — o fluxo do telefone em 2 cliques.
5. **Toast único da casa** e fim dos alert/confirm/prompt (Y1) — feedback previsível em todo o sistema.
6. **"Faturas" visível no portal** (C1) — o boleto se entrega sozinho, o telefone para de tocar.
7. **Foto no chamado do QR** (C2) — triagem certa de primeira.
8. **Contas a Receber/Pagar paginadas de verdade** (E4) — o financeiro continua confiável quando crescer.
9. **Pendência clicável + "Foto ✓" no app técnico** (Y8/Y9) — menos idas e vindas no sol.
10. **"TUDO OK" na execução desktop** (G4) — 17 cliques viram 1 para o escritório.

---

*Evidências: screenshots da exploração em `scratchpad/audit/ux/{escritorio,tecnico,cliente}/` (sessão de auditoria; não versionados). Varredura estática com âncoras `arquivo:linha` ao longo do texto.*
