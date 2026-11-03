/**
 * Tabelas profissionais (PR B): o SQL de produção (prisma/sql/2026-11-30_preferencias_usuario.sql)
 * rodado de verdade num PostgreSQL, DUAS vezes, num schema descartável; depois o Prisma real sobre
 * a tabela que o SQL criou (prova que o model `PreferenciaUsuario` bate com a tabela).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-preferencias-usuario
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2026-11-30_preferencias_usuario.sql");
const SCHEMA = `teste_pref_usuario_${process.pid}`;

function psql(args: string[]) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` },
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const rodar = () => psql(["--single-transaction", "-f", ARQUIVO]);
const falha = (q: string) => { try { sql(q); return "gravou"; } catch (e) { return String((e as { stderr?: string }).stderr ?? e); } };
const coluna = (col: string) =>
  sql(`SELECT data_type || ':' || is_nullable || ':' || COALESCE(column_default, '-') FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'preferencias_usuario' AND column_name = '${col}'`);

describe.skipIf(!URL)("SQL de produção: preferências por usuário (PostgreSQL real)", () => {
  let prisma: any;
  beforeAll(async () => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`]);
    sql(`CREATE TABLE "usuarios" ("id" TEXT PRIMARY KEY); INSERT INTO "usuarios" VALUES ('u1'), ('u2');`);
    rodar();
    process.env.DATABASE_URL = `${URL}${URL!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=5`;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
  }, 60_000);
  afterAll(async () => { await prisma?.$disconnect(); if (!process.env.MANTER) execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`]); });

  it("cria a tabela: valor JSONB obrigatório, atualizado_em sem default (o Prisma preenche), FK para o usuário", () => {
    expect(coluna("valor")).toBe("jsonb:NO:-");
    expect(coluna("chave")).toBe("text:NO:-");
    expect(coluna("atualizado_em")).toBe("timestamp without time zone:NO:-");
    expect(falha(`INSERT INTO preferencias_usuario (id, usuario_id, chave, valor, atualizado_em) VALUES ('x', 'nao-existe', 'tabela:a', '{}', now())`)).toContain("preferencias_usuario_usuario_id_fkey");
  });

  it("uma preferência por usuário e chave: a 2ª com a mesma chave é recusada; a mesma chave em outro usuário entra", () => {
    sql(`INSERT INTO preferencias_usuario (id, usuario_id, chave, valor, atualizado_em) VALUES ('p1', 'u1', 'tabela:orcamentos', '{"larguras":{"nome":200}}', now())`);
    expect(falha(`INSERT INTO preferencias_usuario (id, usuario_id, chave, valor, atualizado_em) VALUES ('p2', 'u1', 'tabela:orcamentos', '{}', now())`)).toContain("preferencias_usuario_usuario_id_chave_key");
    sql(`INSERT INTO preferencias_usuario (id, usuario_id, chave, valor, atualizado_em) VALUES ('p3', 'u2', 'tabela:orcamentos', '{}', now())`);
    expect(sql(`SELECT count(*) FROM preferencias_usuario`)).toBe("2");
  });

  it("apagar o usuário apaga as preferências dele (e só dele)", () => {
    sql(`DELETE FROM usuarios WHERE id = 'u2'`);
    expect(sql(`SELECT string_agg(id, ',') FROM preferencias_usuario`)).toBe("p1");
  });

  it("2ª e 3ª rodadas não mudam nada: o dado fica, índice e FK não duplicam", () => {
    rodar(); rodar();
    expect(sql(`SELECT valor->'larguras'->>'nome' FROM preferencias_usuario WHERE id = 'p1'`)).toBe("200");
    expect(sql(`SELECT count(*) FROM pg_constraint WHERE connamespace = '${SCHEMA}'::regnamespace AND conrelid = 'preferencias_usuario'::regclass AND contype = 'f'`)).toBe("1");
    expect(sql(`SELECT count(*) FROM pg_indexes WHERE schemaname = '${SCHEMA}' AND tablename = 'preferencias_usuario'`)).toBe("2"); // pkey + único
  });

  it("o Prisma real grava e lê pelo model (upsert por usuário+chave, como a rota faz)", async () => {
    await prisma.preferenciaUsuario.upsert({ where: { usuarioId_chave: { usuarioId: "u1", chave: "tabela:os" } }, create: { usuarioId: "u1", chave: "tabela:os", valor: { larguras: { numero: 150 } } }, update: { valor: {} } });
    await prisma.preferenciaUsuario.upsert({ where: { usuarioId_chave: { usuarioId: "u1", chave: "tabela:os" } }, create: { usuarioId: "u1", chave: "tabela:os", valor: {} }, update: { valor: { larguras: { numero: 170 }, ocultas: ["equipe"] } } });
    const p = await prisma.preferenciaUsuario.findUnique({ where: { usuarioId_chave: { usuarioId: "u1", chave: "tabela:os" } } });
    expect(p.valor).toEqual({ larguras: { numero: 170 }, ocultas: ["equipe"] });
    expect(p.atualizadoEm).toBeInstanceOf(Date);
    expect(await prisma.preferenciaUsuario.count({ where: { usuarioId: "u1" } })).toBe(2);
  });
});
