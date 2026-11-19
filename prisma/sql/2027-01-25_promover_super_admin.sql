-- PROMOVER O DONO DO FRIVO A 'SUPER_ADMIN' (a chave da ferramenta de Anotações Internas).
--
-- ESTE ARQUIVO É SEPARADO DO OUTRO DE PROPÓSITO. O SQL das tabelas
-- (2027-01-25_anotacoes_internas.sql) não muda nada para ninguém e pode rodar quando quiser. ESTE
-- aqui muda UMA linha de UM usuário, e é o único passo que efetivamente liga a ferramenta —
-- então fica na sua mão, para você rodar com o e-mail certo.
--
-- O QUE O PAPEL FAZ:
--   • abre a ferramenta de anotações (botão flutuante, modo de anotar, tela /anotacoes);
--   • e NADA MAIS.
--
-- O QUE O PAPEL **NÃO** FAZ — a parte importante:
--   • NÃO é chave-mestra entre empresas. O isolamento multiempresa continua valendo igual para o
--     SUPER_ADMIN: toda consulta do sistema fica presa ao empresa_id da sessão dele, e um
--     SUPER_ADMIN da empresa A continua recebendo "não encontrado" ao pedir um cliente, uma OS ou
--     um equipamento da empresa B. Isso está travado por teste
--     (tests/unit/anotacoes-pg.test.ts › "SUPER_ADMIN não é chave-mestra").
--   • NÃO amplia a permissão dentro da própria empresa: `pode()` (lib/permissoes.ts) já tratava
--     'ADMIN' e 'SUPER_ADMIN' do mesmo jeito desde antes desta leva. Se o usuário já era ADMIN, o
--     acesso dele ao sistema continua exatamente o mesmo.
--
-- COMO RODAR: troque o e-mail abaixo pelo seu e confira o resultado (o SELECT no fim).
-- Idempotente: rodar de novo não faz nada (o WHERE já exclui quem é SUPER_ADMIN).
-- Para DESLIGAR a ferramenta depois, o caminho de volta está comentado no pé do arquivo.

-- ⚠️ TROQUE AQUI pelo e-mail do seu usuário:
\set email 'admin@climatotal.com.br'

UPDATE "usuarios"
   SET "role" = 'SUPER_ADMIN',
       "atualizado_em" = CURRENT_TIMESTAMP
 WHERE "email" = :'email'
   AND "role" <> 'SUPER_ADMIN';

-- Confirmação: deve listar o seu usuário (nome, e-mail, empresa) com o papel novo.
SELECT u."nome", u."email", u."role", e."nome" AS "empresa"
  FROM "usuarios" u
  JOIN "empresas" e ON e."id" = u."empresa_id"
 WHERE u."role" = 'SUPER_ADMIN';

-- Se o SELECT acima vier vazio, o e-mail não casou: confira com
--   SELECT nome, email, role FROM usuarios ORDER BY criado_em;
--
-- PARA DESLIGAR A FERRAMENTA (volta a ser ADMIN comum; as anotações ficam no banco, só param de
-- ser alcançáveis):
--   UPDATE "usuarios" SET "role" = 'ADMIN', "atualizado_em" = CURRENT_TIMESTAMP
--    WHERE "email" = 'admin@climatotal.com.br' AND "role" = 'SUPER_ADMIN';
