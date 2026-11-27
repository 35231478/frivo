# Pronto pra janeiro: o percurso de um cliente novo, de ponta a ponta

Uma empresa criada do zero, sem nada do seed de demonstração, fez o caminho inteiro como um cliente novo
faria: configurar a empresa, importar, orçamento, aprovação, OS, app do técnico, conclusão e faturamento.
Todo atrito ficou anotado. Os de baixo risco foram corrigidos nesta leva. Os demais estão na lista do fim,
com a pergunta de cada um.

Dados e prints **fictícios**: "Refrigeração Nova Era Ltda (fictícia)", cliente "Padaria Pão Quente (fictícia)",
técnico "Diego Técnico (fictício)".

## O percurso

| # | Passo | Como foi | Resultado |
|---|---|---|---|
| 1 | Primeiro login da empresa vazia | Painel, Configurações e Implantação | ✅ A Implantação guia bem. O painel mostrava `Sexta-feira, 27 de novembro ·`, com o "·" pendurado (**corrigido**) |
| 2 | Dados da empresa | Configurações › Dados da empresa | ✅ Salvou. O CEP não preencheu o endereço: a consulta vai do navegador ao ViaCEP, bloqueado neste ambiente, então não dá para verificar aqui |
| 3 | Serviço, cliente e colaborador | Serviço pela tela; cliente e colaborador por planilha (Implantação) | ✅ |
| 4 | Acesso do técnico ao app | Ficha do colaborador › Acesso ao app | ⛔ **"Nenhum perfil de Técnico encontrado"**: a empresa nova não tem perfis de acesso (item A da lista). Contorno: Configurações › Perfis de acesso › Novo perfil, tipo Técnico. Depois disso, ✅ |
| 5 | Orçamento | Orçamentos › Novo (cliente + serviço do catálogo) | ✅ |
| 6 | Aprovação | Copiar link → o cliente aprova no link, com nome, CPF e assinatura | ✅ A equipe não consegue registrar "cliente aprovou" (item D) |
| 7 | Gerar OS | Orçamento aprovado › Gerar OS (Diego, hoje 14:00) | ✅ Com dois atritos **corrigidos**: com o Diego escolhido, a lista dizia "Nenhum técnico cadastrado"; e digitar "1400" na hora já preenchida (08:00) virava **08:01** |
| 8 | App do técnico (celular) | Meu dia › Cheguei › Concluir atividade | ✅ A conclusão pede equipamento: o cliente novo não tem nenhum, e o técnico teve de "concluir sem equipamento — justificar" (item E). O "Cheguei" não tirou a OS de "Agendada" (item G) |
| 9 | Faturar | OS › aba Financeiro | ⛔ **Passo sem saída**: "Esta OS ainda não foi faturada", sem botão e sem motivo. O "O que falta" mandava "Gerar a medição", vocabulário de contrato. A causa: nenhum item marcado como executado, porque concluir no app não marca (item F). **Corrigido**: a aba explica e leva à aba Comercial; o "O que falta" aponta o passo certo |
| 10 | Faturar (de novo) | Comercial › Marcar executado → Financeiro › Faturar | ✅ Gerou a fatura MED-1 (R$ 280,00) e a conta a receber prevista. Faturar pelo orçamento **e** pela OS não cobra duas vezes (a trava existe) |

## 🟢 Corrigido nesta leva (sem banco)

