-- MÓDULOS DA EMPRESA (Loja de Módulos — entitlement, fase 1: fundação + piloto Frota e Compras).
--
-- O QUE É: a terceira camada de acesso do Frivo, ACIMA do RBAC de usuário —
--     a EMPRESA tem o módulo (esta tabela)  ×  o USUÁRIO pode a ação (perfil de acesso).
-- São coisas distintas e somam: o gestor com todas as permissões não vê a Frota se a empresa
-- dela desligou a Frota; e ter o módulo ligado não dá permissão nenhuma a quem o perfil não dá.
--
-- O LEVANTAMENTO (o que já existia):
--   • "empresas"."plano" (enum BASICO | PROFISSIONAL | ENTERPRISE) existe no schema e NÃO é lido
--     por nenhuma linha de código — é letra morta. NÃO é tocado aqui: plano comercial é outra
--     coisa (vem com a camada de preço, muito depois); o que a empresa TEM fica nesta tabela.
--   • Não havia nenhum controle por empresa: todo módulo sempre esteve ligado para todo mundo.
--
-- O QUE ENTRA (ADITIVO; nada é removido, alterado ou preenchido):
--   1. A tabela "empresa_modulos", que guarda SÓ o que a empresa mexeu.
--
-- A REGRA QUE TORNA ISTO SEGURO — AUSÊNCIA DE LINHA = MÓDULO LIGADO:
--   A tabela nasce VAZIA e continua vazia para quem nunca desligar nada. Por isso rodar este SQL
--   não muda absolutamente nada para ninguém: todas as empresas seguem com todos os módulos.
--   Só passa a existir linha para o módulo que alguém desligou de propósito (ou religou depois,
--   que vira ativo = true e preserva o rastro de quem mexeu).
--   NÃO HÁ BACKFILL, NÃO HÁ SEED, NÃO HÁ RETROATIVO — de propósito.
--
-- O QUE NÃO MUDA:
--   • Desligar um módulo NUNCA apaga dado: veículos, checklists e pedidos de compra continuam no
--     banco; o módulo off só impede criar coisa nova. Religar restaura tudo como estava.
--   • O núcleo (clientes, ordens, calendário, equipe, relatório da OS, configurações, dashboard)
--     não desliga nem com linha nesta tabela: o código responde "tem" para ele sempre.
--
-- "modulo" é TEXT (não enum), como o motivo do atraso e o regime tributário: a validação mora no
-- catálogo em código (lib/modulos/catalogo.ts), e um módulo novo não exige mexer no banco.
-- Sem tabela nova além desta, sem índice além do necessário. Pode rodar mais de uma vez.

CREATE TABLE IF NOT EXISTS "empresa_modulos" (
  "id"              TEXT NOT NULL,
  "empresa_id"      TEXT NOT NULL,
  "modulo"          TEXT NOT NULL,
  "ativo"           BOOLEAN NOT NULL DEFAULT true,
  "alterado_por_id" TEXT,
  "alterado_em"     TIMESTAMP(3),
  "criado_em"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizado_em"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "empresa_modulos_pkey" PRIMARY KEY ("id")
);

-- Uma linha por módulo por empresa (é o que o "ligar/desligar" atualiza)
CREATE UNIQUE INDEX IF NOT EXISTS "empresa_modulos_empresa_id_modulo_key"
  ON "empresa_modulos" ("empresa_id", "modulo");

-- A leitura de toda página: "o que esta empresa desligou?"
CREATE INDEX IF NOT EXISTS "empresa_modulos_empresa_id_ativo_idx"
  ON "empresa_modulos" ("empresa_id", "ativo");

-- A empresa some, o registro dela some junto; o usuário que mexeu some, a data e o estado ficam
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'empresa_modulos_empresa_id_fkey') THEN
    ALTER TABLE "empresa_modulos"
      ADD CONSTRAINT "empresa_modulos_empresa_id_fkey"
      FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'empresa_modulos_alterado_por_id_fkey') THEN
    ALTER TABLE "empresa_modulos"
      ADD CONSTRAINT "empresa_modulos_alterado_por_id_fkey"
      FOREIGN KEY ("alterado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
