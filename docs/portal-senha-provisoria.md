# Portal do cliente: senha provisória segura

Achado no #274: a "senha provisória" do contato do cliente era **definida pela equipe** e ficava guardada em
**texto** no banco (`contatos_cliente.senha_provisoria`) para ser mostrada a quem deu o acesso.

> 🔵 **Banco: NÃO aplicado.** O SQL está em `prisma/sql/2027-02-09_portal_troca_senha.sql`. Ele é aditivo e
> idempotente, e o Zé aplica no Neon **antes do merge**. A coluna antiga **não** é apagada (ver "Limpeza para depois").

## Levantamento

| Ponto | Como estava | Agora |
|---|---|---|
| Liberar o acesso (Cliente › Portal) | a equipe **digitava** a senha (mín. 8) | o **sistema gera** a senha provisória (12 caracteres, sem ambíguos, com letra e número), mostrada **uma vez** |
| Gravação | só o hash; `senha_provisoria` zerada a cada mudança (desde a auditoria C2) | igual. A coluna antiga não é lida nem gravada com valor |
| Linhas antigas | o texto continua em `senha_provisoria` (nenhum SQL limpou) | **fica como está** nesta leva (ver "Limpeza para depois"). Nada a exibe |
| Tela da equipe com acesso existente | "Definida. Para enviar uma nova, use Redefinir senha" | "Não fica guardada. Para enviar uma senha ao contato, gere uma nova." + **Gerar nova senha provisória** |
| 1º acesso do contato | entrava direto com a senha da equipe | **só a tela de troca** abre até criar a própria |
| "Esqueci minha senha" do portal | criava a senha nova | também **limpa** a troca pendente |
| Limite de tentativas no login do portal | **já existia**, igual ao do painel (5 por e-mail, 20 por IP, 15 min) | sem mudança; agora há prova de que é igual. A troca também tem limite (5 erros da senha recebida por contato) |
| Login do painel | — | **nada muda** |

## Como funciona

1. **Liberar o acesso (escritório).**
   - Sem campo de senha: o e-mail, as permissões e **Liberar acesso**.
   - O sistema gera a senha, grava só o hash e marca `trocar_senha`.
   - A senha aparece uma vez, com **Copiar**, e vai no **Convite e-mail** e no **Convite WhatsApp**: "Senha provisória: …
     No primeiro acesso, o portal pede para criar uma senha própria."
   - Fechou o quadro ou recarregou a tela, a senha some.
   - **Gerar nova senha provisória** pede confirmação, gera outra, marca a troca de novo e derruba as sessões abertas.
   - Salvar só e-mail ou permissões de um acesso que já existe não gera nem mostra senha.
2. **Login do portal.** O token leva `trocarSenha`, relido do cadastro a cada leitura (`lib/sessao-portal.ts`).
3. **Com a troca pendente**:
   - qualquer página do portal leva a `/portal/trocar-senha` (o guarda `requirePortalSession`);
   - o login, se a pessoa já está logada, vai para a troca;
   - a API do portal responde **403** "Crie a sua senha para continuar." e não faz nada;
   - para QR, aceite e o resto, a pessoa **não está logada** (`getPortalSession()` devolve nada).
4. **A tela de troca.**
   - Campos: senha recebida, nova senha (a regra forte de sempre, diferente da recebida) e confirmação.
   - Deu certo: a marca sai, o cookie do portal é **regravado** com os mesmos atributos do Auth.js e o portal abre.
     As outras sessões, abertas com a senha recebida, caem.
   - **Sair** encerra a sessão.
5. **Sem ciclo.** Há uma decisão só (`destinoDoPortal`):
   - a tela de troca, com troca pendente, abre e não manda para lugar nenhum;
   - sem troca, ela manda para o portal; sem sessão, para o login;
   - o login com uma sessão que o servidor já não aceita **abre** (não volta ao painel).
