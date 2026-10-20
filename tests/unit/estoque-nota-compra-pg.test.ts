/**
 * Estoque E2 — importar e lançar a NF de compra com o Prisma real num PostgreSQL real (schema
 * descartável via `prisma db push`). Prova o que o banco em memória não consegue:
 *  - custo unitário da NF gravado com 4 casas (12,3333) e saldo = soma do razão;
 *  - lançamento é tudo-ou-nada: se um item falha no meio, nada fica (nem estoque, nem conta, nem
 *    produto novo, nem de-para, e a nota volta a poder ser lançada);
 *  - duas confirmações simultâneas da mesma nota: só UMA lança;
 *  - duas importações simultâneas do mesmo XML: só UMA cria a nota.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/estoque-nota-compra-pg
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_e2_pg_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
const XML1 = readFileSync(path.resolve(__dirname, "fixtures/nfe/nfe-4521-frigelar.xml"), "utf8");
const XML2 = readFileSync(path.resolve(__dirname, "fixtures/nfe/nfe-4610-frigelar.xml"), "utf8");

describe.skipIf(!URL_PG)("nota de compra no PostgreSQL real", () => {
  let prisma: any;
  let lib: typeof import("@/lib/compras/notas");

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    lib = await import("@/lib/compras/notas");
    await prisma.empresa.create({ data: { id: "e1", nome: "Clima Total", cnpj: `12.345.678/0001-90`, email: "e@x.com" } });
    await prisma.usuario.create({ data: { id: "u1", empresaId: "e1", nome: "Ana", email: "a@x.com", senha: "x" } });
    await prisma.produto.createMany({ data: [{ id: "pGas", empresaId: "e1", nome: "Gás R410A", unidade: "un" }, { id: "pCap", empresaId: "e1", nome: "Capacitor", unidade: "pc" }] });
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  const contagens = async () => ({
    movs: await prisma.movimentacaoEstoque.count(), contas: await prisma.contaPagar.count(),
    produtos: await prisma.produto.count(), deParas: await prisma.deParaProdutoFornecedor.count(),
  });

  it("falha no meio do lançamento desfaz TUDO (estoque, contas, produto novo, de-para, status)", async () => {
    // item 3 com quantidade 0,0004: lida da NF, mas a entrada (3 casas) recusa — depois de 2 itens já lançados
    const xml = XML1.replace("<qCom>15.0000</qCom>", "<qCom>0.0004</qCom>");
    const { nota } = await lib.importarNota({ empresaId: "e1", usuarioId: "u1", xml });
    const itens = await prisma.notaCompraItem.findMany({ where: { notaId: nota.id }, orderBy: { numeroItem: "asc" } });
    const antes = await contagens();
    await expect(lib.lancarNota({
      empresaId: "e1", usuarioId: "u1", notaId: nota.id,
      escolhas: [{ itemId: itens[0].id, produtoId: "pGas" }, { itemId: itens[1].id, produtoId: "pCap" }, { itemId: itens[2].id, novo: { nome: "Tubo" } }],
    })).rejects.toThrow("A quantidade precisa ser maior que zero.");
    expect(await contagens()).toEqual(antes);
    const depois = await prisma.notaCompra.findUnique({ where: { id: nota.id }, include: { itens: true } });
    expect(depois.status).toBe("IMPORTADA");
    expect(depois.lancadaEm).toBeNull();
    expect(depois.itens.every((i: any) => i.produtoId === null)).toBe(true);
    expect(Number((await prisma.produto.findUnique({ where: { id: "pGas" } })).saldo)).toBe(0);
    await prisma.notaCompra.delete({ where: { id: nota.id } });
  });

  it("lança com custo de 4 casas; duas confirmações simultâneas: só uma lança", async () => {
    const { nota } = await lib.importarNota({ empresaId: "e1", usuarioId: "u1", xml: XML1 });
    const itens = await prisma.notaCompraItem.findMany({ where: { notaId: nota.id }, orderBy: { numeroItem: "asc" } });
    await lib.conciliar({ empresaId: "e1", notaId: nota.id, escolhas: [{ itemId: itens[0].id, produtoId: "pGas" }, { itemId: itens[1].id, produtoId: "pCap" }, { itemId: itens[2].id, novo: { nome: "Tubo de cobre 1/4" } }] });
    const resultados = await Promise.allSettled([1, 2, 3].map(() => lib.lancarNota({ empresaId: "e1", usuarioId: "u1", notaId: nota.id })));
    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(resultados.filter((r) => r.status === "rejected").map((r: any) => r.reason.message)).toEqual([
      "Esta nota já foi lançada: o estoque e as contas não são lançados de novo.", "Esta nota já foi lançada: o estoque e as contas não são lançados de novo.",
    ]);
    const movs = await prisma.movimentacaoEstoque.findMany({ where: { refId: nota.id }, orderBy: { criadoEm: "asc" } });
    expect(movs.map((m: any) => [m.origem, Number(m.quantidade), m.custoUnitario.toString()])).toEqual([
      ["COMPRA", 2, "689.9"], ["COMPRA", 10, "18.45"], ["COMPRA", 15, "12.3333"],
    ]);
    const contas = await prisma.contaPagar.findMany({ where: { notaCompraId: nota.id }, orderBy: { numero: "asc" } });
    expect(contas.map((c: any) => [c.valorTotal.toString(), c.dataVencimento.toISOString().slice(0, 10)])).toEqual([
      ["583.1", "2026-11-14"], ["583.1", "2026-12-14"], ["583.1", "2027-01-13"],
    ]);
    // saldo de cada produto = soma do razão
    for (const p of await prisma.produto.findMany()) {
      const soma = await prisma.movimentacaoEstoque.aggregate({ where: { produtoId: p.id }, _sum: { quantidade: true } });
      expect(Number(p.saldo)).toBe(Number(soma._sum.quantidade ?? 0));
    }
    expect((await prisma.notaCompra.findUnique({ where: { id: nota.id } })).status).toBe("LANCADA");
  }, 60_000);

  it("duas importações simultâneas do mesmo XML: só uma cria a nota", async () => {
    const rs = await Promise.allSettled([1, 2, 3].map(() => lib.importarNota({ empresaId: "e1", usuarioId: "u1", xml: XML2 })));
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(rs.filter((r) => r.status === "rejected").every((r: any) => r.reason instanceof lib.ErroNota && r.reason.status === 409)).toBe(true);
    expect(await prisma.notaCompra.count({ where: { chaveAcesso: "35261111222333000181550010000046101000046103" } })).toBe(1);
    // e a 2ª nota do mesmo fornecedor já veio com o gás vinculado (aprendido no teste anterior)
    const nota = await prisma.notaCompra.findFirst({ where: { numero: "4610" }, include: { itens: { orderBy: { numeroItem: "asc" } } } });
    expect(nota.itens.map((i: any) => i.produtoId)).toEqual(["pGas", null]);
  }, 60_000);
});
