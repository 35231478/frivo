#!/usr/bin/env bash
# CI: mudança no prisma/schema.prisma exige SQL novo (ou alterado) em prisma/sql/ no mesmo PR.
# O banco de produção é atualizado à mão com esses SQLs ANTES do merge; schema sem SQL quebraria
# a produção (o Prisma esperaria colunas/tabelas que não existem).
# Também confere que o SQL é idempotente (pode rodar duas vezes): CREATE TABLE/INDEX e
# ADD COLUMN precisam de IF NOT EXISTS.
#
# Uso: scripts/checar-sql-schema.sh <ref-base>   (ex.: origin/master)
set -euo pipefail
BASE="${1:-origin/master}"

if git diff --quiet "$BASE"...HEAD -- prisma/schema.prisma; then
  echo "prisma/schema.prisma não mudou — nada a conferir."
  exit 0
fi

SQLS=$(git diff --name-only --diff-filter=AM "$BASE"...HEAD -- 'prisma/sql/*.sql')
if [ -z "$SQLS" ]; then
  echo "::error file=prisma/schema.prisma::O schema.prisma mudou, mas o PR não traz SQL em prisma/sql/. Crie o SQL aditivo e idempotente (rodado na produção antes do merge)."
  exit 1
fi

FALHA=0
for f in $SQLS; do
  echo "SQL do PR: $f"
  # Linhas que criam algo sem IF NOT EXISTS (ignora comentários)
  RUINS=$(grep -nEi '^\s*(CREATE\s+(UNIQUE\s+)?(TABLE|INDEX)|ALTER\s+TABLE\s+.*ADD\s+COLUMN)' "$f" | grep -vi 'IF NOT EXISTS' || true)
  if [ -n "$RUINS" ]; then
    echo "::error file=$f::SQL não idempotente (falta IF NOT EXISTS):"
    echo "$RUINS"
    FALHA=1
  fi
done
exit $FALHA
