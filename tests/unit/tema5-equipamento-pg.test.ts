/**
 * Tema 5 no PostgreSQL REAL (schema descartável via `prisma db push`):
 *  (B) QR Code depois do 9999 — a mesma correção da OS: quem lê o maior usado compara NÚMERO, não texto
 *      ("QR-2026-9999" < "QR-2026-10000" como texto dava 9999 para sempre → código repetido);
 *  (C) aviso de nº de série duplicado — a consulta que alimenta o aviso: sem ligar para maiúsculas e
 *      espaços nas pontas, só da empresa, ignorando o próprio equipamento na edição. Só avisa: a série
 *      repetida continua podendo ser gravada.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/tema5-equipamento-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { permissoesTotais, permissoesVazias, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_tema5_pg_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
const logar = (empresaId = "e1", permissoes: Permissoes = permissoesTotais(), role = "ADMIN") => {
  sessao.atual = { user: { id: "u1", name: "Ana", email: "a@x.com", empresaId, role, permissoes, tecnicoId: null } };
};
async function serie(numero: string, ignorar?: string) {
  const { GET } = await import("@/app/api/equipamentos/serie/route");
  const qs = new URLSearchParams({ numero, ...(ignorar && { ignorar }) });
  const res = await GET(new NextRequest(`http://localhost/api/equipamentos/serie?${qs}`));
  return { status: res.status, json: await res.json() };
}

describe.skipIf(!URL_PG)("Tema 5 — equipamento (PostgreSQL real)", () => {
  let prisma: any;

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=20`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12345678000190", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" },
    ] });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital Santa Clara", cpfCnpj: "11111111000191", email: "h@x.com" },
      { id: "c2", empresaId: "e2", nome: "Cliente da outra", cpfCnpj: "22222222000192", email: "o2@x.com" },
    ] });
    await prisma.unidade.createMany({ data: [
      { id: "un1", empresaId: "e1", clienteId: "c1", nome: "Matriz" },
      { id: "un2", empresaId: "e2", clienteId: "c2", nome: "Sede" },
    ] });
    const eq = (id: string, empresaId: string, unidadeId: string, numeroSerie: string | null, extra: object = {}) =>
      ({ id, empresaId, unidadeId, tipo: "AR_CONDICIONADO_SPLIT", marca: "LG", modelo: "S4-W12", numeroSerie, ...extra });
    await prisma.equipamento.createMany({ data: [
      eq("eq1", "e1", "un1", "ABC123XYZ", { localizacao: "Recepção" }),
      eq("eq2", "e1", "un1", "  abc123xyz ", { ativo: false }), // série antiga, salva com espaço e minúsculas
      eq("eq3", "e1", "un1", "ZZZ999"),
      eq("eq4", "e2", "un2", "ABC123XYZ"), // outra empresa: nunca aparece
      eq("eq5", "e1", "un1", null),
    ] });
  }, 180_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  /* ───────── (B) QR Code depois do 9999 ───────── */
  describe("QR Code depois do 9999", () => {
    it("histórico no formato antigo até QR-2026-9999: o próximo é QR-10000 (e não repete o 9999)", async () => {
      const n = await import("@/lib/numeracao-server");
      const qr = await import("@/lib/qrcode-server");
      await prisma.qrcode.createMany({ data: [
        { empresaId: "e1", codigo: "QR-2025-0812" },
        { empresaId: "e1", codigo: "QR-2026-0998" },
        { empresaId: "e1", codigo: "QR-2026-9999" },
        { empresaId: "e2", codigo: "QR-2026-0003" },
      ] });
      expect(await n.maiorUsado(prisma, "e1", "qrcode")).toBe(9999);
      expect(await n.espiarProximo("e1", "qrcode")).toBe("QR-10000");
      expect((await qr.gerarQrCodeEquipamento("e1", "eq1")).codigo).toBe("QR-10000");
    });

    it("passou de 10000: o lote segue em sequência (10001, 10002, 10003) — comparação por número, não por texto", async () => {
      const n = await import("@/lib/numeracao-server");
      const qr = await import("@/lib/qrcode-server");
      expect(await qr.gerarLoteQrCodes("e1", 3)).toEqual(["QR-10001", "QR-10002", "QR-10003"]);
      // Como texto, "QR-9999" > "QR-10003": o maior usado tem de ser o 10003
      expect(await n.maiorUsado(prisma, "e1", "qrcode")).toBe(10003);
      expect((await qr.gerarQrCodeEquipamento("e1", "eq3")).codigo).toBe("QR-10004");
    });

    it("nenhum código repetido na empresa; a outra empresa tem a sua própria sequência", async () => {
      const qr = await import("@/lib/qrcode-server");
      const codigos = (await prisma.qrcode.findMany({ where: { empresaId: "e1" }, select: { codigo: true } })).map((q: any) => q.codigo);
      expect(new Set(codigos).size).toBe(codigos.length);
      expect(await qr.gerarLoteQrCodes("e2", 1)).toEqual(["QR-4"]);
    });

    it("20 gerações ao mesmo tempo depois do 9999: sem repetir e sem pular", async () => {
      const qr = await import("@/lib/qrcode-server");
      const lotes = await Promise.all(Array.from({ length: 20 }, () => qr.gerarLoteQrCodes("e1", 1)));
      const seqs = lotes.flat().map((c) => Number(c.split("-")[1])).sort((a, b) => a - b);
      expect(seqs).toEqual(Array.from({ length: 20 }, (_, i) => 10005 + i));
    });
  });

  /* ───────── (C) aviso de nº de série duplicado ───────── */
  describe("consulta do aviso de nº de série", () => {
    it("acha os da empresa sem ligar para maiúsculas e espaços nas pontas (inclusive série antiga salva com espaço)", async () => {
      logar();
      const r = await serie("  abc123xyz");
      expect(r.status).toBe(200);
      expect(r.json.duplicados.map((d: any) => d.id).sort()).toEqual(["eq1", "eq2"]);
      const eq1 = r.json.duplicados.find((d: any) => d.id === "eq1");
      expect(eq1.fabricanteModelo).toBe("LG S4-W12");
      expect(eq1.local).toBe("Hospital Santa Clara › Matriz › Recepção");
      expect(r.json.duplicados.find((d: any) => d.id === "eq2").ativo).toBe(false); // inativo também avisa, marcado
    });

    it("na edição, o próprio equipamento não conta como duplicado", async () => {
      logar();
      expect((await serie("ABC123XYZ", "eq1")).json.duplicados.map((d: any) => d.id)).toEqual(["eq2"]);
      expect((await serie("ZZZ999", "eq3")).json.duplicados).toEqual([]);
    });

    it("nunca mostra equipamento de outra empresa; série inédita não avisa; parte da série não é duplicata", async () => {
      logar("e2");
      expect((await serie("ABC123XYZ")).json.duplicados.map((d: any) => d.id)).toEqual(["eq4"]);
      logar("e1");
      expect((await serie("NOVA-777")).json.duplicados).toEqual([]);
      expect((await serie("ABC123")).json.duplicados).toEqual([]);
    });

    it("menos de 3 caracteres (ou vazio) não consulta nada", async () => {
      logar();
      expect((await serie("AB")).json).toEqual({ duplicados: [] });
      expect((await serie("   ")).json).toEqual({ duplicados: [] });
    });

    it("precisa estar logado e poder criar ou editar equipamento", async () => {
      sessao.atual = null;
      expect((await serie("ABC123XYZ")).status).toBe(401);
      logar("e1", permissoesVazias(), "OPERADOR");
      expect((await serie("ABC123XYZ")).status).toBe(403);
    });

    it("é só um aviso: o banco continua aceitando a mesma série em dois equipamentos", async () => {
      await prisma.equipamento.create({ data: { id: "eq6", empresaId: "e1", unidadeId: "un1", tipo: "AR_CONDICIONADO_SPLIT", marca: "LG", modelo: "Condensadora", numeroSerie: "ABC123XYZ" } });
      logar();
      expect((await serie("ABC123XYZ")).json.duplicados).toHaveLength(3);
    });
  });
});
