# Pronto pra janeiro 3 — varredura das entregas de 27/11 (#269 a #281)

Percorri tudo o que entrou de #269 a #281 como um cliente **novo**, com dados fictícios e sem tocar a produção. Foram três frentes:

1. **Navegação de verdade** (Playwright, desktop e celular). O super admin cria a empresa "Aurora Clima (fictícia)", o 1º administrador troca a senha e entra, e a varredura abre as 28 telas das entregas, nos dois tamanhos. Em cada tela ela confere:
   - tela de erro;
   - resposta 5xx do servidor;
   - estouro de largura no celular;
   - desvio para login ou sem-permissão.
2. **Leitura do código por área.** Procurei o que costuma ficar pela metade:
   - falta editar, excluir ou reativar;
   - botão mudo, tela sem volta ou erro sem mensagem;
   - permissão só na tela ou só no servidor;
   - tela que não atualiza depois de salvar.
3. **Os fluxos** com dados fictícios na empresa nova:
   - cliente que exige o pedido;
   - contato no portal;
   - pedido enviado, recusado e resolvido por outro caminho;
   - pedido só de orçamento.

**Resultado.** A navegação **não achou tela quebrada**: as 28 telas abrem sem erro e sem estourar no celular, e o 1º acesso com a troca de senha funciona. As pontas soltas estavam **dentro dos fluxos**. São 35 correções de menor risco, feitas e testadas (abaixo), e 15 pontos que são decisão de negócio ou maiores, na lista **Para o Zé decidir**.

**Banco:** nenhum SQL. **Comissões:** não tocado.

## Tabela tela × ação

Legenda: **ok** já funcionava (conferido); **corrigido** nesta leva (com teste); **pendente** vai para o Zé decidir (número da lista no fim).

### Empresas (super admin) e 1º administrador

| Tela | Ação | Situação |
|---|---|---|
| Empresas | criar empresa + 1º admin (perfis, tipos de OS, configuração) | ok |
| Empresas | CNPJ ou e-mail repetido, validação | ok (mensagem clara) |
| Empresas | ADMIN de empresa: não vê a tela, servidor 403 | ok |
| Empresas | **inativar / reativar** a empresa | **corrigido** (não existia; o login já barrava empresa inativa, mas só pelo banco) |
| Empresas | lista no celular | **corrigido** (cartões; antes, tabela com rolagem lateral) |
| Empresas | aviso "empresa criada" | **corrigido** (agora tem Fechar) |
| Empresas | editar dados da empresa pelo super admin | pendente (2) |
| Empresas | gerar nova senha do 1º administrador | pendente (1) |
| 1º acesso | só a tela de troca abre; APIs 403 até trocar | ok |
| 1º acesso | senha fraca, confirmação, Sair | ok |
| Login | mesmo e-mail em duas empresas | pendente (3) |

### Portal do cliente (senha segura)

| Tela | Ação | Situação |
|---|---|---|
| Cliente › Portal | liberar acesso (senha mostrada uma vez, Copiar, convite) | ok |
| Cliente › Portal | **liberar e depois Salvar a ficha desligava o portal** | **corrigido** (a chave "Portal ativo" acompanha o servidor) |
| Cliente › Portal | revogar que falha | **corrigido** (antes: nada acontecia) |
| Cliente › Portal | e-mail inválido | **corrigido** ("E-mail inválido", não "Dados inválidos") |
| Cliente › Portal | quem ainda não fez o 1º acesso | **corrigido** (selo "Aguardando 1º acesso") |
| Cliente › Portal | botão Fechar no celular | **corrigido** (44 px) |
| Portal | 1º acesso com troca, esqueci a senha, gerar nova, revogar | ok |
| Portal | "Esqueci a senha" de empresa sem e-mail configurado | pendente (1) |

### Exportar dados

