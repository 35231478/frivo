-- NFS-e PR1 — a empresa como EMITENTE de NFS-e (gateway PlugNotas, começando em HOMOLOGAÇÃO).
-- ADITIVO e IDEMPOTENTE: pode rodar 2× sem efeito extra. Nada é apagado. SEM enum novo
-- (regime, ambiente e status são texto com CHECK).
-- O arquivo do certificado A1 e a senha NÃO são guardados: vão direto ao PlugNotas.

-- 1) Dados fiscais da empresa (1:1)
CREATE TABLE IF NOT EXISTS "empresa_fiscal" (
  "id"                        TEXT NOT NULL,
  "empresa_id"                TEXT NOT NULL,
  "regime_tributario"         TEXT,
  "regime_especial"           TEXT,
  "incentivo_fiscal"          BOOLEAN NOT NULL DEFAULT false,
  "incentivador_cultural"     BOOLEAN NOT NULL DEFAULT false,
  "ambiente"                  TEXT NOT NULL DEFAULT 'HOMOLOGACAO',
  "codigo_municipio"          VARCHAR(7),
  "municipio_nome"            TEXT,
  "municipio_uf"              VARCHAR(2),
  "certificado_id"            TEXT,
  "certificado_titular"       TEXT,
  "certificado_cnpj"          VARCHAR(14),
  "certificado_valido_ate"    TIMESTAMP(3),
  "certificado_enviado_em"    TIMESTAMP(3),
  "emitente_cnpj"             VARCHAR(14),
  "emitente_ambiente"         TEXT,
  "emitente_sincronizado_em"  TIMESTAMP(3),
  "status"                    TEXT NOT NULL DEFAULT 'NAO_CONFIGURADO',
  "ultimo_erro"               TEXT,
  "ultimo_teste_em"           TIMESTAMP(3),
  "ultimo_teste_ok"           BOOLEAN,
  "ultimo_teste_mensagem"     TEXT,
  "atualizado_por_id"         TEXT,
  "criado_em"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizado_em"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "empresa_fiscal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "empresa_fiscal_empresa_id_key" ON "empresa_fiscal"("empresa_id");

-- 2) FKs e CHECKs (só cria o que ainda não existe)
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('empresa_fiscal_empresa_id_fkey', 'FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('empresa_fiscal_atualizado_por_id_fkey', 'FOREIGN KEY ("atualizado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
    ('empresa_fiscal_regime_tributario_check', 'CHECK ("regime_tributario" IS NULL OR "regime_tributario" IN (''SIMPLES_NACIONAL'', ''LUCRO_PRESUMIDO'', ''LUCRO_REAL'', ''MEI''))'),
    ('empresa_fiscal_ambiente_check', 'CHECK ("ambiente" IN (''HOMOLOGACAO'', ''PRODUCAO''))'),
    ('empresa_fiscal_status_check', 'CHECK ("status" IN (''NAO_CONFIGURADO'', ''PENDENTE'', ''ATIVO'', ''ERRO''))'),
    ('empresa_fiscal_codigo_municipio_check', 'CHECK ("codigo_municipio" IS NULL OR "codigo_municipio" ~ ''^[0-9]{7}$'')')
  ) AS t(nome, def)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c.nome AND conrelid = '"empresa_fiscal"'::regclass) THEN
      EXECUTE format('ALTER TABLE "empresa_fiscal" ADD CONSTRAINT %I %s', c.nome, c.def);
    END IF;
  END LOOP;
END $$;

-- 3) Permissão nova "Financeiro › Fiscal (NFS-e)": nos perfis Administrador e Financeiro que ainda
-- não têm a chave (rodar 2× não muda nada; quem já tem true/false fica como está). Exige re-login.
UPDATE "perfis_acesso"
SET "permissoes" = jsonb_set("permissoes"::jsonb, '{financeiro,fiscal}', 'true'::jsonb, true)
WHERE "tipo"::text IN ('ADMINISTRADOR', 'FINANCEIRO')
  AND ("permissoes"::jsonb ? 'financeiro')
  AND NOT (("permissoes"::jsonb -> 'financeiro') ? 'fiscal');
