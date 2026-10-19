/**
 * Estoque E1 — a lib de verdade (lib/estoque/servidor) num PostgreSQL de verdade, com o Prisma real:
 * prova o que o banco em memória não consegue provar —
 *  - lançamentos SIMULTÂNEOS no mesmo produto não se perdem (a linha do produto trava): no fim,
 *    saldo = soma do razão, e cada `saldoApos` é o saldo corrido na ordem em que entraram;
 *  - lançamento e saldo são atômicos: se gravar a movimentação falha, o saldo não muda.
 *
 * Schema descartável criado com `prisma db push` (o schema.prisma desta versão).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/estoque-concorrencia
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_estoque_conc_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

describe.skipIf(!URL_PG)("estoque no PostgreSQL real: concorrência e atomicidade", () => {
  let prisma: any;
  let movimentar: typeof import("@/lib/estoque/servidor").movimentar;
  let extratoProduto: typeof import("@/lib/estoque/servidor").extratoProduto;

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    ({ movimentar, extratoProduto } = await import("@/lib/estoque/servidor"));
    await prisma.empresa.create({ data: { id: "e1", nome: "Empresa", cnpj: `c-${process.pid}`, email: "e@x.com" } });
    await prisma.usuario.create({ data: { id: "u1", empresaId: "e1", nome: "Ana", email: "a@x.com", senha: "x" } });
    await prisma.produto.createMany({ data: [
      { id: "p1", empresaId: "e1", nome: "Gás R410A", unidade: "kg" },
      { id: "p2", empresaId: "e1", nome: "Filtro" },
    ] });
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  const somaRazao = async (produtoId: string) =>
    Number((await prisma.movimentacaoEstoque.aggregate({ where: { produtoId }, _sum: { quantidade: true } }))._sum.quantidade ?? 0);
  const saldo = async (produtoId: string) => Number((await prisma.produto.findUnique({ where: { id: produtoId } })).saldo);

  it("40 lançamentos ao mesmo tempo: nenhum se perde; saldo = soma do razão; saldoApos é o saldo corrido", async () => {
    const ops = [
      ...Array.from({ length: 25 }, () => ({ operacao: "ENTRADA" as const, valor: 1.5 })),
      ...Array.from({ length: 15 }, () => ({ operacao: "SAIDA" as const, valor: 2 })),
    ];
    const rs = await Promise.all(ops.map((o) => movimentar({ empresaId: "e1", produtoId: "p1", usuarioId: "u1", ...o })));
    expect(rs).toHaveLength(40);
    expect(await saldo("p1")).toBe(7.5); // 25 × 1,5 − 15 × 2
    expect(await somaRazao("p1")).toBe(7.5);
    // Serializados pela trava, os lançamentos formam UMA corrente: o "saldo antes" de cada um é o
    // "saldo depois" de outro (ou 0, o primeiro). Com atualização perdida, dois teriam o mesmo antes.
    const chave = (n: number) => (Math.round(n * 1000) / 1000).toFixed(3);
    const antes = rs.map((r) => chave(r.movimentacao.saldoApos - r.movimentacao.quantidade)).sort();
    const depois = ["0.000", ...rs.map((r) => chave(r.movimentacao.saldoApos))];
    depois.splice(depois.indexOf(chave(7.5)), 1); // o último "depois" não é "antes" de ninguém
    expect(antes).toEqual(depois.sort());
    const movs = await prisma.movimentacaoEstoque.findMany({ where: { produtoId: "p1" } });
    expect(movs).toHaveLength(40);
    expect(movs.every((m: any) => m.usuarioId === "u1" && m.empresaId === "e1")).toBe(true);
  }, 60_000);

  it("inventário no meio de entradas simultâneas: o saldo continua = soma do razão", async () => {
    await Promise.all([
      ...Array.from({ length: 10 }, () => movimentar({ empresaId: "e1", produtoId: "p2", operacao: "ENTRADA", valor: 1 })),
      movimentar({ empresaId: "e1", produtoId: "p2", operacao: "INVENTARIO", valor: 3 }),
      ...Array.from({ length: 10 }, () => movimentar({ empresaId: "e1", produtoId: "p2", operacao: "SAIDA", valor: 0.25 })),
    ]);
    expect(await saldo("p2")).toBe(await somaRazao("p2"));
    const ex = await extratoProduto("e1", "p2", { por: "100" });
    expect(ex!.movimentacoes).toHaveLength(21);
    expect(ex!.somaRazao).toBe(ex!.produto.saldo);
  }, 60_000);

  it("se gravar o lançamento falha, o saldo NÃO muda (mesma transação)", async () => {
    const antes = await saldo("p1");
    const nMovs = await prisma.movimentacaoEstoque.count({ where: { produtoId: "p1" } });
    // usuário inexistente → a chave estrangeira recusa a movimentação depois do saldo já incrementado
    await expect(movimentar({ empresaId: "e1", produtoId: "p1", usuarioId: "nao-existe", operacao: "ENTRADA", valor: 100 })).rejects.toThrow();
    expect(await saldo("p1")).toBe(antes);
    expect(await prisma.movimentacaoEstoque.count({ where: { produtoId: "p1" } })).toBe(nMovs);
  });

  it("produto de outra empresa: recusado antes de tocar em qualquer coisa", async () => {
    await prisma.empresa.create({ data: { id: "e2", nome: "Outra", cnpj: `d-${process.pid}`, email: "o@x.com" } });
    await expect(movimentar({ empresaId: "e2", produtoId: "p1", operacao: "ENTRADA", valor: 5 })).rejects.toThrow(/Produto inválido/);
    expect(await somaRazao("p1")).toBe(await saldo("p1"));
  });
});