| Tela | Ação | Situação |
|---|---|---|
| Configurações › Exportar dados | zip em streaming, um CSV por cadastro, histórico, trilha | ok |
| CSV | acentos no Excel | ok (UTF-8 com BOM, `;`, CRLF) |
| CSV | volta pela Implantação | ok (mesmos cabeçalhos do importador) |
| Permissão | só administrador (tela e servidor) | ok |
| Exportar | **exportação que não começa** (sessão, permissão, erro) | **corrigido** (aviso em 20 s; antes, "Gerando…" por 6 min e nada) |
| Exportar | demorou mais de 6 min | **corrigido** (aviso de onde ver o resultado) |
| Exportar | "Não concluída" | **corrigido** (mostra o motivo gravado) |
| CSV | célula começando com `=`, `+`, `-`, `@` | pendente (4) |

### Material × Peça e regra de materiais

| Tela | Ação | Situação |
|---|---|---|
| Produto | criar, editar, inativar, reativar; Uso pela categoria no produto novo | ok |
| Orçamento, PDF, link do cliente, OS, fatura | os dois modos da empresa; trocar o modo não muda o que já existe | ok |
| Importação | coluna `uso` | ok |
| Ajuda do Uso, da Categoria e da planilha | **diziam "Material: sem valor para o cliente"** (falso no modo "Cobrado à parte") | **corrigido** |
| Material lançado em campo no "Cobrado à parte" | virar cobrança | pendente (7) |

### Configurações (leva G)

| Tela | Ação | Situação |
|---|---|---|
| Produtos e serviços | editar pela linha, inativar, reativar | ok |
| Tabela de preço | adicionar em massa (filtro, selecionar todos) | ok |
| Tabela de preço | **catálogo que não carrega** | **corrigido** (dizia "Nada para adicionar") |
| Tabela de preço | reajuste em massa (% ou valor) com desfazer | pendente (6) |
| Orçamento | **trocar o cliente**: item travado sem o preço da tabela; cliente sem tabela deixava travado | **corrigido** (item novo recebe o preço da tabela; sem tabela, destrava) |
| Orçamento | item sugerido do histórico ignorava a tabela | **corrigido** |
| Orçamento | serviço com total digitado: o servidor pedia motivo e a tela não tinha o campo | **corrigido** (a tela compara como o servidor; recusou, o campo aparece) |
| Orçamento (lápis) e OS (lápis e editor) | **sem "Alterar preço de tabela" o campo aparecia** (o servidor recusava) | **corrigido** (some o campo, cadeado no editor da OS) |
| Fatura avulsa / medição | trava de preço de tabela | pendente (5) |
| Meu perfil | editar dados, senha, e-mail com confirmação | ok |
| Meu perfil | **foto escolhida fora da aba Dados se perdia** | **corrigido** (vai para Dados, onde salva) |
| Anotações | arrastar, posição por usuário | ok |
| Anotações | **"voltar" por cima do botão encostado à esquerda** | **corrigido** |

### Notas de compra

| Tela | Ação | Situação |
|---|---|---|
| Notas | filtro de data, colunas, busca, celular | ok |
| Notas | reordenar colunas (todas as tabelas `TabelaPro`, 37) | ok |
| Notas | tabelas feitas à mão sem reordenar | pendente (13) |
| Gaveta DANFE | **Baixar PDF/XML que falha** | **corrigido** (o motivo aparece na tela; um jeito só para baixar arquivos) |
| Descartar | permissão, trilha | ok |
| Descartadas | como recuperar | **corrigido** (diz: importe o XML de novo); "restaurar" de verdade pendente (12) |

### Ordens de serviço (leva F)

