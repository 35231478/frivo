-- Segurança — o link público do relatório de ATIVIDADE passa a exigir um token secreto.
--
-- Antes, /relatorio/atividade/<id> abria só com o id da atividade (que aparece em URLs e
-- históricos e não é segredo): quem trocasse o id via relatório de outro cliente. Agora o link é
-- /relatorio/atividade/<id>?t=<token>, e sem o token certo a página responde 404.
--
-- Aditivo e idempotente (pode rodar mais de uma vez, sem erro e sem efeito repetido):
--   1. ADD COLUMN IF NOT EXISTS "token_relatorio" (TEXT) em "atividades_os";
--   2. backfill: gera token SÓ para as atividades que ainda não têm (rodar de novo NÃO troca
--      token de ninguém — links já enviados continuam valendo);
--   3. o banco passa a gerar o token sozinho em toda atividade nova (DEFAULT), a coluna fica
--      NOT NULL e ganha índice único com o nome que o Prisma gera.
-- Nada é removido; nenhum outro dado muda.
--
-- O token: 32 bytes aleatórios em base64url (43 caracteres, sem "="). Os bytes saem do SHA-256
-- de 3 gen_random_uuid() (366 bits do gerador criptográfico do PostgreSQL, nativo desde a v13,
-- sem precisar da extensão pgcrypto). O app gera os novos ("Gerar novo link") com
-- crypto.randomBytes(32) — mesmo formato.
--
-- Depois de rodar, os links antigos SEM token param de abrir (é a correção). Os botões
-- "Ver relatório" / "Copiar link" do sistema já montam o link novo, com o token.
--
-- Rodar ANTES do merge, no banco da DATABASE_URL de produção:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2026-10-20_relatorio_atividade_token.sql

BEGIN;

ALTER TABLE "atividades_os" ADD COLUMN IF NOT EXISTS "token_relatorio" TEXT;

UPDATE "atividades_os"
   SET "token_relatorio" = rtrim(translate(encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text || gen_random_uuid()::text, 'UTF8')), 'base64'), '+/', '-_'), '=')
 WHERE "token_relatorio" IS NULL;

ALTER TABLE "atividades_os"
  ALTER COLUMN "token_relatorio" SET DEFAULT rtrim(translate(encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text || gen_random_uuid()::text, 'UTF8')), 'base64'), '+/', '-_'), '='),
  ALTER COLUMN "token_relatorio" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "atividades_os_token_relatorio_key" ON "atividades_os"("token_relatorio");

COMMIT;
