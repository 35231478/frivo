# Troca de senha no 1º acesso

Quem entra com uma senha **definida por outra pessoa** é obrigado a trocá-la antes de usar o sistema. Isso vale para:

- o 1º administrador criado na tela Empresas (Frivo);
- o técnico que recebe ou tem a senha redefinida na ficha do colaborador.

Até trocar, a pessoa só vê a tela de troca, tanto no painel quanto no app do técnico.

> 🔵 **Banco — NÃO aplicado.** O SQL está em `prisma/sql/2027-02-08_troca_senha_primeiro_acesso.sql`. Ele é aditivo e
> idempotente; o Zé aplica no Neon antes do merge. Ver "O SQL" abaixo.

## Levantamento — onde uma senha é definida por outra pessoa

| Ponto | Quem define | Como era | Agora |
|---|---|---|---|
| Empresas › Nova empresa (`lib/empresa/criar-empresa.ts`) | super admin | senha inicial do 1º admin; o aviso dizia "ele troca em Meu perfil › Senha" (nada obrigava) | **marca a troca** |
| Ficha do colaborador › Acesso ao app (`app/api/tecnicos/[id]/acesso`) — liberar | gestor | senha inicial do técnico | **marca a troca** |
| Idem — **Redefinir senha** | gestor | nova senha do técnico | **marca a troca** |
| Idem — só reativar (sem senha nova) | — | mantém a senha | não muda nada |
| Configurações › Usuários (`lib/cadastros/especificos.ts`) | ninguém | nasce com senha aleatória e a pessoa **define a própria** pelo convite | não muda (já é dela) |
| Portal do cliente (contatos) | equipe | senha provisória do contato | **fora desta leva** (é outro login; ver pergunta 2) |

E onde a **própria pessoa** troca, o que limpa a marca:

- Meu perfil › Segurança (painel) e Meus dados › Segurança (app do técnico), pela mesma rota, `PATCH /api/perfil/senha`;
- o link de convite ou de "Esqueci minha senha" (`lib/usuarios/convite.ts`).

## Como funciona

1. **Banco**: `usuarios.trocar_senha` (boolean, padrão false). Ela é marcada nos três pontos acima e limpa quando a própria pessoa troca a senha.
2. **Login** (`lib/auth.ts`): a pessoa entra normalmente e o token leva `trocarSenha`.
3. **Middleware** (`lib/acesso/troca-obrigatoria.ts`, regra pura), enquanto a troca estiver pendente:
   - qualquer **página** leva a `/trocar-senha`;
   - qualquer **API** responde **403** "Troque a sua senha para continuar." e não faz nada;
   - abrem só a tela de troca, a rota da troca, `/sessao-encerrada` e o "Sair" (`/api/auth`, que o middleware não intercepta).
   - A regra vale também para o **técnico**. Na tela de troca, o modo técnico não manda para o app: isso faria um ciclo, que o teste pegou e que foi corrigido.
4. **Tela `/trocar-senha`**: "Crie a sua senha, [nome]".
   - Campos: senha recebida, nova senha (com a regra forte de sempre) e confirmação.
   - A nova senha precisa ser diferente da recebida. Há o botão "Sair".
   - Usa a **mesma troca de Meu perfil**: exige a senha atual e tem limite de erros.
   - Deu certo: o cookie desta sessão é regravado sem a marca e a pessoa segue para o painel (ou o app, no caso do técnico).
   - As outras sessões, abertas com a senha recebida, caem, como em toda troca de senha.
   - Sem troca pendente, a tela só devolve a pessoa ao trabalho.
5. **A sessão segue o cadastro** (`lib/sessao-ativa.ts`): a marca é relida do banco a cada `auth()`, como já acontece com papel e permissões.

Textos ajustados:

- **Empresas**:
  - aviso depois de criar: "No primeiro acesso, o sistema pede que ele crie a própria senha.";
  - dica do campo: "Entregue ao administrador. No primeiro acesso, ele é obrigado a trocar.".
- **Ficha › Acesso ao app**: "Senha definida aqui: o técnico troca no 1º acesso. Esqueceu? “Esqueci minha senha” no login."

## O SQL (🔵 não aplicado)

```sql
ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "trocar_senha" BOOLEAN NOT NULL DEFAULT false;
```

- Todos os usuários que já existem ficam **false**: ninguém passa a ser obrigado a trocar por causa do SQL (ver pergunta 1).
- Ele só acrescenta a coluna: nada é apagado nem atualizado.
- Testado em PostgreSQL real (`tests/unit/sql-troca-senha.test.ts`):
  - roda duas vezes;
  - uma marca gravada entre as rodadas não é desfeita;
  - a coluna recusa nulo;
  - `migrate diff` fica vazio.

## Testes

| Arquivo | O que trava |
|---|---|
| `tests/unit/troca-senha.test.ts` | Regra pura e **ponta a ponta** com o Auth.js real, o middleware real, a rota real e o banco em memória: login com a marca → páginas vão à troca, APIs dão 403 → troca errada não muda nada → troca certa limpa a marca no banco e no cookie, o sistema abre e o cookie antigo cai → quem não tem a marca nunca vê a troca → a sessão segue o cadastro → o técnico vai à troca, não ao app (sem ciclo) → o link de convite ou recuperação limpa a marca |
| `tests/unit/troca-senha-ui.test.ts` | Tela: validações, PATCH, destino depois da troca, erro do servidor, Sair, toque ≥ 44px; página com e sem troca pendente (painel, app, sem sessão) |
| `tests/unit/tecnico-acesso-pg.test.ts` (PostgreSQL real) | Liberar o acesso marca; redefinir a senha marca; só reativar não marca |
| `tests/unit/pronto-janeiro-2-pg.test.ts` (PostgreSQL real) | O 1º admin criado em Empresas nasce marcado |
| `tests/unit/sql-troca-senha.test.ts` | O SQL de produção (acima) |

Expectativa atualizada de propósito: `tests/unit/pronto-janeiro-2.test.ts`. O aviso da empresa criada deixou de mandar
para "Meu perfil › Senha" e agora diz que o sistema pede a troca.

Também foi feito um **percurso no navegador real**, com dados fictícios:

1. o super admin cria uma empresa;
2. o 1º admin entra e cai na troca;
3. abrir `/clientes` volta à troca e `/api/clientes` dá 403;
4. o admin troca a senha e vai para o painel;
5. o gestor redefine a senha do técnico na ficha;
6. o técnico entra pelo celular e cai na troca;
7. abrir `/tecnico` volta à troca;
8. o técnico troca a senha e vai para o app.

## Prints (dados fictícios)

`docs/prints/troca-senha/`:

| Print | Versões |
|---|---|
| `01-empresas-senha-inicial` | antes/depois, desktop e celular |
| `02-acesso-app-colaborador` | antes/depois, desktop e celular |
| `03-empresa-criada-aviso` | desktop |
| `04-trocar-senha-admin` | desktop e celular |
| `04-trocar-senha-tecnico` | desktop e celular |
| `05-depois-da-troca-admin` | desktop (o painel) |
| `05-depois-da-troca-tecnico` | celular (o app) |