| Tela | Ação | Situação |
|---|---|---|
| OS | filtro do mês, setas, "Este mês" | ok |
| Filtros lembrados | OS, clientes, orçamentos, faturas, contas, notas, estoque… | ok |
| Filtros lembrados | **Cadastros padrão (Produtos, Serviços, Usuários…)** | **corrigido** (o mesmo hook) |
| Filtros lembrados | **guardava "veio do financeiro" (`de=`)** nas Notas | **corrigido** |
| Filtros lembrados | **extrato de um produto herdava o filtro de outro** | **corrigido** |
| Filtros lembrados | QR Codes, checklists preenchidos, despesas de campo | pendente (14) |
| Sino | marcar como lido, levar ao item | ok |
| Sino | **"NF chegou nos seus pedidos" com vários abria só o 1º** | **corrigido** |
| Sino | veículos e leads levam à lista inteira | pendente (15) |
| Cabeçalho da OS | preso só na linha da OS | ok |
| Legenda da foto | editar (escritório e app), permissão, trilha | ok |
| Legenda / excluir foto | **o Histórico só mostrava depois de recarregar** | **corrigido** |
| Legenda | voltar para a do sistema | pendente (11) |

### Pedido do cliente (PC-1 e PC-2)

| Tela | Ação | Situação |
|---|---|---|
| Ficha, etiqueta, gaveta, em massa, trava da NF e da execução, liberar com motivo, nº na NF, filtro com total, painel, sino | (PC-1) | ok |
| Portal | **arquivo de 3,3 a 5 MB falhava sem explicação** (a hospedagem recusa acima de 4,5 MB) | **corrigido** (limite 3 MB na tela e no servidor; aviso claro; o 413 vira o aviso) |
| Portal e gaveta | **"1.500" virava R$ 1,50** | **corrigido** (um leitor de valor só, o do jeito brasileiro) |
| Portal | **aviso de recusa eterno** (mesmo resolvido) | **corrigido** (só enquanto algum serviço espera) |
| Portal | abrir o arquivo que enviou | **corrigido** (rota só do próprio cliente) |
| Portal | "Em execução" para OS não iniciada; erro ao ler o arquivo; rodapé do celular com 7 itens | **corrigido** |
| Escritório | **pedido "em conferência" para sempre** quando a OS se resolve por outro caminho | **corrigido** (sino, filtro e etiqueta contam só item que ainda espera); fechar com situação própria pendente (8) |
| Escritório | **pedido só de orçamento levava a uma lista de OS vazia** (sino, painel, push) | **corrigido** (abre o orçamento) |
| Lista de OS | **filtro "conferir" invisível e sem Limpar** | **corrigido** (chip "Pedido recebido — conferir" com a contagem) |
| Gaveta de conferir | **Confirmar/Recusar para quem não pode** | **corrigido** (somem; o servidor já recusava) |
| Gaveta de conferir | "o faturamento foi liberado" sem nada ligado | **corrigido** |
| Lembrete (cron) | régua, anti-repetição, liga/desliga, sem e-mail não envia | ok |
| Lembrete | **o link do e-mail perdia o destino depois do login** | **corrigido** (o login volta para "Pedido de compra"; só rota interna do portal) |
| Lembrete | para quem não tem acesso ao portal | pendente (9) |
| Recusa | o cliente não é avisado por e-mail | pendente (10) |

**Rodar o cron localmente.** Precisa de `DATABASE_URL` local e da configuração de e-mail da empresa; sem ela, nada sai, a falha fica no `email_log` e há nova tentativa no dia seguinte.

```
CRON_SECRET=teste-local npx next start -p 3000
curl -s -H "Authorization: Bearer teste-local" http://localhost:3000/api/cron/lembretes-pedido
```

**Rodado localmente nesta varredura.** Sem o segredo, a rota respondeu `401`. Com o segredo, respondeu `{"ok":true,"clientes":1,"enviados":0,"itens":0,"erros":1,"pulados":0}`. O "erros: 1" é a empresa fictícia sem e-mail configurado: nada sai, e a rotina tenta de novo no dia seguinte.

## Prints (dados fictícios)

