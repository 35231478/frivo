/**
 * Leva I.2 — grupo D, Prisma real, PostgreSQL real, rotas reais:
 *  12. descartar guarda o XML no descarte; "Restaurar" (POST /api/compras/notas/descartes/[id]/restaurar) reimporta pelo
 *      MESMO caminho da importação (fornecedor, itens, situação), marca quem restaurou, quando e a nota que voltou (a
 *      trilha, também na lista dos descartes); recusa: já restaurada, descarte antigo sem XML, a chave já importada de
 *      novo (com o link da nota), outra empresa (404) e sem Estoque › gerenciar (403);
 *  15. o sino devolve o id do item (veículo do documento vencendo, veículo do checklist com alertas, o lead mais
 *      recente) sem mudar as contagens; o filtro da frota `documentos` conta o mesmo que o sino; "Novos em 24h" nos leads.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/leva-i2d-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { MSG_DESCARTE_JA_RESTAURADO, MSG_DESCARTE_SEM_XML } from "@/lib/cadastros/regras-arquivar";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_leva_i2d_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
const XML_4521 = readFileSync(path.resolve(__dirname, "fixtures/nfe/nfe-4521-frigelar.xml"), "utf8");
const XML_4610 = readFileSync(path.resolve(__dirname, "fixtures/nfe/nfe-4610-frigelar.xml"), "utf8");
vi.setConfig({ testTimeout: 60_000 });

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
// O sino (GET /api/alertas) agenda a conferência das NFS-e para depois da resposta: fora de uma requisição, nada
vi.mock("@/lib/nfse/webhook-server", async (orig) => ({ ...(await orig<object>()), reconciliarEmpresa: vi.fn(async () => {}) }));
vi.mock("next/server", async (orig) => ({ ...(await orig<object>()), after: (fn: () => void) => { void fn; } }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`REDIRECT:${u}`); }, notFound: () => { throw new Error("NOT_FOUND"); }, useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push() {}, replace() {}, refresh() {} }), usePathname: () => "/" }));
const como = (empresaId = "e1", permissoes: Permissoes = permissoesTotais(), id = empresaId === "e1" ? "u1" : "u2") => {
  sessao.atual = { user: { id, name: "Ana", email: `${id}@x.com`, empresaId, role: "OPERADOR", permissoes, tecnicoId: null } };
};

async function rota(caminho: string, params: Record<string, string>, metodo = "GET", corpo?: unknown) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${caminho}/route`);
  const req = new NextRequest("http://localhost/api/x", { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: (res.headers.get("content-type") ?? "").includes("json") ? await res.json() : null };
}

describe.skipIf(!URL_PG)("Leva I.2 — grupo D (PostgreSQL real)", () => {
  let prisma: any;
  let lib: typeof import("@/lib/compras/notas");

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    lib = await import("@/lib/compras/notas");
    await Promise.all(["compras/notas/[id]", "compras/notas/descartes/[id]/restaurar", "alertas"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));
    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "u1", empresaId: "e1", nome: "Ana Compras", email: "a@x.com", senha: "x" },
      { id: "uB", empresaId: "e1", nome: "Bruno Estoque", email: "b@x.com", senha: "x" },
      { id: "u2", empresaId: "e2", nome: "Beto", email: "beto@x.com", senha: "x" },
    ] });
  }, 180_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  /* ───────── 12 ───────── */
  it("descartar guarda o XML; restaurar reimporta pelo caminho da importação e deixa a trilha", async () => {
    const importada = await lib.importarNota({ empresaId: "e1", usuarioId: "u1", xml: XML_4521 });
    const itens = await prisma.notaCompraItem.count({ where: { notaId: importada.nota.id } });
    como();
    expect((await rota("compras/notas/[id]", { id: importada.nota.id }, "DELETE", { motivo: "Importada por engano" })).status).toBe(200);
    const d = await prisma.notaCompraDescarte.findFirst({ where: { notaId: importada.nota.id } });
    expect(d.xml).toBe(XML_4521);
    expect([d.restauradaEm, d.restauradaPorId, d.notaRestauradaId]).toEqual([null, null, null]);
    expect((await lib.descartesRecentes("e1"))[0]).toMatchObject({ id: d.id, temXml: true, restauradaEm: null, restauradaPor: null });

    // sem Estoque › gerenciar: 403 (a mesma permissão de descartar); outra empresa: 404
    como("e1", montarPermissoes({ estoque: ["visualizar"] }));
    expect((await rota("compras/notas/descartes/[id]/restaurar", { id: d.id }, "POST")).status).toBe(403);
    como("e2");
    expect((await rota("compras/notas/descartes/[id]/restaurar", { id: d.id }, "POST")).status).toBe(404);
    expect(await prisma.notaCompra.count({ where: { chaveAcesso: d.chaveAcesso } })).toBe(0);

    como("e1", permissoesTotais(), "uB");
    const r = await rota("compras/notas/descartes/[id]/restaurar", { id: d.id }, "POST");
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ totalItens: itens, fornecedor: { id: importada.fornecedor.id } });
    const nova = await prisma.notaCompra.findUnique({ where: { id: r.json.nota.id }, include: { _count: { select: { itens: true } } } });
    expect([nova.chaveAcesso, nova.empresaId, nova.xml, nova._count.itens, nova.usuarioId, nova.status]).toEqual([d.chaveAcesso, "e1", XML_4521, itens, "uB", importada.nota.status]);
    const depois = await prisma.notaCompraDescarte.findUnique({ where: { id: d.id } });
    expect([depois.restauradaPorId, depois.notaRestauradaId]).toEqual(["uB", nova.id]);
    expect(Date.now() - depois.restauradaEm.getTime()).toBeLessThan(60_000);
    expect((await lib.descartesRecentes("e1"))[0]).toMatchObject({ id: d.id, restauradaPor: "Bruno Estoque", notaRestauradaId: nova.id });

    // restaurar de novo: recusado
    expect(await rota("compras/notas/descartes/[id]/restaurar", { id: d.id }, "POST")).toEqual({ status: 409, json: { erro: MSG_DESCARTE_JA_RESTAURADO } });
  });

  it("recusa: descarte antigo sem XML (Importe o XML de novo) e a chave que já foi importada de novo (com o link)", async () => {
    const antigo = await prisma.notaCompraDescarte.create({ data: {
      empresaId: "e1", notaId: "nAntiga", chaveAcesso: "35261199999999000100550010000099991000099990", numero: "9999", serie: "1",
      emitenteNome: "Fornecedor Antigo", emitenteCnpj: "99999999000100", valorTotal: 100, dataEmissao: new Date("2026-10-01T12:00:00Z"), statusNaHora: "IMPORTADA",
    } });
    como();
    expect(await rota("compras/notas/descartes/[id]/restaurar", { id: antigo.id }, "POST")).toEqual({ status: 409, json: { erro: MSG_DESCARTE_SEM_XML } });
    expect((await lib.descartesRecentes("e1")).find((x) => x.id === antigo.id)?.temXml).toBe(false);

    // a 4610: descartada e depois alguém subiu o XML de novo
    const n = await lib.importarNota({ empresaId: "e1", usuarioId: "u1", xml: XML_4610 });
    await lib.descartarNota({ empresaId: "e1", usuarioId: "u1", id: n.nota.id, motivo: "" });
    const d = await prisma.notaCompraDescarte.findFirst({ where: { notaId: n.nota.id } });
    const reimportada = await lib.importarNota({ empresaId: "e1", usuarioId: "u1", xml: XML_4610 });
    const r = await rota("compras/notas/descartes/[id]/restaurar", { id: d.id }, "POST");
    expect(r.status).toBe(409);
    expect(r.json.erro).toMatch(/^A NF \d+\/\d+ já foi importada de novo em \d{2}\/\d{2}\/\d{4}: não há o que restaurar\. Abra a nota importada\.$/);
    expect(r.json.notaId).toBe(reimportada.nota.id);
    expect((await prisma.notaCompraDescarte.findUnique({ where: { id: d.id } })).restauradaEm).toBeNull();
    expect(await prisma.notaCompra.count({ where: { empresaId: "e1", chaveAcesso: d.chaveAcesso } })).toBe(1);
  });

  /* ───────── 15 ───────── */
  it("sino: o id do item (veículo do documento, do checklist com alertas, o lead) sem mudar as contagens", async () => {
    const { contarAlertasVeiculos } = await import("@/lib/veiculo-server");
    const { hojeDiaCivil } = await import("@/lib/fuso");
    await prisma.veiculo.createMany({ data: [
      { id: "v1", empresaId: "e1", placa: "FRV1A01", modelo: "Fiorino" },
      { id: "v2", empresaId: "e1", placa: "FRV1A02", modelo: "Strada", seguroVencimento: hojeDiaCivil(new Date(), 10) },
      { id: "v3", empresaId: "e1", placa: "FRV1A03", modelo: "Saveiro" },
    ] });
    await prisma.checklistTemplate.create({ data: { id: "ck", empresaId: "e1", nome: "Diário" } });
    await prisma.checklistPreenchido.createMany({ data: [
      { id: "c1", empresaId: "e1", veiculoId: "v1", templateId: "ck", status: "CONCLUIDO" },
      { id: "c2", empresaId: "e1", veiculoId: "v3", templateId: "ck", status: "COM_ALERTAS" },
    ] });
    let a = await contarAlertasVeiculos("e1");
    expect([a.documentosVencendo, a.documentoVencendoVeiculoId, a.checklistsComAlertas, a.checklistAlertaVeiculoId, a.checklistAlertaId]).toEqual([1, "v2", 1, "v3", "c2"]);
    // um documento vencido de outro veículo: são 2 (o id não serve mais para o link) — e o filtro da frota conta os mesmos 2
    await prisma.veiculo.update({ where: { id: "v1" }, data: { seguroVencimento: hojeDiaCivil(new Date(), -5) } });
    a = await contarAlertasVeiculos("e1");
    expect([a.documentosVencendo, a.documentoVencendoVeiculoId]).toEqual([2, null]);
    const { whereAviso } = await import("@/lib/veiculo-listagem");
    expect(await prisma.veiculo.count({ where: { AND: [{ empresaId: "e1" }, whereAviso("documentos")!] } })).toBe(2);
    expect(await prisma.veiculo.count({ where: { AND: [{ empresaId: "e1" }, whereAviso("doc_vencendo")!] } })).toBe(1);

    // leads do site: o mais recente das últimas 24h
    await prisma.cliente.create({ data: { id: "cl", empresaId: "e1", nome: "Maria Silva", cpfCnpj: "1" } });
    await prisma.orcamento.createMany({ data: [
      { id: "oVelho", empresaId: "e1", codigo: "ORC-1", clienteId: "cl", nome: "Lead do site — antigo", criadoPorId: "u1", tokenPublico: "tk-velho", criadoEm: new Date(Date.now() - 3 * 86_400_000) },
      { id: "oNovo", empresaId: "e1", codigo: "ORC-2", clienteId: "cl", nome: "Lead do site — Maria", criadoPorId: "u1", tokenPublico: "tk-novo" },
    ] });
    como();
    const { GET } = await import("@/app/api/alertas/route");
    const s = await (await GET()).json();
    expect([s.leadsSite, s.leadSiteId, s.documentosVencendo, s.checklistsComAlertas, s.checklistAlertaVeiculoId]).toEqual([1, "oNovo", 2, 1, "v3"]);
    // a lista "Novos em 24h" mostra o mesmo que o sino conta
    const { renderToStaticMarkup } = await import("react-dom/server");
    const LeadsPage = (await import("@/app/(dashboard)/leads-site/page")).default;
    const html = renderToStaticMarkup(await LeadsPage({ searchParams: Promise.resolve({ status: "novos" }) }));
    expect(html).toContain('data-linha-lead="oNovo"');
    expect(html).not.toContain('data-linha-lead="oVelho"');
  });
});
