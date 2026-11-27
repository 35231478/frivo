/**
 * Notas de compra 2 — Prisma real, PostgreSQL real, rotas reais:
 *  - a lista: valores do XML (produtos, frete, desconto, ICMS, ICMS-ST, IPI), pedido vinculado, quem lançou
 *    (a entrada no estoque), nota sem XML sem valores; tudo só da empresa da sessão;
 *  - o período pela emissão (padrão) ou pela entrada (o lançamento), com a virada do dia de Brasília;
 *  - a visualização rápida: os dados e a DANFE; o PDF (application/pdf, %PDF, nome pela chave); o XML como
 *    foi importado; nota sem XML: sem DANFE e 404 no PDF/XML; outra empresa: 404; sem permissão: 403;
 *  - a preferência da tabela guarda a ORDEM das colunas (e recusa o que não é dela).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/notas-compra-2-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_notas2_pg_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
const fixture = (n: string) => readFileSync(path.resolve(__dirname, `fixtures/nfe/${n}`), "utf8");
const XML_4521 = fixture("nfe-4521-frigelar.xml");
const XML_4610 = fixture("nfe-4610-frigelar.xml");
const XML_4800 = fixture("nfe-4800-refrigas.xml");
vi.setConfig({ testTimeout: 60_000 });

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
const como = (empresaId = "e1", permissoes: Permissoes = permissoesTotais()) => {
  sessao.atual = { user: { id: empresaId === "e1" ? "u1" : "u2", name: "Ana", email: "a@x.com", empresaId, role: "OPERADOR", permissoes, tecnicoId: null } };
};

async function rota(caminho: string, params: Record<string, string>, metodo = "GET", corpo?: unknown) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${caminho}/route`);
  const req = new NextRequest("http://localhost/api/x", { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  return (await mod[metodo](req, { params: Promise.resolve(params) })) as Response;
}

describe.skipIf(!URL_PG)("notas de compra 2 (PostgreSQL real)", () => {
  let prisma: any;
  let lib: typeof import("@/lib/compras/notas");
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    lib = await import("@/lib/compras/notas");
    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "u1", empresaId: "e1", nome: "Ana Compras", email: "a@x.com", senha: "x" },
      { id: "uL", empresaId: "e1", nome: "Bruno Estoque", email: "b@x.com", senha: "x" },
      { id: "u2", empresaId: "e2", nome: "Beto", email: "beto@x.com", senha: "x" },
    ] });
    await prisma.produto.create({ data: { id: "pGas", empresaId: "e1", nome: "Gás R410A", unidade: "un" } });
    for (const [k, xml] of [["n4521", XML_4521], ["n4610", XML_4610], ["n4800", XML_4800]] as const) {
      ids[k] = (await lib.importarNota({ empresaId: "e1", usuarioId: "u1", xml })).nota.id;
    }
    // A outra empresa com uma nota de mesmo número e chave (a importação exige o CNPJ dela: grava direto)
    await prisma.fornecedor.create({ data: { id: "f2", empresaId: "e2", nome: "Fornecedor da outra", documento: "11222333000181" } });
    ids.outra = (await prisma.notaCompra.create({ data: {
      empresaId: "e2", fornecedorId: "f2", chaveAcesso: "35261011222333000181550010000045211000045217", numero: "4521", serie: "1",
      dataEmissao: new Date("2026-10-15T13:30:00Z"), valorTotal: 1749.3, xml: XML_4521, emitenteNome: "Fornecedor da outra", emitenteCnpj: "11222333000181",
    } })).id;
    // A 4521 lançada no dia 16/10 às 00h30 de Brasília (03h30 UTC), com a entrada no estoque feita pelo Bruno
    await prisma.notaCompra.update({ where: { id: ids.n4521 }, data: { status: "LANCADA", lancadaEm: new Date("2026-10-16T03:30:00Z") } });
    await prisma.movimentacaoEstoque.create({ data: { empresaId: "e1", produtoId: "pGas", tipo: "ENTRADA", origem: "COMPRA", refId: ids.n4521, quantidade: 2, saldoApos: 2, usuarioId: "uL" } });
    // A 4610 atende um pedido de compra
    await prisma.pedidoCompraInterno.create({ data: { id: "pc1", empresaId: "e1", numero: "PC-2026-0007", solicitanteId: "u1" } }).catch(async () => {
      // o pedido tem outros campos obrigatórios: cria com o mínimo que o schema exige
      await prisma.$executeRawUnsafe(`INSERT INTO "pedidos_compra_internos" ("id", "empresa_id", "numero", "solicitante_id") VALUES ('pc1', 'e1', 'PC-2026-0007', 'u1')`);
    });
    await prisma.notaCompra.update({ where: { id: ids.n4610 }, data: { pedidoCompraId: "pc1" } });
    // Uma nota sem XML (de antes de guardar o arquivo, ou importada de outro jeito)
    ids.semXml = (await prisma.notaCompra.create({ data: {
      empresaId: "e1", fornecedorId: (await prisma.notaCompra.findUnique({ where: { id: ids.n4800 } })).fornecedorId,
      chaveAcesso: "35261199999999000100550010000099991000099990", numero: "9999", serie: "1", dataEmissao: new Date("2026-11-20T15:00:00Z"),
      valorTotal: 100, xml: "<nfeProc/>", emitenteNome: "Fornecedor Antigo", emitenteCnpj: "99999999000100",
    } })).id;
  }, 180_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  const lista = async (sp: Record<string, string> = {}) => (await lib.listarNotas("e1", { pagina: 1, porPagina: 50 }, sp)).notas;
  const porNumero = async (sp: Record<string, string> = {}) => Object.fromEntries((await lista(sp)).map((n) => [n.numero, n]));

  it("a lista: valores do XML, pedido, quem lançou, entrada; nota sem XML sem valores; só a empresa da sessão", async () => {
    const n = await porNumero();
    expect(Object.keys(n).sort()).toEqual(["4521", "4610", "4800", "9999"]);
    expect(n["4521"]).toMatchObject({ serie: "1", chave: "35261011222333000181550010000045211000045217", cnpj: "11222333000181", itens: 3, valorTotal: 1749.3,
      entrada: "2026-10-16T03:30:00.000Z", lancadoPor: "Bruno Estoque", pedido: null, status: "LANCADA" });
    expect(n["4521"].valores).toEqual({ produtos: 1749.3, frete: 0, desconto: 0, icms: 314.87, icmsSt: 0, ipi: 0 });
    expect(n["4610"].pedido).toEqual({ id: "pc1", numero: "PC-2026-0007" });
    expect(n["4610"].valores?.frete).toBe(15);
    expect(n["4610"]).toMatchObject({ entrada: null, lancadoPor: null }); // não lançada: sem entrada, sem quem lançou
    expect(n["9999"].valores).toBeNull();
    // a outra empresa tem a mesma 4521, mas não aparece
    expect((await lib.listarNotas("e2", {}, {})).notas.map((x) => x.id)).toEqual([ids.outra]);
  });

  it("período pela emissão (padrão) e pela entrada, com o dia de Brasília", async () => {
    const nums = async (sp: Record<string, string>) => (await lista(sp)).map((x) => x.numero).sort();
    // todo o período por padrão
    expect(await nums({})).toEqual(["4521", "4610", "4800", "9999"]);
    // emissão em outubro/2026: só a 4521 (15/10)
    expect(await nums({ mes: "2026-10" })).toEqual(["4521"]);
    expect(await nums({ de: "2026-11-01", ate: "2026-11-30" })).toEqual(["4610", "4800", "9999"]);
    // pela entrada: só a lançada; 16/10 às 00h30 de Brasília é o dia 16 (em UTC já seria 16, mas às 03h30)
    expect(await nums({ data: "entrada", de: "2026-10-16", ate: "2026-10-16" })).toEqual(["4521"]);
    expect(await nums({ data: "entrada", de: "2026-10-15", ate: "2026-10-15" })).toEqual([]);
    expect(await nums({ data: "entrada", mes: "2026-11" })).toEqual([]);
    // situação e período juntos
    expect(await nums({ status: "IMPORTADA", de: "2026-11-01", ate: "2026-11-30" })).toEqual(["4610", "4800", "9999"]);
  });

  it("visualização rápida: os dados da nota e a DANFE do XML; outra empresa 404; sem permissão 403", async () => {
    como();
    const r = await rota("compras/notas/[id]/visualizar", { id: ids.n4610 });
    expect(r.status).toBe(200);
    const v = await r.json();
    expect(v.nota).toMatchObject({ numero: "4610", pedido: { numero: "PC-2026-0007" }, status: "IMPORTADA" });
    expect(v.nota.itens.length).toBe(2);
    expect(v.danfe).toMatchObject({ numero: "4610", serie: "1", emitente: { documento: "11222333000181" }, totais: { frete: 15 } });
    expect(v.danfe.itens.length).toBe(2);
    expect((await rota("compras/notas/[id]/visualizar", { id: ids.outra })).status).toBe(404);
    como("e1", montarPermissoes({ financeiro: ["visualizar"] } as never));
    expect((await rota("compras/notas/[id]/visualizar", { id: ids.n4610 })).status).toBe(403);
    expect((await rota("compras/notas/[id]/danfe", { id: ids.n4610 })).status).toBe(403);
    expect((await rota("compras/notas/[id]/xml", { id: ids.n4610 })).status).toBe(403);
  });

  it("Baixar PDF: a DANFE em PDF, com o nome pela chave", async () => {
    como();
    const r = await rota("compras/notas/[id]/danfe", { id: ids.n4521 });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/pdf");
    expect(r.headers.get("content-disposition")).toBe('attachment; filename="DANFE-35261011222333000181550010000045211000045217.pdf"');
    const bytes = new Uint8Array(await r.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const { PDFDocument } = await import("pdf-lib");
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getTitle()).toBe("DANFE simplificada · NF-e 4521/1");
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
    expect((await rota("compras/notas/[id]/danfe", { id: ids.outra })).status).toBe(404);
  });

  it("Baixar XML: o arquivo como foi importado; outra empresa 404", async () => {
    como();
    const r = await rota("compras/notas/[id]/xml", { id: ids.n4800 });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    expect(r.headers.get("content-disposition")).toMatch(/^attachment; filename="\d{44}-nfe\.xml"$/);
    expect(await r.text()).toBe(XML_4800);
    expect((await rota("compras/notas/[id]/xml", { id: ids.outra })).status).toBe(404);
  });

  it("nota sem XML: a gaveta mostra o que existe (danfe nula) e não há PDF nem XML para baixar", async () => {
    como();
    const v = await (await rota("compras/notas/[id]/visualizar", { id: ids.semXml })).json();
    expect(v.danfe).toBeNull();
    expect(v.nota).toMatchObject({ numero: "9999", fornecedor: "Fornecedor Antigo", valorTotal: 100 });
    expect((await rota("compras/notas/[id]/danfe", { id: ids.semXml })).status).toBe(404);
    expect((await rota("compras/notas/[id]/xml", { id: ids.semXml })).status).toBe(404);
  });

  it("a preferência da tabela guarda a ordem das colunas (só a do próprio usuário) e recusa o que não conhece", async () => {
    como();
    const chave = "tabela:notas-compra";
    const put = await rota("preferencias/[chave]", { chave }, "PUT", { larguras: { nf: 130 }, ocultas: [], ordem: ["valor", "nf", "fornecedor"] });
    expect(put.status).toBe(200);
    const get = await (await rota("preferencias/[chave]", { chave })).json();
    expect(get.valor).toEqual({ larguras: { nf: 130 }, ocultas: [], ordem: ["valor", "nf", "fornecedor"] });
    expect((await rota("preferencias/[chave]", { chave }, "PUT", { larguras: {}, ordem: "valor,nf" })).status).toBe(400);
    expect((await rota("preferencias/[chave]", { chave }, "PUT", { larguras: {}, ordem: [], extra: 1 })).status).toBe(400);
    // outro usuário não vê a ordem do primeiro
    como("e2");
    expect((await (await rota("preferencias/[chave]", { chave })).json()).valor).toBeNull();
  });
});
