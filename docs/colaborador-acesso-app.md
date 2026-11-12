# Acesso ao app do colaborador (técnico) + trava do papel TECNICO

Liberar, pela ficha do colaborador (Equipes › Colaboradores › **Acesso ao app**), um login de **app do
técnico**: e-mail + senha, papel **TECNICO**, da mesma empresa. Ao entrar, o técnico cai direto em
**"Meu dia"** (só as OS dele) e o painel de gestão fica travado.

## 🟢 Sem mudança de banco

O vínculo colaborador ↔ login **já existe por e-mail** em todo o sistema (`tecnicoDoUsuario`,
`impactoColaborador`, `tecnicoDaSessao`, e o `tecnicoId` que o login grava no JWT). O enum
`usuarios.role` já tem **TECNICO**, e cada empresa já tem o perfil **"Técnico de Campo"**
(`PRESETS.TECNICO`). Então **nada a migrar** — nenhum SQL aditivo.

## Ficha do colaborador › Acesso ao app

Aba nova (só para quem tem **Configurações › gerenciar** — gerir login é gestão de usuário):

- **Toggle Acesso ao app** — liga/desliga. Desligar **inativa o login** (bloqueia a entrada) sem apagar
  o colaborador; ligar de novo reaproveita.
- **E-mail de login** — é o e-mail do colaborador (Dados pessoais), **único por empresa** (validado).
- **Senha inicial** (com requisitos: 8+ caracteres, letra e número) ao ligar pela primeira vez.
- **Redefinir senha** — o admin troca quando o técnico esquece.
- API própria: `PUT /api/tecnicos/[id]/acesso` `{ acessoAtivo, senha? }`. Ligar cria/liga um `Usuario`
  papel **TECNICO** + perfil Técnico de Campo, senha com **hash (bcrypt, 12)** — **nunca texto**
  (LGPD). Mudar o e-mail do colaborador leva o login junto (sem login órfão).
- **UX:** a permissão é assada no login (JWT), então ativar/bloquear **vale no próximo login** — dito
  na própria tela. "Esqueci a senha" por e-mail segue na tela de login (link assinado, uso único).

## Login do técnico e trava do painel

- `role === "TECNICO"` entra em **modo técnico** (`lib/tecnico/modo.ts`): cai em `/tecnico` "Meu dia" e
  **nunca** no painel. O middleware manda qualquer tela do painel de volta ao app.
- Escopo no servidor (`lib/tecnico/escopo.ts`): só as **atividades dele** (responsável ou na equipe da
  atividade). Sem técnico ligado, o escopo **não libera nada** (melhor vazio que vazar OS de outro).
- APIs do painel de OS (`/api/ordens`, `/api/ordens/[id]`) **bloqueadas** no modo técnico
  (`lib/tecnico/painel.ts`, 403). As rotas do app (`/api/tecnico/*`, execução de atividade) seguem com
  o escopo do técnico.

## O que o TECNICO acessa × o que é bloqueado

| Área | TECNICO | Como é garantido |
|---|---|---|
| **Meu dia / Agenda** (só as OS dele) | ✅ Acessa | `/tecnico` + `escopoDaSessao`/`filtroEscopo` (atividades do técnico) |
| **Executar a OS dele** (checklist, fotos, medições, adicional, concluir) | ✅ Acessa | `/api/tecnico/*` e execução de atividade, com escopo |
| Equipamentos / Calendário / QR / Checklist de veículo | ✅ Acessa (campo) | perfil `PRESETS.TECNICO` |
| **OS de outros técnicos** | ⛔ Bloqueado | escopo nega (403); `/api/ordens`(lista/detalhe) → 403 no modo técnico |
| **Painel** (qualquer tela de gestão) | ⛔ Redireciona p/ "Meu dia" | middleware (`destinoModoTecnico`) + menu oculto (`casca-tecnico`) |
| **Clientes (gestão)** | ⛔ Bloqueado | RBAC (perfil não tem `clientes`) → `/sem-permissao` / 403 |
| **Financeiro** | ⛔ Bloqueado | RBAC (sem `financeiro`) |
| **Orçamentos** | ⛔ Bloqueado | RBAC (sem `orcamentos`) |
| **Estoque** | ⛔ Bloqueado | RBAC (sem `estoque`) |
| **Configurações** | ⛔ Bloqueado | RBAC (sem `configuracoes`) |

Multiempresa: tudo por `empresaId` da sessão, nada hardcoded.

## Testes

- `tecnico-acesso-pg`: liberar cria o login TECNICO (hash, perfil técnico, ligado por e-mail); e-mail
  único por empresa; não sequestra conta de painel; o técnico **entra e cai só nas OS dele**; o painel
  dá **403** (lista/detalhe de OS) e o modo técnico manda as telas de volta; gestão fora do alcance
  (RBAC); redefinir troca o hash; bloquear inativa o login (colaborador intacto); reativar reaproveita.
- `tecnico-acesso-ui`: a seção Acesso ao app — toggle pede senha inicial e salva na API; "Redefinir
  senha"; sem e-mail o toggle trava.
- `app-tecnico-ui` / `app-tecnico-pg`: regras do modo técnico atualizadas (papel TECNICO sempre no app).

## Prints

`docs/prints/colaborador-acesso-app/` (desktop + celular): a aba Acesso ao app, o "Meu dia" do técnico
(só as OS dele) e a tentativa de abrir o painel caindo de volta no app.
