-- Proposta corporativa (parte 1 — documento): timbre (IE/IM e RT padrão da empresa), padrões do
-- orçamento em Configurações (validade, garantias, não incluso, normas), garantias / não incluso /
-- normas / destinatário (unidade + contato A/C) no orçamento e anexos da proposta.
-- ADITIVO e IDEMPOTENTE: pode rodar 2× sem efeito extra. Rodar ANTES do merge/deploy.
-- Orçamentos existentes ficam como estão: campos novos NULL/vazios = blocos novos não aparecem.

-- 1) Empresa: inscrições e responsável técnico padrão
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "inscricao_estadual" TEXT;
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "inscricao_municipal" TEXT;
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "responsavel_tecnico_id" TEXT;

-- 2) Configurações: padrões do orçamento novo (validade 10 dias = o padrão que já valia)
ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "orcamento_validade_dias" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "orcamento_garantia_servico" TEXT DEFAULT '90 dias';
ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "orcamento_garantia_pecas" TEXT DEFAULT 'Conforme garantia do fabricante';
ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "orcamento_nao_incluso" TEXT;
ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "orcamento_normas" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- 3) Orçamento: garantias, não incluso, normas e destinatário
ALTER TABLE "orcamentos" ADD COLUMN IF NOT EXISTS "garantia_servico" TEXT;
ALTER TABLE "orcamentos" ADD COLUMN IF NOT EXISTS "garantia_pecas" TEXT;
ALTER TABLE "orcamentos" ADD COLUMN IF NOT EXISTS "nao_incluso" TEXT;
ALTER TABLE "orcamentos" ADD COLUMN IF NOT EXISTS "normas" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "orcamentos" ADD COLUMN IF NOT EXISTS "unidade_id" TEXT;
ALTER TABLE "orcamentos" ADD COLUMN IF NOT EXISTS "contato_cliente_id" TEXT;

-- 4) Anexos da proposta (arquivos enviados e fotos copiadas da OS)
CREATE TABLE IF NOT EXISTS "orcamento_anexos" (
  "id"            TEXT NOT NULL,
  "empresa_id"    TEXT NOT NULL,
  "orcamento_id"  TEXT NOT NULL,
  "tipo"          TEXT NOT NULL,
  "nome"          TEXT NOT NULL,
  "mime"          TEXT NOT NULL,
  "tamanho"       INTEGER NOT NULL,
  "conteudo"      TEXT NOT NULL,
  "legenda"       TEXT,
  "origem"        TEXT,
  "ordem"         INTEGER NOT NULL DEFAULT 0,
  "criado_por_id" TEXT,
  "criado_em"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "orcamento_anexos_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "orcamento_anexos_orcamento_id_idx" ON "orcamento_anexos"("orcamento_id");
CREATE INDEX IF NOT EXISTS "orcamento_anexos_empresa_id_idx" ON "orcamento_anexos"("empresa_id");

-- 5) Chaves estrangeiras (apagar RT/unidade/contato/usuário só solta a referência)
DO $$
DECLARE
  fk RECORD;
BEGIN
  FOR fk IN SELECT * FROM (VALUES
    ('empresas', 'empresas_responsavel_tecnico_id_fkey', 'FOREIGN KEY ("responsavel_tecnico_id") REFERENCES "tecnicos"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
    ('orcamentos', 'orcamentos_unidade_id_fkey', 'FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
    ('orcamentos', 'orcamentos_contato_cliente_id_fkey', 'FOREIGN KEY ("contato_cliente_id") REFERENCES "contatos_cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
    ('orcamento_anexos', 'orcamento_anexos_empresa_id_fkey', 'FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('orcamento_anexos', 'orcamento_anexos_orcamento_id_fkey', 'FOREIGN KEY ("orcamento_id") REFERENCES "orcamentos"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('orcamento_anexos', 'orcamento_anexos_criado_por_id_fkey', 'FOREIGN KEY ("criado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE')
  ) AS t(tabela, nome, def)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = fk.nome AND conrelid = format('%I', fk.tabela)::regclass) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s', fk.tabela, fk.nome, fk.def);
    END IF;
  END LOOP;
END $$;