Em `docs/prints/pronto-janeiro-3/` (`antes-*` e `depois-*`, cada um em `-desktop` e `-celular`):
- `empresas`: antes, a linha sem ação nenhuma; depois, Inativar/Reativar e, no celular, os cartões;
- `cliente-portal`: o selo "Aguardando 1º acesso";
- `os-conferir`: a lista que o sino abre. Antes, sem o filtro visível e com a OS já resolvida; depois, o chip "Pedido recebido — conferir" e só a OS que espera;
- `pendencias`: a contagem de pedidos para conferir;
- `portal-pedido`: antes, a recusa de um serviço já resolvido no topo; depois, só a recusa do que ainda espera.

Também ficaram os da jornada do cliente novo: `antes-empresas-*` e `antes-primeiro-acesso-*`.

## Para o Zé decidir

1. **Nova senha do 1º administrador pelo super admin.** Hoje, se o admin perde a senha inicial, não há saída: o "Esqueci minha senha" usa o e-mail da própria empresa, e a empresa nova nasce sem e-mail configurado. Isso dá ao super admin um poder dentro da empresa.
2. **Editar os dados da empresa pelo super admin.** Hoje só o administrador da empresa edita, em Configurações.
3. **Mesmo e-mail de login em duas empresas** (usuários e contatos do portal). Só a criação de empresa confere todas; Usuários, Acesso ao app e Portal conferem só a própria. Um dos dois logins nunca funciona. Opções:
   - recusar o e-mail em todas as empresas;
   - deixar escolher a empresa no login.
4. **CSV com fórmulas.** Um nome que começa com `=` abre como fórmula no Excel. Proteger (prefixar `'`) muda a volta pela Implantação.
5. **Trava de preço de tabela na fatura avulsa / medição.** Hoje está pela metade:
   - só trava item novo do catálogo;
   - sem motivo nem trilha;
   - o servidor não confere.

   Ou estende como no orçamento e na OS, ou sai da fatura.
6. **Reajuste em massa da tabela de preço** (% ou valor, com desfazer). A leva G entregou "adicionar em massa".
7. **Material lançado em campo, no modo "Cobrado à parte"**: só baixa estoque, não vira cobrança.
8. **Pedido do portal resolvido por outro caminho.** Hoje some das contagens, mas fica "CONFERIR" no banco. Encerrar com uma situação própria ("Resolvido por outro pedido")?
9. **Lembrete para quem não tem acesso ao portal.** O e-mail de compras recebe o botão do portal sem ter login. Opções:
   - conferir se o contato existe;
   - mudar o texto ("responda com o pedido em anexo").
10. **E-mail ao cliente quando o pedido é recusado** (template novo).
11. **Legenda da foto voltar para a do sistema** ("Antes do serviço" etc.).
12. **"Restaurar" nota descartada.** Hoje é preciso importar o XML de novo.
13. **Tabelas feitas à mão sem reordenar colunas:** Faturamento de contratos, Admin › Empresas, Documentos do colaborador, Checklist diário e Separação da OS. Migrar para a tabela comum ou ajustar o doc.
14. **QR Codes, Checklists preenchidos e Despesas de campo:** o filtro fica só na memória da tela (não vai para a URL, não é lembrado).
15. **Sino de veículos e leads leva à lista inteira.** É anterior a estas entregas e precisa de filtros nessas listas.

## Testes

