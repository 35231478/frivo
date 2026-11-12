/**
 * Códigos de produto e serviço — o SQL de produção rodado de verdade num PostgreSQL (uma transação, como
 * o `prisma db execute`), num schema descartável com as tabelas como estão HOJE, DUAS vezes:
 *  - produto: 1, 2, 3… por empresa na ordem de cadastro, continuando do maior que já houver;
 *  - serviço: 4 letras do nome (sem acento) + 2 dígitos por prefixo; sem letras = SRV; continua do maior;
 *  - a regra do SQL é a MESMA da tela (lib/cadastros/codigos.ts);
 *  - únicos por empresa; 2ª rodada não muda nada.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-codigos
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { codigoServico, prefixoCodigoServico } from "@/lib/cadastros/codigos";

const URL = process.env.PG_TESTE_URL;
const ARQ = path.resolve(__dirname, "../../prisma/sql/2026-11-01_codigos_produto_servico.sql");
const SCHEMA = `teste_codigos_sql_${process.pid}`;

function psql(args: string[]) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` },
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const rodar = () => psql(["--single-transaction", "-f", ARQ]);
const codigos = (tabela: string, empresa: string) => sql(`SELECT string_agg(id || '=' || coalesce(codigo::text, '∅'), ',' ORDER BY id) FROM ${tabela} WHERE empresa_id = '${empresa}'`);

const SERVICOS: [string, string, string, string][] = [
  // id, empresa, nome, criado_em
  ["s1", "e1", "Limpeza de Filtro", "2026-01-01"],
  ["s2", "e1", "Limpeza química", "2026-01-02"],
  ["s3", "e1", "Manutenção Preventiva", "2026-01-03"],
  ["s4", "e1", "Manutenção Corretiva", "2026-01-04"],
  ["s5", "e1", "Ar", "2026-01-05"],
  ["s6", "e1", "123 #", "2026-01-06"],
  ["s7", "e1", "Ícaro Çã instalação", "2026-01-07"],
  ["s8", "e2", "Limpeza", "2026-01-01"],
];

describe.skipIf(!URL)("SQL de produção: códigos de produto e serviço (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`]);
    sql(`
      CREATE TABLE "produtos" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL, "nome" TEXT NOT NULL, "criado_em" TIMESTAMP(3) NOT NULL DEFAULT now());
      CREATE TABLE "servicos" ("id" TEXT PRIMARY KEY, "empresa_id" TEXT NOT NULL, "nome" TEXT NOT NULL, "criado_em" TIMESTAMP(3) NOT NULL DEFAULT now());
      INSERT INTO "produtos" VALUES ('p3', 'e1', 'Gás', '2026-01-01'), ('p1', 'e1', 'Filtro', '2026-03-01'), ('p2', 'e1', 'Fita', '2026-02-01'), ('p9', 'e2', 'Outro', '2026-01-01');
      INSERT INTO "servicos" VALUES ${SERVICOS.map(([id, e, n, d]) => `('${id}', '${e}', '${n}', '${d}')`).join(", ")};
    `);
    rodar();
  });
  afterAll(() => { execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`]); });

  it("produto: 1, 2, 3… na ordem de cadastro, por empresa", () => {
    expect(codigos("produtos", "e1")).toBe("p1=3,p2=2,p3=1"); // ordem de cadastro (criado_em), não do id
    expect(codigos("produtos", "e2")).toBe("p9=1");
  });

  it("serviço: 4 letras do nome + 2 dígitos por prefixo; sem letras = SRV; acentos tirados", () => {
    expect(codigos("servicos", "e1")).toBe("s1=LIMP01,s2=LIMP02,s3=MANU01,s4=MANU02,s5=AR01,s6=SRV01,s7=ICAR01");
    expect(codigos("servicos", "e2")).toBe("s8=LIMP01");
  });

  it("o SQL usa a MESMA regra da tela (prefixo e número)", () => {
    for (const [id, , nome] of SERVICOS.filter((s) => s[1] === "e1")) {
      expect(sql(`SELECT codigo FROM servicos WHERE id = '${id}'`).replace(/\d+$/, ""), nome).toBe(prefixoCodigoServico(nome));
    }
    expect(codigoServico("LIMP", 2)).toBe("LIMP02");
  });

  it("únicos por empresa (a mesma empresa não repete; outra empresa pode)", () => {
    expect(() => sql(`INSERT INTO produtos (id, empresa_id, nome, codigo) VALUES ('px', 'e1', 'X', 2)`)).toThrow(/duplicate|unique/i);
    expect(() => sql(`INSERT INTO servicos (id, empresa_id, nome, codigo) VALUES ('sx', 'e1', 'X', 'LIMP01')`)).toThrow(/duplicate|unique/i);
    sql(`INSERT INTO produtos (id, empresa_id, nome, codigo) VALUES ('py', 'e2', 'Y', 2)`);
  });

  it("rodar de novo: não mexe no que já tem código; os novos sem código continuam do maior (inclusive o editado)", () => {
    const antes = codigos("servicos", "e1");
    sql(`UPDATE servicos SET codigo = 'LIMP07' WHERE id = 's2'`); // editado na tela
    sql(`INSERT INTO servicos (id, empresa_id, nome, criado_em) VALUES ('s9', 'e1', 'Limpeza de dreno', '2026-05-01')`);
    sql(`INSERT INTO produtos (id, empresa_id, nome, criado_em) VALUES ('p4', 'e1', 'Novo', '2026-05-01')`);
    rodar();
    expect(sql(`SELECT codigo FROM servicos WHERE id = 's9'`)).toBe("LIMP08");
    expect(sql(`SELECT codigo FROM servicos WHERE id = 's1'`)).toBe(antes.match(/s1=(\w+)/)![1]);
    expect(sql(`SELECT codigo FROM produtos WHERE id = 'p4'`)).toBe("4");
    expect(codigos("produtos", "e1")).toBe("p1=3,p2=2,p3=1,p4=4");
    const tudo = sql(`SELECT string_agg(id || '=' || codigo, ',' ORDER BY id) FROM servicos`);
    rodar();
    expect(sql(`SELECT string_agg(id || '=' || codigo, ',' ORDER BY id) FROM servicos`)).toBe(tudo);
  });

  it("depois de 99 o número segue com 3 dígitos (não corta)", () => {
    sql(`UPDATE servicos SET codigo = 'MANU99' WHERE id = 's4'`);
    sql(`INSERT INTO servicos (id, empresa_id, nome) VALUES ('s10', 'e1', 'Manutenção extra')`);
    rodar();
    expect(sql(`SELECT codigo FROM servicos WHERE id = 's10'`)).toBe("MANU100");
    expect(codigoServico("MANU", 100)).toBe("MANU100");
  });
});
