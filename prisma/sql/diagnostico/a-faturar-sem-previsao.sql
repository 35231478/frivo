-- Opção A (P2+P3) — DIAGNÓSTICO, SÓ LEITURA (não altera nada).
--
-- Lista os orçamentos que vão ENTRAR no "a faturar" (painel/fluxo de caixa) com a Opção A ligada e que
-- HOJE NÃO estão na previsão: orçamentos COMUM APROVADOS sem nenhuma conta a receber viva (nunca
-- tiveram a Prevista — aprovados fora do link — ou tiveram e ela foi cancelada) e ainda não faturados.
-- Para quem foi aprovado pelo link e ainda tem a Prevista, nada muda (ela continua contando e o
-- "a faturar" a ignora). Se algum destes não deve mais ser faturado, cancele/reprove o orçamento.
--
-- "Ainda não faturado" aqui é aproximado (item da medição viva ligado ao orçamento ou à OS gerada dele);
-- a regra exata do sistema é lib/faturamento-os.ts → orcamentoJaFaturado.
--
--   psql "$DATABASE_URL" -f prisma/sql/diagnostico/a-faturar-sem-previsao.sql

SELECT
  e.nome                                   AS empresa,
  o.codigo,
  o.nome,
  o.total_geral                            AS valor_a_faturar,
  os.numero                                AS os_gerada,
  to_char(os.previsao_conclusao AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') AS mes_previsao_os,
  (SELECT string_agg(c.numero || ' (' || c.status || ')', ', ')
     FROM contas_receber c WHERE c.orcamento_id = o.id)  AS contas_canceladas_ou_excluidas
FROM orcamentos o
JOIN empresas e ON e.id = o.empresa_id
LEFT JOIN ordens_servico os ON os.orcamento_origem_id = o.id
WHERE o.tipo = 'COMUM'
  AND o.status = 'APROVADO'
  AND o.total_geral > 0
  -- sem conta viva (a Prevista antiga, se existe, faz ele ficar fora do "a faturar")
  AND NOT EXISTS (
    SELECT 1 FROM contas_receber c
     WHERE c.orcamento_id = o.id AND c.status <> 'CANCELADO' AND c.excluida_em IS NULL
  )
  -- não faturado direto
  AND NOT EXISTS (
    SELECT 1 FROM medicao_itens mi JOIN medicoes m ON m.id = mi.medicao_id
     WHERE mi.orcamento_id = o.id AND m.status <> 'CANCELADA'
  )
  -- não faturado pela OS gerada
  AND NOT EXISTS (
    SELECT 1 FROM medicao_itens mi JOIN medicoes m ON m.id = mi.medicao_id
     WHERE os.id IS NOT NULL AND mi.ordem_servico_id = os.id AND m.status <> 'CANCELADA'
  )
ORDER BY e.nome, o.codigo;