| Arquivo | O que prova |
|---|---|
| `pronto-janeiro-3` | trava de preço (item novo × gravado, destravar), botão das anotações, destino do portal, valor e arquivo do pedido, filtros lembrados, e as ligações de cada tela |
| `pronto-janeiro-3-pg` (PostgreSQL real) | inativar/reativar empresa (403, 409, 400, 404); "em conferência" só com item esperando, pedido só de orçamento, filtro da lista; arquivo do portal só do próprio cliente; e-mail inválido; 3 MB no servidor |
| `pronto-janeiro-2` | Empresas: Inativar/Reativar, cartões no celular, Fechar o aviso |
| `portal-senha-provisoria-ui` | liberar liga o portal na ficha; "Aguardando 1º acesso"; revogar com erro |
| `exportar-dados-ui` | não começou, demorou, motivo da "Não concluída" |
| `notas-compra-2-ui` | Baixar PDF/XML por fetch, erro na tela |
| `os-fotos-anexos-ui` | o Histórico atualiza depois de excluir e de editar a legenda |
| `leva-g-ui` | catálogo que não carrega, foto vai para Dados, lápis sem a permissão |
| `tabela-preco-seletor-ui` | trocar o cliente com item lançado (preço da tabela, destrava) |
| `pedido-cliente-portal-ui` | recusa só enquanto espera, arquivo enviado, "1.500", 3 MB e 413, conferir sem permissão, aviso do confirmar |

---

# Leva I — correções gerais (anotações do Zé)

Vai num segundo PR, sobre a varredura. Sem SQL.

| # | Tela / onde | O que fazia | Agora | Situação |
|---|---|---|---|---|
| 1 | **Todas as tabelas** (`TabelaPro`): menu "Colunas" | ficava cortado pela altura da tabela (em /veiculos com 1 veículo, quase não aparecia) | abre em portal, fixo na tela, para baixo se couber e senão para cima, com a altura do espaço que sobra e rolagem. O ⋮ de ações usa o mesmo cálculo (`lib/ui/flutuante`) | **corrigido** |
| 2 | **Camadas** (z-index) | o modal de confirmação (ex.: inativar cargo pelo ⊘ em Configurações › Cargos) abria atrás da gaveta, sem dar para clicar; o botão Anotações ficava atrás da gaveta | uma escala só, em `lib/ui/camadas`: gaveta 60 < modal 70 < foto 75 < menus e dicas 80 < anotações 84–89 < confirmação 95 < toast 100. Os modais "soltos" (calendário, anexos, contrato, ações em massa, montador de equipes, scanner) entraram na camada do modal | **corrigido** |
| 3 | **Menu lateral** | o recolhido ficava no navegador (igual para todo usuário), e o mouse não fazia nada | o clique **fixa** (aberto/fechado), lembrado **por usuário**. Sem escolha: tela larga (≥ 1280 px) abre; notebook começa recolhido e o mouse expande **por cima** (temporário, sem empurrar a página). Quem clicou para fechar não vê o menu abrir com o mouse (`lib/layout/menu-lateral`) | **corrigido** |
| 4 | **Sair sem salvar** (todas as telas de edição) | saía e perdia o que foi digitado | `components/ui/proteger-saida` (detalhes abaixo) | **corrigido** |
| 5 | **CEP** (todos os formulários com CEP) | cada tela de um jeito (lupa, só a ViaCEP, sem prazo) | um campo só, `CampoCep` (detalhes abaixo) | **corrigido** |
| 6 | **Notas de compra**: chave de acesso | botão "Copiar" ao lado | clicar no número copia os 44 dígitos e mostra "Chave copiada."; o botão saiu (lista, gaveta e página da nota) | **corrigido** |
| 7 | **/ordens**: filtro de mês | olhava também a data de **abertura** (a OS aberta em outubro e agendada para novembro aparecia em outubro) | olha a data **agendada / de execução** (atividade agendada, iniciada ou concluída) e a previsão da OS. A OS sem data nenhuma aparece no filtro rápido **"Sem agendamento"** (com a contagem, em qualquer período). O padrão continua o mês atual | **corrigido** |
| 8 | **Veículo**: responsável e equipe | botões "editar no contexto" (editar o colaborador ali dentro) | o nome do escolhido vira **link** que abre o cadastro em outra aba; o formulário do veículo continua aberto | **corrigido** |

