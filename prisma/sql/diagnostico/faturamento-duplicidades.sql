-- DIAGNÓSTICO (só leitura — não altera nada). Faturamento Opção A / travas C6-C7.
-- Rodar:  npx prisma db execute --file prisma/sql/diagnostico/faturamento-duplicidades.sql --schema prisma/schema.prisma
-- (o `db execute` não mostra o resultado; para VER as linhas, rode no psql/console do banco:
--   psql "$DATABASE_URL" -f prisma/sql/diagnostico/faturamento-duplicidades.sql)

-- 1) Contas a receber vivas que nasceram de ORÇAMENTO, com a classificação da migração
SELECT
  cr.numero                           AS conta,
  cr.status                           AS situacao,
  cr.valor,
  cl.nome                             AS cliente,
  o.codigo                            AS orcamento,
  o.status                            AS status_orcamento,
  os.numero                           AS os_gerada,
  COALESCE(md.numero, mo.numero)      AS medicao_viva,
  med_cr.numero                       AS medicao_da_conta,
  CASE
    WHEN cr.status = 'RECEBIDO'                                  THEN 'D-recebida: revisar à mão'
    WHEN cr.medicao_id IS NOT NULL                               THEN 'C-já é a cobrança da medição: ok'
    WHEN COALESCE(md.numero, mo.numero) IS NOT NULL              THEN 'B-DUPLICADA: a medição já cobra este serviço'
    WHEN o.status IN ('CANCELADO', 'REPROVADO')                  THEN 'E-órfã: orçamento cancelado/reprovado'
    ELSE                                                              'A-previsão pura: vira "a faturar"'
  END                                 AS classificacao
FROM contas_receber cr
JOIN orcamentos o        ON o.id = cr.orcamento_id
JOIN clientes cl         ON cl.id = cr.cliente_id
LEFT JOIN medicoes med_cr ON med_cr.id = cr.medicao_id
LEFT JOIN ordens_servico os ON os.orcamento_origem_id = o.id
LEFT JOIN LATERAL (
  SELECT m.numero FROM medicao_itens mi JOIN medicoes m ON m.id = mi.medicao_id
   WHERE mi.orcamento_id = o.id AND m.status <> 'CANCELADA' LIMIT 1) md ON true
LEFT JOIN LATERAL (
  SELECT m.numero FROM medicoes m
   WHERE m.status <> 'CANCELADA' AND os.id IS NOT NULL AND (
         EXISTS (SELECT 1 FROM medicao_itens mi WHERE mi.medicao_id = m.id AND mi.ordem_servico_id = os.id)
      OR EXISTS (SELECT 1 FROM relatorios_os r WHERE r.medicao_id = m.id AND r.ordem_servico_id = os.id AND r.escopo = 'MEDICAO_COMPLETA'))
   LIMIT 1) mo ON true
WHERE cr.status <> 'CANCELADO' AND cr.excluida_em IS NULL
ORDER BY classificacao, cl.nome, cr.numero;

-- 2) Medições com mais de uma conta avulsa viva (impede a trava (b))
SELECT m.numero AS medicao, count(*) AS contas, string_agg(cr.numero, ', ') AS numeros
  FROM contas_receber cr JOIN medicoes m ON m.id = cr.medicao_id
 WHERE cr.contrato_id IS NULL AND cr.status <> 'CANCELADO' AND cr.excluida_em IS NULL
 GROUP BY m.numero HAVING count(*) > 1;

-- 3) Orçamentos com mais de uma conta viva (impede a trava (c))
SELECT o.codigo AS orcamento, count(*) AS contas, string_agg(cr.numero, ', ') AS numeros
  FROM contas_receber cr JOIN orcamentos o ON o.id = cr.orcamento_id
 WHERE cr.status <> 'CANCELADO' AND cr.excluida_em IS NULL
 GROUP BY o.codigo HAVING count(*) > 1;

-- 4) OS em mais de uma medição viva (brecha (a) que já aconteceu)
SELECT os.numero AS os, string_agg(DISTINCT m.numero, ', ') AS medicoes
  FROM ordens_servico os
  JOIN (
    SELECT mi.ordem_servico_id AS os_id, mi.medicao_id FROM medicao_itens mi WHERE mi.ordem_servico_id IS NOT NULL
    UNION
    SELECT r.ordem_servico_id, r.medicao_id FROM relatorios_os r WHERE r.medicao_id IS NOT NULL AND r.escopo = 'MEDICAO_COMPLETA'
  ) x ON x.os_id = os.id
  JOIN medicoes m ON m.id = x.medicao_id AND m.status <> 'CANCELADA'
 GROUP BY os.numero HAVING count(DISTINCT m.id) > 1;
