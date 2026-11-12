-- ──────────────────────────────────────────────────────────────────────────────
-- Leva 1 de segurança — LIMPEZA DE DADOS (não muda o schema).
-- O código novo valida toda foto/avatar pelos BYTES e só serve imagem de verdade;
-- este script tira do banco o que foi gravado antes dessa regra e que não é imagem
-- (URLs, HTML/SVG disfarçados) e apaga as senhas provisórias do portal que ainda
-- estavam em texto (item C2 da auditoria — o código já grava NULL desde então).
-- Aditivo e idempotente: pode rodar 2× sem efeito. Rodar ANTES do merge/deploy.
-- ──────────────────────────────────────────────────────────────────────────────
BEGIN;

-- 1) Fotos de EQUIPAMENTO que não são imagem saem do array (a ordem das demais fica)
UPDATE "equipamentos" e
SET "fotos" = COALESCE(
  (SELECT array_agg(t.f ORDER BY t.ord)
     FROM unnest(e."fotos") WITH ORDINALITY AS t(f, ord)
    WHERE t.f ~ '^data:image/(png|jpe?g|webp|heic|gif);base64,'),
  '{}')
WHERE EXISTS (
  SELECT 1 FROM unnest(e."fotos") AS f
   WHERE f !~ '^data:image/(png|jpe?g|webp|heic|gif);base64,');

-- 2) VEÍCULOS: fotos e rótulos andam em pares (mesmo índice) — os dois saem juntos
WITH pares AS (
  SELECT v."id", t.f, COALESCE(v."fotos_rotulos"[t.ord], 'OUTRO') AS rotulo, t.ord
    FROM "veiculos" v, unnest(v."fotos") WITH ORDINALITY AS t(f, ord)
   WHERE EXISTS (
     SELECT 1 FROM unnest(v."fotos") AS x
      WHERE x !~ '^data:image/(png|jpe?g|webp|heic|gif);base64,')
), limpos AS (
  SELECT "id",
         COALESCE(array_agg(f ORDER BY ord) FILTER (WHERE f ~ '^data:image/(png|jpe?g|webp|heic|gif);base64,'), '{}') AS fotos,
         COALESCE(array_agg(rotulo ORDER BY ord) FILTER (WHERE f ~ '^data:image/(png|jpe?g|webp|heic|gif);base64,'), '{}') AS rotulos
    FROM pares GROUP BY "id"
)
UPDATE "veiculos" v
   SET "fotos" = l.fotos, "fotos_rotulos" = l.rotulos
  FROM limpos l WHERE v."id" = l."id";

-- 3) Avatares de colaborador e de usuário que não são imagem
UPDATE "tecnicos" SET "avatar" = NULL
 WHERE "avatar" IS NOT NULL AND "avatar" !~ '^data:image/(png|jpe?g|webp|heic|gif);base64,';
UPDATE "usuarios" SET "avatar" = NULL
 WHERE "avatar" IS NOT NULL AND "avatar" !~ '^data:image/(png|jpe?g|webp|heic|gif);base64,';

-- 4) Senha provisória do portal nunca mais fica em texto no banco (C2)
UPDATE "contatos_cliente" SET "senha_provisoria" = NULL WHERE "senha_provisoria" IS NOT NULL;

COMMIT;