| Atrito | Antes | Agora | Onde |
|---|---|---|---|
| OS avulsa concluída sem item executado | Aba Financeiro: "Esta OS ainda não foi faturada.", sem botão nem explicação | "Nada a faturar ainda: nenhum item desta OS está marcado como executado." + **Marcar os itens executados (aba Comercial)** | `components/os/os-financeiro.tsx`, `os-detalhe.tsx` |
| "O que falta" da OS concluída | Sempre "Gerar a medição para faturar a OS" (aba Financeiro) | Contrato: igual. Avulsa: **"Faturar a OS"**. Avulsa sem item executado nem adicional "Cobrar": **"Marcar os itens executados para faturar a OS"**, na aba Comercial | `lib/os/central.ts` (`pendenciaFaturar`) |
| Seletor de colaboradores com todos já escolhidos | "Nenhum técnico cadastrado + Cadastrar agora" | "Todos os colaboradores já estão na atividade" (o "Cadastrar agora" continua) | `components/os/seletor-tecnicos.tsx`, `components/ui/select-cadastro-rapido.tsx` (`textoVazio`) |
| Hora já preenchida (08:00 sugerido) | Clicar e digitar somava ao fim: "1400" virava 08:01 | Ao entrar no campo, a hora fica selecionada e o que se digita substitui | `components/ui/input-data-hora.tsx`, `input-hora.tsx` |
| Painel da empresa sem nome fantasia | `Sexta-feira, 27 de novembro ·` | `Sexta-feira, 27 de novembro` (o "·" só com nome) | `app/(dashboard)/dashboard/page.tsx` |
| Iniciais do avatar | "Diego Silva (apelido)" virava **D(** | **DA**: a pontuação da frente das palavras é ignorada | `lib/utils.ts` (`iniciais`) |

Não foram tocados `app/tecnico` (o app usa o avatar compartilhado, que ganhou a correção sem mudar o app), as
notificações push, pagamento, login, permissões ou RBAC.

## O resto: decisões e riscos (não mexi)

| # | Achado | Por que não corrigi | Pergunta |
|---|---|---|---|
| **A** | **Empresa nova não tem perfis de acesso.** "Acesso ao app" falha com "Nenhum perfil de Técnico encontrado". Os 5 perfis padrão só existem pelo seed (`prisma/seed.ts` / `seed-perfis.ts`) | RBAC é área proibida | Criar os 5 perfis padrão quando a empresa nasce? Rodar `seed-perfis.ts` em cada empresa nova de janeiro? |
| **B** | Não há criação de empresa nem cadastro de conta no produto: a empresa nova só nasce por seed ou script | Decisão de produto e de segurança de produção | Como as empresas de janeiro serão criadas? Junto com a empresa, criar perfis (A) e tipos de OS (C)? |
| **C** | Empresa nova sem **tipos de OS**: a tela vazia não sugere modelos | Decisão de produto (quais tipos são padrão) | Criar tipos padrão ou oferecer "usar modelos"? |
| **D** | Orçamento: a equipe registra "Cliente recusou", mas não **"Cliente aprovou"** (aprovação por telefone ou WhatsApp). A aprovação é só pelo link, com assinatura. A regra é intencional (`lib/orcamentos/ciclo.ts`) | Decisão de produto (validade jurídica da aprovação) | Permitir "aprovado por fora" com registro de quem marcou e o motivo? |
| **E** | OS gerada do orçamento **exige equipamento** para concluir. Cliente novo sem equipamento cadastrado cai sempre na exceção "concluir sem equipamento — justificar" | Regra de conclusão e app do técnico | O orçamento deveria escolher o equipamento? Ou o tipo de OS padrão não exige? |
| **F** | **Concluir no app não marca os itens da OS como executados.** O faturamento fica em R$ 0 até o gestor marcar na aba Comercial. A tela agora explica, mas o passo extra continua | Muda faturamento e app do técnico | Concluir a atividade deveria marcar os itens como executados (ou perguntar)? |
| **G** | **"Cheguei" não muda a OS para "Em execução"**: fica "Agendada" no app e no painel até concluir | App do técnico (outra nuvem) | É intencional? |
| **H** | O **nome automático** do orçamento corta o serviço ("Limpeza completa de split… — Padaria…") e aparece assim no documento do cliente ("Objeto da proposta"), na OS e no app | Regra deliberada (`lib/orcamentos/nome.ts`, teto de 34 + 30) | No documento do cliente, usar o nome inteiro? |
| **I** | Página da OS: o React avisa "Only plain objects… Decimal" (itens da OS passados do servidor para a tela com `Decimal`) | Mudar a serialização da OS inteira não é baixo risco | Fazer numa leva técnica própria |
| **J** | A assinatura no link público **se apaga se a janela muda de tamanho** (ex.: girar o celular no meio). É o componente de assinatura | Leva própria (componente compartilhado de assinatura) | Vale guardar o traço ao redimensionar? |
| **K** | O nome fantasia salvo em Configurações só aparece no painel após **novo login** (vem da sessão) | Sessão/login é área proibida | Ler o nome da empresa a cada carregamento? |
| **L** | Implantação, etapa 1: os chips das tarefas não parecem clicáveis | Cosmético, de desenho | Ajustar no próximo passe visual? |

**Artefatos do teste, não do produto** (anotados para não confundir): a criação do orçamento e a conclusão
demoraram só porque o servidor de desenvolvimento compila cada rota na primeira chamada; o "Visualizado" do
orçamento não marcou porque o navegador automatizado se identifica como robô (o filtro de robô está certo).

## Testes

`tests/unit/pronto-janeiro.test.ts` (16 testes): o passo de faturar em cada caso (contrato, avulsa com e sem
item executado, adicional "Cobrar", sem itens) e dentro da central; a aba Financeiro com e sem saldo, sem o
atalho, de contrato, não concluída e sem permissão; o seletor com todos escolhidos e sem nenhum cadastrado; a
hora selecionada ao entrar (e o campo vazio); as iniciais. Contra o código antigo, 13 dos 16 falham. Os 3 que
passam nos dois são guardas de regressão.

**Suíte inteira:** 8231 passam. Falham só 2, de `tests/unit/app-campo-leva1-pr2-pg.test.ts` (app de campo).
Eles dependem do relógio: rodando entre 00:00 e ~03:30 (Brasília), o "término informado" de horas antes cai
no dia anterior e a mensagem ganha a data. Falham igual no `master` nessa hora; não são desta leva e o
arquivo é da outra nuvem, então não mexi. Proposta: fixar o relógio no teste (`vi.setSystemTime` ao meio-dia).

## Prints (dados fictícios)

- Percurso: `docs/prints/pronto-janeiro/percurso/` (primeiro login, acesso ao app sem perfil, perfil de
  técnico, aprovação no link, OS gerada, conclusão no app, a aba Financeiro sem saída, a fatura gerada).
- Depois, desktop e celular: `docs/prints/pronto-janeiro/depois/` (o que falta, aviso "nada a faturar", o
  atalho para a aba Comercial, "todos os colaboradores já estão na atividade" e as iniciais no app).
