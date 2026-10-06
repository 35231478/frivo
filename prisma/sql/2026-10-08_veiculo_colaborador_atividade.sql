-- Parte B da OS: veículo padrão do colaborador + veículo usado na atividade da OS.
-- Aditivo e idempotente (pode rodar mais de uma vez). Não altera nem apaga dados existentes.
-- Rodar ANTES do deploy/merge, no mesmo banco da DATABASE_URL de produção.

-- 1) Veículo "padrão" do colaborador (opcional). Se o veículo for excluído, o vínculo some.
ALTER TABLE tecnicos ADD COLUMN IF NOT EXISTS veiculo_id TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tecnicos_veiculo_id_fkey') THEN
    ALTER TABLE tecnicos ADD CONSTRAINT tecnicos_veiculo_id_fkey
      FOREIGN KEY (veiculo_id) REFERENCES veiculos(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS tecnicos_veiculo_id_idx ON tecnicos(veiculo_id);

-- 2) Veículo usado NESTA atividade da OS (puxado da equipe/colaborador e editável).
--    Trocar aqui não mexe no vínculo padrão do colaborador nem no da equipe.
ALTER TABLE atividades_os ADD COLUMN IF NOT EXISTS veiculo_id TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'atividades_os_veiculo_id_fkey') THEN
    ALTER TABLE atividades_os ADD CONSTRAINT atividades_os_veiculo_id_fkey
      FOREIGN KEY (veiculo_id) REFERENCES veiculos(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS atividades_os_veiculo_id_idx ON atividades_os(veiculo_id);

-- Conferência (deve retornar 2 linhas):
-- SELECT table_name, column_name FROM information_schema.columns
--  WHERE column_name = 'veiculo_id' AND table_name IN ('tecnicos', 'atividades_os');
