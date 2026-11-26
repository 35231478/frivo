-- CHECKLIST DE VEÍCULO OBRIGATÓRIO NO APP (o "porteiro" do app do técnico).
--
-- 🔵 PENDENTE — aplicar ANTES de subir o código desta leva (o Prisma passa a ler estas colunas e a tabela nova).
--
-- Nos dias que a empresa escolher, ao abrir o app, a única tela do colaborador com veículo padrão é o checklist do
-- veículo; feito (ou "Hoje não vou usar o veículo"), o resto do app libera até o próximo dia de checklist.
--
-- O LEVANTAMENTO (o que já existia e continua igual):
--   • "checklist_templates"/"checklist_item_templates": os modelos de checklist de veículo.
--   • "checklist_preenchidos"/"checklist_item_preenchidos": o checklist preenchido (respostas, fotos, alerta por item,
--     situação "Concluído"/"Com alertas"). O checklist do porteiro é gravado AQUI, como qualquer outro.
--   • "tecnicos"."veiculo_id": o veículo padrão do colaborador (é o veículo do porteiro).
--
-- O QUE ENTRA (ADITIVO; nada é removido, alterado ou preenchido):
--   1. "configuracoes" (por empresa), tudo DESLIGADO por padrão:
--        checklist_diario_ativo        — liga o porteiro (false)
--        checklist_diario_dias         — dias da semana com checklist, 0 = domingo … 6 = sábado (segunda a sexta)
--        checklist_diario_template_id  — o modelo de checklist usado (sem modelo, o porteiro não aparece)
--        checklist_diario_todos        — true = todos com veículo padrão; false = só os da lista abaixo
--        checklist_diario_tecnicos     — os colaboradores obrigados quando "todos" está desligado
--   2. Tipo "SituacaoChecklistDiario": FEITO | NAO_VAI_USAR.
--   3. Tabela "checklist_diario": UM registro por colaborador por dia (dia civil de Brasília) — quem, quando (no
--      aparelho e no servidor), qual veículo, a situação, o checklist preenchido (respostas e fotos) ou o motivo do
--      "não vou usar", se chegou depois (sem sinal), se o gestor já viu, e o rastro da troca "não vou usar" → feito.
--
-- O QUE NÃO MUDA:
--   • Desligado (o padrão), nada acontece: o app abre como hoje. Sem preenchimento retroativo.
--   • Os checklists já preenchidos ficam como estão.
--
-- Pode rodar mais de uma vez.

-- 1. Configuração por empresa
ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "checklist_diario_ativo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "checklist_diario_dias" INTEGER[] NOT NULL DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[];
ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "checklist_diario_template_id" TEXT;
ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "checklist_diario_todos" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "configuracoes" ADD COLUMN IF NOT EXISTS "checklist_diario_tecnicos" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'configuracoes_checklist_diario_template_id_fkey') THEN
    ALTER TABLE "configuracoes" ADD CONSTRAINT "configuracoes_checklist_diario_template_id_fkey"
      FOREIGN KEY ("checklist_diario_template_id") REFERENCES "checklist_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 2. Situação do dia
DO $$ BEGIN
  CREATE TYPE "SituacaoChecklistDiario" AS ENUM ('FEITO', 'NAO_VAI_USAR');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. O registro diário
CREATE TABLE IF NOT EXISTS "checklist_diario" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "tecnico_id" TEXT NOT NULL,
    "usuario_id" TEXT,
    "dia" DATE NOT NULL,
    "veiculo_id" TEXT,
    "situacao" "SituacaoChecklistDiario" NOT NULL,
    "checklist_id" TEXT,
    "motivo" TEXT,
    "feito_em" TIMESTAMP(3) NOT NULL,
    "recebido_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enviado_offline" BOOLEAN NOT NULL DEFAULT false,
    "client_id" TEXT NOT NULL,
    "visto_em" TIMESTAMP(3),
    "situacao_anterior" "SituacaoChecklistDiario",
    "trocado_em" TIMESTAMP(3),

    CONSTRAINT "checklist_diario_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "checklist_diario_checklist_id_key" ON "checklist_diario"("checklist_id");
CREATE UNIQUE INDEX IF NOT EXISTS "checklist_diario_client_id_key" ON "checklist_diario"("client_id");
CREATE UNIQUE INDEX IF NOT EXISTS "checklist_diario_tecnico_id_dia_key" ON "checklist_diario"("tecnico_id", "dia");
CREATE INDEX IF NOT EXISTS "checklist_diario_empresa_id_dia_idx" ON "checklist_diario"("empresa_id", "dia");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checklist_diario_empresa_id_fkey') THEN
    ALTER TABLE "checklist_diario" ADD CONSTRAINT "checklist_diario_empresa_id_fkey"
      FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checklist_diario_tecnico_id_fkey') THEN
    ALTER TABLE "checklist_diario" ADD CONSTRAINT "checklist_diario_tecnico_id_fkey"
      FOREIGN KEY ("tecnico_id") REFERENCES "tecnicos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checklist_diario_usuario_id_fkey') THEN
    ALTER TABLE "checklist_diario" ADD CONSTRAINT "checklist_diario_usuario_id_fkey"
      FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checklist_diario_veiculo_id_fkey') THEN
    ALTER TABLE "checklist_diario" ADD CONSTRAINT "checklist_diario_veiculo_id_fkey"
      FOREIGN KEY ("veiculo_id") REFERENCES "veiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checklist_diario_checklist_id_fkey') THEN
    ALTER TABLE "checklist_diario" ADD CONSTRAINT "checklist_diario_checklist_id_fkey"
      FOREIGN KEY ("checklist_id") REFERENCES "checklist_preenchidos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Conferir:
-- SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name = 'configuracoes' AND column_name LIKE 'checklist_diario%';
-- SELECT count(*) FROM checklist_diario;
