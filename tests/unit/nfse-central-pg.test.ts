/**
 * Tela central "Notas fiscais de serviço" com o Prisma num PostgreSQL REAL:
 *  - período pela data fiscal (autorizada: autorização; senão: envio), mês e intervalo, em Brasília;
 *  - busca por número, tomador (nome/CNPJ), nº da OS e da medição; situação; ambiente; paginação;
 *  - cards: em aberto (medições aprovadas sem NFS-e), em transmissão, emitidas, com falha,
 *    canceladas e total — do período e do ambiente, sem depender da busca/situação;
 *  - nada do PlugNotas vaza (só "tem PDF/XML"); empresa da sessão; abrir tira do sino;
 *  - a página e o detalhe exigem Financeiro › Fiscal.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/nfse-central-pg
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_nfse_central_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
const FISCAL = montarPermissoes({ financeiro: ["visualizar", "medicoes", "fiscal"] });
const SO_MEDICOES = montarPermissoes({ financeiro: ["visualizar", "medicoes"] });

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
const redirecionou = vi.hoisted(() => ({ para: null as string | null }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { redirecionou.para = u; throw new Error(`NEXT_REDIRECT ${u}`); } }));
const logar = (permissoes: Permissoes, empresaId = "e1") => {
  sessao.atual = { user: { id: "u1", name: "Ana", email: "a@x.com", empresaId, role: "OPERADOR", permissoes } };
};

// Outubro/2026 em Brasília: 01/10 03:00 UTC até 01/11 03:00 UTC
const AGORA = new Date("2026-10-20T15:00:00Z");
const d = (s: string) => new Date(s);

describe.skipIf(!URL_PG)("Notas fiscais — tela central (PostgreSQL real)", () => {
  let prisma: any;
  let central: typeof import("@/lib/nfse/central-server");
  const carregar = (sp: Record<string, string> = {}) => central.carregarCentral("e1", sp, AGORA);
  const ids = (r: { notas: { id: string }[] }) => r.notas.map((n) => n.id);

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    central = await import("@/lib/nfse/central-server");
  }, 120_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  const nota = (id: string, o: Record<string, unknown> = {}) => ({
    id, empresaId: "e1", clienteId: "c1", medicaoId: "m1", origem: "MEDICAO", ambiente: "HOMOLOGACAO", status: "CONCLUIDO",
    grupo: "g", valorServicos: 100, discriminacao: "Serviço", tomadorCpfCnpj: "60701190000104", tomadorNome: "Hospital Santa Clara", ...o,
  });

  beforeEach(async () => {
    for (const t of ["notaFiscalEvento", "notaFiscalItem", "notaFiscal", "medicaoNf", "medicao", "ordemServico", "cliente", "usuario", "empresa"]) await prisma[t].deleteMany({});
    await prisma.empresa.createMany({ data: [{ id: "e1", nome: "Clima Total", cnpj: "12345678000190", email: "e@x.com" }, { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" }] });
    await prisma.usuario.create({ data: { id: "u1", empresaId: "e1", nome: "Ana", email: "a@x.com", senha: "x" } });
    await prisma.cliente.createMany({ data: [{ id: "c1", empresaId: "e1", nome: "Hospital Santa Clara", cpfCnpj: "60.701.190/0001-04" }, { id: "c2", empresaId: "e2", nome: "Outro", cpfCnpj: "11.222.333/0001-81" }] });
    await prisma.ordemServico.create({ data: { id: "os1", empresaId: "e1", numero: "OS-2026-8802", clienteId: "c1", criadoPorId: "u1", descricao: "x", status: "CONCLUIDA" } });
    await prisma.medicao.createMany({ data: [
      { id: "m1", empresaId: "e1", clienteId: "c1", numero: "MED-2026-0009", status: "NF_EMITIDA", tokenPublico: "t1", criadoEm: d("2026-10-05T12:00:00Z") },
      // em aberto: aprovada (PC recebido) em outubro, sem nota e sem NF à mão
      { id: "m2", empresaId: "e1", clienteId: "c1", numero: "MED-2026-0010", status: "PC_RECEBIDO", valorLiquido: 1200, tokenPublico: "t2", criadoEm: d("2026-10-10T12:00:00Z") },
      // não contam: NF registrada à mão / nota viva / rascunho / setembro / outra empresa
      { id: "m3", empresaId: "e1", clienteId: "c1", numero: "MED-2026-0011", status: "PC_RECEBIDO", valorLiquido: 50, nfNumero: "123", tokenPublico: "t3", criadoEm: d("2026-10-10T12:00:00Z") },
      { id: "m4", empresaId: "e1", clienteId: "c1", numero: "MED-2026-0012", status: "PC_RECEBIDO", valorLiquido: 70, tokenPublico: "t4", criadoEm: d("2026-10-11T12:00:00Z") },
      { id: "m5", empresaId: "e1", clienteId: "c1", numero: "MED-2026-0013", status: "RASCUNHO", valorLiquido: 90, tokenPublico: "t5", criadoEm: d("2026-10-12T12:00:00Z") },
      { id: "m6", empresaId: "e1", clienteId: "c1", numero: "MED-2026-0014", status: "PC_RECEBIDO", valorLiquido: 30, tokenPublico: "t6", criadoEm: d("2026-09-12T12:00:00Z") },
      { id: "m7", empresaId: "e2", clienteId: "c2", numero: "MED-2026-0001", status: "PC_RECEBIDO", valorLiquido: 999, tokenPublico: "t7", criadoEm: d("2026-10-12T12:00:00Z") },
      // rejeitada não segura a medição: continua em aberto
      { id: "m8", empresaId: "e1", clienteId: "c1", numero: "MED-2026-0015", status: "PC_RECEBIDO", valorLiquido: 300, tokenPublico: "t8", criadoEm: d("2026-10-13T12:00:00Z") },
    ] });
    await prisma.notaFiscal.createMany({ data: [
      // autorizada em outubro (enviada em setembro): conta em OUTUBRO
      nota("nA", { numero: "2026000122", criadoEm: d("2026-09-30T23:00:00Z"), autorizadaEm: d("2026-10-01T04:00:00Z"), valorServicos: 180, plugnotasId: "pnA", pdfUrl: "https://api.plugnotas/x.pdf", xmlUrl: "https://api.plugnotas/x.xml", avisoVistoEm: null }),
      // autorizada em 31/10 23:30 BRT (= 01/11 02:30 UTC): ainda outubro
      nota("nB", { numero: "2026000150", criadoEm: d("2026-10-31T20:00:00Z"), autorizadaEm: d("2026-11-01T02:30:00Z"), valorServicos: 1450, plugnotasId: "pnB", pdfUrl: null, xmlUrl: "https://api.plugnotas/b.xml", medicaoId: null, ordemServicoId: "os1", origem: "OS" }),
      nota("nC", { status: "PROCESSANDO", criadoEm: d("2026-10-15T12:00:00Z"), valorServicos: 70, medicaoId: "m4" }),
      nota("nD", { status: "REJEITADO", criadoEm: d("2026-10-16T12:00:00Z"), valorServicos: 300, motivo: "E-SP 105: código não permitido", medicaoId: "m8", tomadorNome: "Supermercado Bom Preço", tomadorCpfCnpj: "11222333000181" }),
      nota("nE", { status: "INTERROMPIDO", criadoEm: d("2026-10-17T12:00:00Z"), valorServicos: 20 }),
      nota("nF", { status: "CANCELADO", numero: "2026000100", criadoEm: d("2026-10-02T12:00:00Z"), autorizadaEm: d("2026-10-02T12:10:00Z"), valorServicos: 40 }),
      nota("nG", { status: "ENVIANDO", criadoEm: d("2026-10-18T12:00:00Z"), valorServicos: 5, ambiente: "PRODUCAO" }),
      // fora: autorizada em novembro (enviada em outubro) / setembro / outra empresa
      nota("nH", { numero: "2026000999", criadoEm: d("2026-10-31T10:00:00Z"), autorizadaEm: d("2026-11-01T03:00:00Z"), valorServicos: 1000 }),
      nota("nI", { status: "PROCESSANDO", criadoEm: d("2026-09-29T12:00:00Z"), valorServicos: 1 }),
      nota("nJ", { empresaId: "e2", clienteId: "c2", medicaoId: "m7", criadoEm: d("2026-10-10T12:00:00Z"), autorizadaEm: d("2026-10-10T12:00:00Z"), valorServicos: 999 }),
    ] });
    logar(FISCAL);
  });

  it("outubro (padrão = mês corrente): pela data fiscal, mais recentes primeiro; outra empresa nunca", async () => {
    const r = await carregar();
    expect(r.filtros.periodo).toMatchObject({ tipo: "mes", mes: "2026-10", rotulo: "Outubro de 2026" });
    expect(ids(r)).toEqual(["nB", "nG", "nE", "nD", "nC", "nF", "nA"]);
    expect(r.total).toBe(7);
  });

  it("cards do período: em aberto (medições), transmissão, emitidas, falha, canceladas, total", async () => {
    const { resumo } = await carregar();
    expect(resumo).toEqual({
      aberto: { q: 2, v: 1500 },           // m2 (1200) + m8 (300; a nota dela foi rejeitada)
      transmissao: { q: 2, v: 75 },        // nC + nG
      emitidas: { q: 2, v: 1630 },         // nA + nB
      falha: { q: 2, v: 320 },             // nD + nE
      canceladas: { q: 1, v: 40 },         // nF
      total: { q: 7, v: 1630 },
    });
    // os cards não mudam com a busca nem com a situação
    expect((await carregar({ q: "Supermercado", situacao: "falha" })).resumo).toEqual(resumo);
    // mas seguem o ambiente
    expect((await carregar({ ambiente: "PRODUCAO" })).resumo).toMatchObject({ transmissao: { q: 1, v: 5 }, emitidas: { q: 0, v: 0 }, total: { q: 1, v: 0 } });
  });

  it("‹ mês anterior / seguinte ›: setembro e novembro", async () => {
    expect(ids(await carregar({ mes: "2026-09" }))).toEqual(["nI"]);
    expect(ids(await carregar({ mes: "2026-11" }))).toEqual(["nH"]);
    expect((await carregar({ mes: "2026-09" })).resumo.aberto).toEqual({ q: 1, v: 30 });
  });

  it("intervalo personalizado (dias de Brasília, fim inclusivo)", async () => {
    expect(ids(await carregar({ de: "2026-10-15", ate: "2026-10-16" }))).toEqual(["nD", "nC"]);
    expect(ids(await carregar({ de: "2026-10-31", ate: "2026-11-01" }))).toEqual(["nH", "nB"]);
    expect((await carregar({ de: "2026-10-15", ate: "2026-10-16" })).filtros.periodo).toMatchObject({ tipo: "intervalo", rotulo: "15/10/2026 a 16/10/2026" });
  });

  it("busca: número, tomador (nome e CNPJ com ou sem pontuação), OS e medição", async () => {
    expect(ids(await carregar({ q: "2026000122" }))).toEqual(["nA"]);
    expect(ids(await carregar({ q: "supermercado" }))).toEqual(["nD"]);
    expect(ids(await carregar({ q: "11.222.333" }))).toEqual(["nD"]);
    expect(ids(await carregar({ q: "OS-2026-8802" }))).toEqual(["nB"]);
    expect(ids(await carregar({ q: "MED-2026-0015" }))).toEqual(["nD"]);
    expect(ids(await carregar({ q: "nada-disso" }))).toEqual([]);
  });

  it("situação e ambiente", async () => {
    expect(ids(await carregar({ situacao: "falha" }))).toEqual(["nE", "nD"]);
    expect(ids(await carregar({ situacao: "transmissao" }))).toEqual(["nG", "nC"]);
    expect(ids(await carregar({ situacao: "emitidas" }))).toEqual(["nB", "nA"]);
    expect(ids(await carregar({ situacao: "canceladas" }))).toEqual(["nF"]);
    expect(ids(await carregar({ ambiente: "PRODUCAO" }))).toEqual(["nG"]);
    expect(ids(await carregar({ ambiente: "HOMOLOGACAO", situacao: "transmissao" }))).toEqual(["nC"]);
  });

  it("paginação no padrão (25 por página); página além do fim volta para a última", async () => {
    await prisma.notaFiscal.createMany({ data: Array.from({ length: 30 }, (_, i) => nota(`x${String(i).padStart(2, "0")}`, { status: "PROCESSANDO", criadoEm: d(`2026-10-03T${String(i % 24).padStart(2, "0")}:${String(i).padStart(2, "0")}:00Z`) })) });
    const p1 = await carregar({ por: "25" });
    expect([p1.total, p1.notas.length, p1.pagina, p1.porPagina]).toEqual([37, 25, 1, 25]);
    const p2 = await carregar({ por: "25", pagina: "2" });
    expect([p2.notas.length, p2.pagina]).toEqual([12, 2]);
    expect(new Set([...ids(p1), ...ids(p2)]).size).toBe(37);
    expect((await carregar({ por: "25", pagina: "9" })).pagina).toBe(2);
  });

  it("linha: origem (OS/medição), datas, valor e só 'tem PDF/XML' — nenhum endereço do PlugNotas", async () => {
    const r = await carregar();
    const a = r.notas.find((n) => n.id === "nA")!;
    const b = r.notas.find((n) => n.id === "nB")!;
    expect(a).toMatchObject({ status: "CONCLUIDO", statusLabel: "Autorizada", numero: "2026000122", medicaoNumero: "MED-2026-0009", osNumero: null, valorServicos: 180, temPdf: true, temXml: true, autorizadaEm: "2026-10-01T04:00:00.000Z" });
    expect(b).toMatchObject({ origem: "OS", osNumero: "OS-2026-8802", ordemServicoId: "os1", medicaoId: null, temPdf: false, temXml: true });
    expect(r.notas.find((n) => n.id === "nD")).toMatchObject({ statusLabel: "Rejeitada", motivo: "E-SP 105: código não permitido" });
    const json = JSON.stringify(r);
    expect(json).not.toContain("plugnotas/");
    expect(json).not.toContain("pnA");
  });

  it("abrir a central (Fiscal) tira do sino o resultado das notas da página; as que esperam, não", async () => {
    await carregar({ situacao: "emitidas" });
    const vistas = await prisma.notaFiscal.findMany({ where: { empresaId: "e1" }, select: { id: true, avisoVistoEm: true } });
    const visto = Object.fromEntries(vistas.map((n: any) => [n.id, !!n.avisoVistoEm]));
    expect([visto.nA, visto.nB, visto.nD, visto.nC]).toEqual([true, true, false, false]);
  });

  describe("detalhe e permissões", () => {
    const detalhe = async (id: string) => {
      const m = await import("@/app/api/fiscal/notas/[id]/route");
      const res = await m.GET(new NextRequest(`http://localhost/api/fiscal/notas/${id}`), { params: Promise.resolve({ id }) });
      return { status: res.status, json: await res.json() as any };
    };
    const pagina = async () => {
      const m = await import("@/app/(dashboard)/financeiro/notas-fiscais/page");
      redirecionou.para = null;
      try { return await m.default({ searchParams: Promise.resolve({}) }); } catch (e) { return String((e as Error).message); }
    };

    it("detalhe: dados fiscais, itens, discriminação e histórico (mais recente primeiro), sem endereços", async () => {
      await prisma.notaFiscalItem.create({ data: { notaId: "nD", descricao: "Instalação split 18k", quantidade: 1, valorTotal: 300 } });
      await prisma.notaFiscalEvento.createMany({ data: [
        { notaId: "nD", tipo: "ENVIO", usuarioId: "u1", status: "PROCESSANDO", mensagem: "Enviada ao PlugNotas", criadoEm: d("2026-10-16T12:00:00Z") },
        { notaId: "nD", tipo: "STATUS", status: "REJEITADO", mensagem: "E-SP 105: código não permitido", criadoEm: d("2026-10-16T12:01:00Z") },
      ] });
      const r = await detalhe("nD");
      expect(r.status).toBe(200);
      expect(r.json).toMatchObject({ id: "nD", status: "REJEITADO", motivo: "E-SP 105: código não permitido", discriminacao: "Serviço", medicaoNumero: "MED-2026-0015" });
      expect(r.json.itens).toEqual([{ descricao: "Instalação split 18k", quantidade: 1, valorTotal: 300, valorDesconto: 0 }]);
      expect(r.json.eventos.map((e: any) => [e.mensagem, e.usuario])).toEqual([["E-SP 105: código não permitido", null], ["Enviada ao PlugNotas", "Ana"]]);
      expect(JSON.stringify(r.json)).not.toContain("plugnotas/");
      // abrir o detalhe também tira do sino
      expect((await prisma.notaFiscal.findUnique({ where: { id: "nD" } })).avisoVistoEm).toBeTruthy();
    });

    it("detalhe: nota de outra empresa = 404; sem Fiscal = 403", async () => {
      expect((await detalhe("nJ")).status).toBe(404);
      expect((await detalhe("nao-existe")).status).toBe(404);
      logar(SO_MEDICOES);
      expect((await detalhe("nA")).status).toBe(403);
    });

    it("página: sem Fiscal vai para /sem-permissao; com Fiscal renderiza", async () => {
      logar(SO_MEDICOES);
      expect(await pagina()).toBe("NEXT_REDIRECT /sem-permissao");
      logar(FISCAL);
      const el = await pagina();
      expect(typeof el).toBe("object");
      expect(redirecionou.para).toBeNull();
    });
  });
});
