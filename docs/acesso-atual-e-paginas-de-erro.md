# Acesso atual e páginas de erro (leva 1 — pronto para usar)

## 1. Permissão em /admissoes

### O que o levantamento mostrou

- O portão do middleware exigia "visualizar" do módulo do endereço. Isso já tinha sido corrigido em
  17/11 (PR #220) **para /admissoes e /documentacao-equipe**, tirando as duas rotas do mapa à mão. Com a
  conta criada já com a permissão, `/admissoes` abre (desktop e celular) e a API responde 200.
- O que ainda travava em 19/11: **papel e permissões eram gravados no token no login** e valiam até a
  sessão vencer (até 30 dias). Reproduzido no navegador:
  - o administrador concede "Admissão digital › Gerenciar" ao perfil de quem **já está logado** →
    a pessoa continua em "sem permissão" (página, API 403 e item fora do menu) até sair e entrar;
  - o administrador **retira** a permissão ou **inativa o perfil** → quem está logado continua
    entrando na tela e a API continua respondendo 200. Furo de segurança.

### Varredura: onde mais "visualizar" estava fixo

| Ponto | Situação antes | Agora |
| --- | --- | --- |
| Portão do middleware (`portaoBarra`) | exigia "visualizar"; as 2 telas de módulos sem "visualizar" ficavam fora do mapa por exceção manual | `podeEntrarNoModulo`: "visualizar" quando o módulo tem; senão, qualquer ação do módulo. `/admissoes` e `/documentacao-equipe` voltaram ao mapa — quem não tem nada do módulo é barrado já no portão |
| Menu lateral (`podeVer`) | "visualizar" fixo para itens sem `somenteAcao` | a mesma função do portão |
| Itens de Configurações sem ação própria | `pode(..., "visualizar")` | a mesma função do portão |
| Editor de perfil — "Módulos visíveis com este perfil" | só contava módulos com "visualizar": Admissão digital e Documentos nunca apareciam | a mesma função do portão |

Módulos sem a ação "visualizar" hoje: **Admissão digital** (`gerenciar`) e **Documentos do colaborador**
(`criar`, `gerenciar`, `disciplinar`, `enviar`). Um teste trava essa lista.

### A correção (sem banco)

- `lib/acesso/acesso-atual.ts` (puro): o acesso do cadastro de agora e se ele difere do token.
- `lib/sessao-ativa.ts`: a consulta que já rodava a cada requisição (usuário ativo, senha) passa a trazer
  papel e perfil; o token recebe o acesso de agora. Páginas, APIs e menu passam a valer na hora.
- O middleware (Edge, sem banco) só lê o cookie, e o cookie só é regravado por `/api/auth/session`:
  - `components/acesso/sincronizar-acesso.tsx` no layout do painel: quando o servidor percebe que o
    cookie está desatualizado, pede a sessão (regrava o cookie) e recarrega os dados; sem aviso,
    confere ao navegar (no máximo a cada 30 s) e ao voltar para a aba (no máximo a cada 10 s);
  - `/sem-permissao?de=<endereço>`: se o cadastro já libera o endereço, mostra "Atualizando o seu
    acesso…", regrava o cookie e volta (uma tentativa por endereço a cada 15 s; `de` só aceita caminho
    interno);
  - o middleware deixou de rodar em `/api/auth/*`, para não regravar o cookie antigo por cima do novo.

## 2. Páginas de erro em português

| Arquivo | Quando aparece |
| --- | --- |
| `app/not-found.tsx` | endereço que não existe (fora do painel). Logado: "Ir para o painel"; sem sessão: "Ir para o início" |
| `app/(dashboard)/not-found.tsx` | registro que não existe dentro do painel (OS, cliente…), com o menu |
| `app/(dashboard)/error.tsx` | erro inesperado numa tela do painel, com o menu |
| `app/error.tsx` | erro inesperado fora do painel (áreas públicas, portal, app do técnico) |
| `app/global-error.tsx` | erro no layout raiz (documento próprio) |

Sem detalhe técnico na tela: a mensagem do erro não aparece; o código (`digest`) fica no ⓘ, para a
pessoa informar ao suporte. "Voltar" só aparece quando há histórico. No celular as saídas empilham.

Observação: endereço inexistente **sem login** continua indo para o login (o middleware não revela
quais rotas existem); a 404 sem sessão aparece nos endereços públicos.
