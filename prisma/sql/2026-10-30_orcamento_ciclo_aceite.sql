-- Proposta corporativa (parte 2 — ciclo e aceite): IP do aceite, recusa com motivo, contador de
-- visualizações, "resposta vista" (sino) e a linha do tempo do orçamento (envio, visualização,
-- aprovação, recusa, mudanças de status).
-- ADITIVO e IDEMPOTENTE: pode rodar 2× sem efeito extra. Rodar ANTES do merge/deploy.
-- Orçamentos existentes ficam como estão (campos novos vazios; visualizações = 0).

-- 1) Orçamento: aceite (IP/navegador), recusa, visualizações e resposta vista
ALTER TABLE "orcamentos" ADD COLUMN IF NOT EXISTS "aprovado_ip" TEXT;
ALTER TABLE "orcamentos" ADD COLUMN IF NOT EXISTS "aprovado_user_agent" TEXT;
ALTER TABLE "orcamentos" ADD COLUMN IF NOT EXISTS "recusado_em" TIMESTAMP(3);
ALTER TABLE "orcamentos" ADD COLUMN IF NOT EXISTS "recusado_por" TEXT;
ALTER TABLE "orcamentos" ADD COLUMN IF NOT EXISTS "recusa_motivo" TEXT;
ALTER TABLE "orcamentos" ADD COLUMN IF NOT EXISTS "recusado_ip" TEXT;
ALTER TABLE "orcamentos" ADD COLUMN IF NOT EXISTS "visualizacoes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "orcamentos" ADD COLUMN IF NOT EXISTS "resposta_vista_em" TIMESTAMP(3);

-- Respostas que já existiam não aparecem no sino como novas
UPDATE "orcamentos" SET "resposta_vista_em" = COALESCE("assinado_em", "atualizado_em")
WHERE "status" IN ('APROVADO', 'REPROVADO', 'CONVERTIDA') AND "resposta_vista_em" IS NULL;

-- 2) Linha do tempo
CREATE TABLE IF NOT EXISTS "orcamento_eventos" (
  "id"           TEXT NOT NULL,
  "empresa_id"   TEXT NOT NULL,
  "orcamento_id" TEXT NOT NULL,
  "tipo"         TEXT NOT NULL,
  "detalhe"      TEXT,
  "usuario_id"   TEXT,
  "ip"           TEXT,
  "criado_em"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "orcamento_eventos_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "orcamento_eventos_orcamento_id_criado_em_idx" ON "orcamento_eventos"("orcamento_id", "criado_em");
CREATE INDEX IF NOT EXISTS "orcamento_eventos_empresa_id_idx" ON "orcamento_eventos"("empresa_id");

DO $$
DECLARE
  fk RECORD;
BEGIN
  FOR fk IN SELECT * FROM (VALUES
    ('orcamento_eventos', 'orcamento_eventos_empresa_id_fkey', 'FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('orcamento_eventos', 'orcamento_eventos_orcamento_id_fkey', 'FOREIGN KEY ("orcamento_id") REFERENCES "orcamentos"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('orcamento_eventos', 'orcamento_eventos_usuario_id_fkey', 'FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE')
  ) AS t(tabela, nome, def)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = fk.nome AND conrelid = format('%I', fk.tabela)::regclass) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s', fk.tabela, fk.nome, fk.def);
    END IF;
  END LOOP;
END $$;