6. **O cookie do portal** (lição do #270).
   - Nome e atributos ficam num lugar só (`lib/portal/sessao-cookie-portal.ts`), usados pelo Auth.js do portal e por quem
     regrava ou apaga: `HttpOnly`, `SameSite=Lax`, `Path=/`.
   - `Secure` sempre em produção e sempre que o nome tiver o prefixo `__Secure-`.
   - Apagar cobre cada pedaço (`.0`, `.1`…) e o nome base. O cookie do painel não é tocado.

## O SQL (🔵 não aplicado)

```sql
ALTER TABLE "contatos_cliente" ADD COLUMN IF NOT EXISTS "trocar_senha" BOOLEAN NOT NULL DEFAULT false;
```

- Todos os contatos que já existem ficam **false**: quem já tem acesso continua entrando com o hash atual, sem troca.
- Só acrescenta a coluna; **não toca** em `senha_provisoria`.
- Testado em PostgreSQL real (`sql-portal-troca-senha`):
  - roda 2×, e uma marca gravada no meio não é desfeita;
  - o texto antigo segue igual;
  - a coluna não aceita nulo;
  - `migrate diff` vazio.

## Limpeza para depois (não feita aqui)

A coluna `senha_provisoria` ficou **obsoleta**. No `schema.prisma`, o comentário marca "OBSOLETA". O código só a
zera quando a senha muda. Quando o Zé decidir:

1. **Zerar o texto que ainda está lá** (não apaga a coluna; as senhas continuam valendo pelo hash):
   ```sql
   UPDATE "contatos_cliente" SET "senha_provisoria" = NULL WHERE "senha_provisoria" IS NOT NULL;
   ```
   - Antes, vale conferir quantas linhas são: `SELECT count(*) FROM contatos_cliente WHERE senha_provisoria IS NOT NULL;`.
   - Como esses textos podem ser a senha que ainda vale, o ideal é também **gerar nova senha provisória** para esses
     contatos, ou pedir a troca. Isso pede uma decisão do Zé.
2. **Tirar do código:** remover o campo `senhaProvisoria` do `schema.prisma` e as linhas que o zeram (rota do acesso,
   recuperação, rota de troca) e a omissão dele em `lib/contato-cliente.ts`.
3. **Só depois do deploy disso, apagar a coluna:**
   ```sql
   ALTER TABLE "contatos_cliente" DROP COLUMN IF EXISTS "senha_provisoria";
   ```

## Testes

| Arquivo | O que trava |
|---|---|
| `portal-senha-provisoria-pg` (8, PostgreSQL real, **ponta a ponta** com o Auth.js do portal real) | liberar → mostra uma vez (e só o hash) → login → só a troca (páginas, login, API 403, sessão comum nula) → troca errada não muda nada → troca certa libera, cookie regravado, a sessão antiga cai no login sem ciclo → gerar nova volta a pedir → "Esqueci" limpa → acesso antigo entra direto e revogar zera → limite no login (igual ao painel) e na troca |
| `portal-senha-provisoria` (13, regra) | senha gerada (tamanho, alfabeto, letra e número), destino sem ciclo, mensagem formal, atributos e apagar do cookie, limite igual ao painel, painel sem mudança, SQL e schema |
| `portal-senha-provisoria-ui` (8, tela) | sem campo de senha; senha uma vez com Copiar e no convite; reabrir não mostra; gerar nova pede confirmação; a tela de troca valida, envia, segue e Sai |
| `sql-portal-troca-senha` (5, PostgreSQL real) | o SQL de produção |

- **Mutação: 28 mutantes, 28 mortos** (rota do acesso, sessão, guarda, API, tela de troca, troca, "Esqueci", gerador,
  cookie, login e tela da equipe).
- Suíte completa (591 arquivos, 8653 testes), typecheck e build de produção: ok.

**Testes antigos atualizados de propósito:**

- `rotas-acesso` (3): liberar gera a senha (a digitada é ignorada); 12 caracteres; revogar zera a marca.
- `leva2-portal` (1): conceder acesso gera a senha, e a digitada não entra.
- `despoluicao-lote-b` (1): a mensagem formal do convite mudou de arquivo (`lib/portal/senha-provisoria.ts`).

## Prints (fictícios)

`docs/prints/portal-senha/`, em desktop e iPhone 13:

- `antes-01…03`: a equipe digita a senha, ela aparece, e o contato entra direto;
- `depois-10…15`:
  - liberar sem campo de senha;
  - a senha gerada uma vez, com Copiar;
  - reabrir não mostra a senha;
  - o 1º acesso só abre a troca (mesmo pedindo outra página);
  - a senha recebida errada;
  - trocou, e o portal abre.
