-- NFS-e PR3 — notas fiscais de serviço EMITIDAS pelo PlugNotas (a partir da medição / OS concluída).
-- ADITIVO e IDEMPOTENTE: pode rodar 2× sem efeito extra. Nada é apagado nem alterado nas tabelas
-- existentes. SEM enum novo (origem, ambiente, status e tipo de evento são texto com CHECK).
-- Nenhum token/credencial é guardado aqui: só os identificadores da nota no PlugNotas.

-- 1) A nota (uma por código de serviço: a prefeitura não aceita códigos diferentes na mesma nota)
CREATE TABLE IF NOT EXISTS "notas_fiscais" (
  "id"                  TEXT NOT NULL,
  "empresa_id"          TEXT NOT NULL,
  "medicao_id"          TEXT,
  "ordem_servico_id"    TEXT,
  "cliente_id"          TEXT NOT NULL,
  "conta_receber_id"    TEXT,
  "origem"              TEXT NOT NULL,
  "ambiente"            TEXT NOT NULL,
  "status"              TEXT NOT NULL DEFAULT 'ENVIANDO',
  "grupo"               TEXT NOT NULL,
  "codigo_lc116"        VARCHAR(5),
  "codigo_tributacao"   TEXT,
  "aliquota_iss"        DECIMAL(5,2),
  "iss_retido"          BOOLEAN NOT NULL DEFAULT false,
  "valor_servicos"      DECIMAL(12,2) NOT NULL,
  "valor_desconto"      DECIMAL(12,2) NOT NULL DEFAULT 0,
  "discriminacao"       TEXT NOT NULL,
  "tomador_cpf_cnpj"    VARCHAR(14) NOT NULL,
  "tomador_nome"        TEXT NOT NULL,
  "plugnotas_id"        TEXT,
  "protocolo"           TEXT,
  "numero"              TEXT,
  "codigo_verificacao"  TEXT,
  "autorizada_em"       TIMESTAMP(3),
  "pdf_url"             TEXT,
  "xml_url"             TEXT,
  "motivo"              TEXT,
  "consultas"           INTEGER NOT NULL DEFAULT 0,
  "ultima_consulta_em"  TIMESTAMP(3),
  "emitida_por_id"      TEXT,
  "criado_em"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizado_em"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notas_fiscais_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "notas_fiscais_plugnotas_id_key" ON "notas_fiscais"("plugnotas_id");
CREATE INDEX IF NOT EXISTS "notas_fiscais_empresa_id_status_idx" ON "notas_fiscais"("empresa_id", "status");
CREATE INDEX IF NOT EXISTS "notas_fiscais_medicao_id_idx" ON "notas_fiscais"("medicao_id");
CREATE INDEX IF NOT EXISTS "notas_fiscais_ordem_servico_id_idx" ON "notas_fiscais"("ordem_servico_id");
CREATE INDEX IF NOT EXISTS "notas_fiscais_conta_receber_id_idx" ON "notas_fiscais"("conta_receber_id");
CREATE INDEX IF NOT EXISTS "notas_fiscais_cliente_id_idx" ON "notas_fiscais"("cliente_id");

-- 2) Os itens da medição que entraram em cada nota (com o valor e o desconto rateado de cada um)
CREATE TABLE IF NOT EXISTS "notas_fiscais_itens" (
  "id"               TEXT NOT NULL,
  "nota_id"          TEXT NOT NULL,
  "medicao_item_id"  TEXT,
  "servico_id"       TEXT,
  "descricao"        TEXT NOT NULL,
  "quantidade"       DECIMAL(10,2) NOT NULL,
  "valor_total"      DECIMAL(12,2) NOT NULL,
  "valor_desconto"   DECIMAL(12,2) NOT NULL DEFAULT 0,
  CONSTRAINT "notas_fiscais_itens_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "notas_fiscais_itens_nota_id_idx" ON "notas_fiscais_itens"("nota_id");
CREATE INDEX IF NOT EXISTS "notas_fiscais_itens_medicao_item_id_idx" ON "notas_fiscais_itens"("medicao_item_id");

-- 3) Histórico de cada nota (envio, consultas, mudanças de status, erros): quem, quando, o quê
CREATE TABLE IF NOT EXISTS "notas_fiscais_eventos" (
  "id"          TEXT NOT NULL,
  "nota_id"     TEXT NOT NULL,
  "usuario_id"  TEXT,
  "tipo"        TEXT NOT NULL,
  "status"      TEXT,
  "mensagem"    TEXT,
  "criado_em"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notas_fiscais_eventos_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "notas_fiscais_eventos_nota_id_idx" ON "notas_fiscais_eventos"("nota_id");

-- 4) FKs e CHECKs (só cria o que ainda não existe)
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('notas_fiscais', 'notas_fiscais_empresa_id_fkey', 'FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('notas_fiscais', 'notas_fiscais_medicao_id_fkey', 'FOREIGN KEY ("medicao_id") REFERENCES "medicoes"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
    ('notas_fiscais', 'notas_fiscais_ordem_servico_id_fkey', 'FOREIGN KEY ("ordem_servico_id") REFERENCES "ordens_servico"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
    ('notas_fiscais', 'notas_fiscais_cliente_id_fkey', 'FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE'),
    ('notas_fiscais', 'notas_fiscais_conta_receber_id_fkey', 'FOREIGN KEY ("conta_receber_id") REFERENCES "contas_receber"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
    ('notas_fiscais', 'notas_fiscais_emitida_por_id_fkey', 'FOREIGN KEY ("emitida_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
    ('notas_fiscais', 'notas_fiscais_origem_check', 'CHECK ("origem" IN (''OS'', ''MEDICAO''))'),
    ('notas_fiscais', 'notas_fiscais_ambiente_check', 'CHECK ("ambiente" IN (''HOMOLOGACAO'', ''PRODUCAO''))'),
    ('notas_fiscais', 'notas_fiscais_status_check', 'CHECK ("status" IN (''ENVIANDO'', ''PROCESSANDO'', ''CONCLUIDO'', ''REJEITADO'', ''CANCELADO'', ''INTERROMPIDO''))'),
    ('notas_fiscais', 'notas_fiscais_valores_check', 'CHECK ("valor_servicos" > 0 AND "valor_desconto" >= 0 AND "valor_desconto" <= "valor_servicos")'),
    ('notas_fiscais_itens', 'notas_fiscais_itens_nota_id_fkey', 'FOREIGN KEY ("nota_id") REFERENCES "notas_fiscais"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('notas_fiscais_itens', 'notas_fiscais_itens_medicao_item_id_fkey', 'FOREIGN KEY ("medicao_item_id") REFERENCES "medicao_itens"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
    ('notas_fiscais_itens', 'notas_fiscais_itens_servico_id_fkey', 'FOREIGN KEY ("servico_id") REFERENCES "servicos"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
    ('notas_fiscais_eventos', 'notas_fiscais_eventos_nota_id_fkey', 'FOREIGN KEY ("nota_id") REFERENCES "notas_fiscais"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
    ('notas_fiscais_eventos', 'notas_fiscais_eventos_usuario_id_fkey', 'FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
    ('notas_fiscais_eventos', 'notas_fiscais_eventos_tipo_check', 'CHECK ("tipo" IN (''ENVIO'', ''CONSULTA'', ''STATUS'', ''ERRO''))')
  ) AS t(tabela, nome, def)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c.nome AND conrelid = format('%I', c.tabela)::regclass) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s', c.tabela, c.nome, c.def);
    END IF;
  END LOOP;
END $$;