**Item 4, sair sem salvar.** Envolve as 22 páginas de novo/editar (cliente, colaborador, contrato, equipamento, equipe, conta a pagar, cobrança, fatura, orçamento, veículo, pedido avulso, PMOC, envio de documentação), a nova OS, Meu perfil e os dados da empresa.
- **Quando pergunta**, só se algo foi digitado dentro do formulário:
  - num link interno;
  - no voltar do navegador;
  - ao fechar ou recarregar a aba (o aviso do navegador).
- **O texto:** "Sair sem salvar? As alterações deste formulário ainda não foram salvas", com os botões "Continuar editando" e "Sair sem salvar".
- **Não pergunta depois de salvar:** o envio segura o aviso enquanto o salvar navega, e quem salva e fica na tela avisa com `marcarFormularioSalvo()`.
- **Campos de busca** marcados com `data-sem-aviso` não contam como alteração.

**Item 5, o CEP.** O `CampoCep` está em unidade (nas duas telas), colaborador, admissão, dados da empresa, cadastro rápido de unidade e na edição da unidade no contexto.
- **Sem lupa:** completou os 8 dígitos, consulta. O endereço preenche logradouro, bairro, cidade e UF; número e complemento ficam com a pessoa.
- **Consulta:** ViaCEP; se ela cair, a BrasilAPI. Cada uma espera no máximo 4 s, então nunca trava (`lib/cep`).
- **Um jeito só:** a consulta é a do `lib/cep` que já existia no master (a mesma que a Leva J, #285, usa na admissão e na ficha do colaborador). O `buscarCep` mantém a assinatura de sempre (endereço ou nulo) e passa pela mesma consulta, com a reserva e o prazo. Um teste garante que nenhum outro arquivo consulta CEP por conta própria. Quando o #285 entrar, o campo de CEP da ficha do colaborador fica sendo o `CampoCep`.
- **CEP inexistente ou consulta fora do ar:** diz e deixa digitar à mão.

Neste ambiente de teste não há acesso à internet, por isso o print mostra a mensagem "A consulta de CEP não respondeu". A consulta que preenche está provada nos testes.

**Por que os modais "soltos" mudaram de camada.** Um modal aberto de dentro de uma gaveta ficava atrás dela. Agora qualquer modal (z-70) fica acima de qualquer gaveta (z-60). O app do técnico e o painel da IA não foram tocados.

## Prints da Leva I (dados fictícios)

Em `docs/prints/leva-i/` (`antes-*` e `depois-*`, desktop e celular):
- `veiculos-colunas`: o menu cortado × inteiro;
- `cargo-inativar`: a confirmação atrás × na frente da gaveta;
- `menu-lateral-notebook` e `menu-lateral-hover`: a 1180 px, o mouse expande por cima;
- `sair-sem-salvar`: saía × "Sair sem salvar?";
- `colaborador-cep`: o campo com a dica;
- `nota-chave`: sem o botão Copiar;
- `ordens`: o chip "Sem agendamento";
- `veiculo-form`: o lápis × o nome como link.

## Testes da Leva I

| Arquivo | O que prova |
|---|---|
| `leva-i` | posição do menu flutuante; a ordem das camadas e que cada componente usa a sua (e nenhum modal solto em z-50); a regra do menu lateral; quando um link sai da tela e a janela do envio; o CEP (ViaCEP, reserva, prazo, inexistente × fora do ar, o endereço aplicado); as ligações (telas com o aviso, formulários com o `CampoCep`, a chave, o veículo) |
| `leva-i-ui` | o menu "Colunas" em portal fora da tabela; o modal por cima da gaveta; sair sem salvar (sem alteração, com alteração, busca não conta, depois do envio, salvo na tela, fechar a aba); o `CampoCep`; a chave copiando |
| `leva-i-pg` (PostgreSQL real) | novembro mostra as agendadas, executadas ou previstas para novembro (não as só abertas nele); outubro vazio; "Sem agendamento" mostra e conta a OS sem data em qualquer período; o padrão é o mês atual |
