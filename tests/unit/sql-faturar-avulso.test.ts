/**
 * "Faturar" (avulso) + retenções do serviço: o SQL de produção rodado de verdade num PostgreSQL, numa
 * transação só (como o `prisma db execute`), TRÊS vezes, num schema descartável com as tabelas de HOJE:
 *  - medicoes.avulsa nasce false nas existentes (nenhuma vira "Fatura");
 *  - os_itens_orcamento.orcamento_servico_id nasce vazio (sem chute), com índice e FK que solta (SET NULL)
 *    quando o item do orçamento é apagado — o item da OS fica;
 *  - servicos ganha "reter" IR/PIS/COFINS/CSLL/INSS desmarcados (Simples Nacional) e a alíquota do INSS;
 *    alíquotas e ISS retido existentes não mudam;
 *  - 2ª e 3ª rodadas não mudam nada.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-faturar-avulso
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2026-11-16_faturar_avulso.sql");
const SCHEMA = `teste_faturar_avulso_${process.pid}`;

function psql(args: string[]) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` },
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
function rodar() {
  const r = spawnSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "--single-transaction", "-f", ARQUIVO], {
    env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` }, encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(r.stderr);
}
const coluna = (tabela: string, c: string) => psql(["-c",
  `SELECT data_type || ':' || is_nullable || ':' || COALESCE(column_default, '-') FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = '${tabela}' AND column_name = '${c}'`]);
const retratoServicos = () => psql(["-c",
  `SELECT string_agg(concat_ws('|', id, iss_retido, COALESCE(aliquota_ir::text, '-'), concat(ret_ir::int, ret_pis::int, ret_cofins::int, ret_csll::int, ret_inss::int), COALESCE(aliquota_inss::text, '-')), ',' ORDER BY id) FROM servicos`]);

const TABELAS = `
  CREATE TABLE "medicoes" ("id" TEXT PRIMARY KEY, "numero" TEXT NOT NULL);
  CREATE TABLE "orcamento_servicos" ("id" TEXT PRIMARY KEY, "descricao" TEXT NOT NULL);
  CREATE TABLE "os_itens_orcamento" ("id" TEXT PRIMARY KEY, "descricao" TEXT NOT NULL);
  CREATE TABLE "servicos" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL, "iss_retido" BOOLEAN NOT NULL DEFAULT false, "aliquota_ir" DECIMAL(5,2));
  INSERT INTO "medicoes" VALUES ('m1', 'MED-2026-0001'), ('m2', 'MED-2026-0002');
  INSERT INTO "orcamento_servicos" VALUES ('os1', 'Manutenção'), ('os2', 'Instalação');
  INSERT INTO "os_itens_orcamento" VALUES ('i1', 'Manutenção'), ('i2', 'Peça');
  INSERT INTO "servicos" VALUES ('s1', 'Manutenção', true, NULL), ('s2', 'Projeto', false, 1.50);
`;

describe.skipIf(!URL)("SQL de produção: Faturar (avulso) + retenções do serviço (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`]);
    psql(["-c", TABELAS]);
    rodar();
  });
  afterAll(() => {
    if (!process.env.MANTER) execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`]);
  });

  it("medicoes.avulsa: boolean NOT NULL default false — nenhuma medição existente vira fatura", () => {
    expect(coluna("medicoes", "avulsa")).toBe("boolean:NO:false");
    expect(psql(["-c", `SELECT string_agg(id || '|' || avulsa, ',' ORDER BY id) FROM medicoes`])).toBe("m1|false,m2|false");
  });

  it("os_itens_orcamento.orcamento_servico_id: vazio (sem chute), índice e FK que solta ao apagar o item do orçamento", () => {
    expect(coluna("os_itens_orcamento", "orcamento_servico_id")).toBe("text:YES:-");
    expect(psql(["-c", `SELECT count(*) FROM os_itens_orcamento WHERE orcamento_servico_id IS NOT NULL`])).toBe("0");
    expect(psql(["-c", `SELECT count(*) FROM pg_indexes WHERE schemaname = '${SCHEMA}' AND indexname = 'os_itens_orcamento_orcamento_servico_id_idx'`])).toBe("1");
    expect(psql(["-c", `SELECT confdeltype FROM pg_constraint WHERE conname = 'os_itens_orcamento_orcamento_servico_id_fkey' AND conrelid = 'os_itens_orcamento'::regclass`])).toBe("n");
    // Vínculo de verdade: id que não existe é recusado; apagar o item do orçamento só solta o vínculo
    expect(() => psql(["-c", `UPDATE os_itens_orcamento SET orcamento_servico_id = 'nao-existe' WHERE id = 'i1'`])).toThrow(/foreign key/);
    psql(["-c", `UPDATE os_itens_orcamento SET orcamento_servico_id = 'os1' WHERE id = 'i1'`]);
    psql(["-c", `DELETE FROM orcamento_servicos WHERE id = 'os1'`]);
    expect(psql(["-c", `SELECT id || '|' || COALESCE(orcamento_servico_id, '-') FROM os_itens_orcamento WHERE id = 'i1'`])).toBe("i1|-");
  });

  it("servicos: \"reter\" federal desmarcado (Simples Nacional) + alíquota INSS; ISS retido e alíquota IR existentes intactos", () => {
    for (const c of ["ret_ir", "ret_pis", "ret_cofins", "ret_csll", "ret_inss"]) expect(coluna("servicos", c), c).toBe("boolean:NO:false");
    expect(psql(["-c", `SELECT data_type || ':' || numeric_precision || ',' || numeric_scale FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'servicos' AND column_name = 'aliquota_inss'`])).toBe("numeric:5,2");
    expect(retratoServicos()).toBe("s1|t|-|00000|-,s2|f|1.50|00000|-");
  });

  it("2ª e 3ª rodadas: sem erro e sem mudar nada (nem a FK, nem os dados)", () => {
    psql(["-c", `UPDATE medicoes SET avulsa = true WHERE id = 'm2'; UPDATE servicos SET ret_ir = true WHERE id = 's2'`]);
    const antes = [psql(["-c", `SELECT string_agg(id || '|' || avulsa, ',' ORDER BY id) FROM medicoes`]), retratoServicos()];
    rodar();
    rodar();
    expect([psql(["-c", `SELECT string_agg(id || '|' || avulsa, ',' ORDER BY id) FROM medicoes`]), retratoServicos()]).toEqual(antes);
    expect(psql(["-c", `SELECT count(*) FROM pg_constraint WHERE conname = 'os_itens_orcamento_orcamento_servico_id_fkey'`])).toBe("1");
  });
});
