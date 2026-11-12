-- Fotos & Anexos do serviço (aba "Relatórios & Anexos" da OS + app do técnico): toda foto enviada
-- passa a dizer A QUE SE REFERE (um equipamento da OS ou "Geral da OS"), com legenda e quem enviou.
-- ADITIVO e IDEMPOTENTE: pode rodar 2× sem efeito extra. Rodar ANTES do merge/deploy.
-- Os anexos que já existem ficam como estão (sem equipamento = aparecem em "Geral da OS"; sem autor).

-- 1) Colunas novas (todas opcionais)
ALTER TABLE "os_anexos" ADD COLUMN IF NOT EXISTS "equipamento_id" TEXT;
ALTER TABLE "os_anexos" ADD COLUMN IF NOT EXISTS "atividade_id" TEXT;
ALTER TABLE "os_anexos" ADD COLUMN IF NOT EXISTS "legenda" TEXT;
ALTER TABLE "os_anexos" ADD COLUMN IF NOT EXISTS "criado_por_id" TEXT;
-- Id gerado no aparelho (app do técnico offline): reenviar a mesma foto não duplica
ALTER TABLE "os_anexos" ADD COLUMN IF NOT EXISTS "client_id" TEXT;

-- 2) Índices
CREATE UNIQUE INDEX IF NOT EXISTS "os_anexos_client_id_key" ON "os_anexos"("client_id");
CREATE INDEX IF NOT EXISTS "os_anexos_equipamento_id_idx" ON "os_anexos"("equipamento_id");
CREATE INDEX IF NOT EXISTS "os_anexos_atividade_id_idx" ON "os_anexos"("atividade_id");

-- 3) Chaves estrangeiras (apagar o equipamento/atividade/usuário não apaga a foto: só solta a referência)
DO $$
DECLARE
  fk RECORD;
BEGIN
  FOR fk IN SELECT * FROM (VALUES
    ('os_anexos', 'os_anexos_equipamento_id_fkey', 'FOREIGN KEY ("equipamento_id") REFERENCES "equipamentos"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
    ('os_anexos', 'os_anexos_atividade_id_fkey', 'FOREIGN KEY ("atividade_id") REFERENCES "atividades_os"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
    ('os_anexos', 'os_anexos_criado_por_id_fkey', 'FOREIGN KEY ("criado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE')
  ) AS t(tabela, nome, def)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = fk.nome AND conrelid = format('%I', fk.tabela)::regclass) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s', fk.tabela, fk.nome, fk.def);
    END IF;
  END LOOP;
END $$;
