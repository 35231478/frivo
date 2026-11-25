/**
 * SOLICITAÇÕES — o contador (GET /api/solicitacoes/contador) contra PostgreSQL real:
 *  - conta só o que é solicitação pendente (portal/QR em AGUARDANDO_ATENDIMENTO) e dá a mais recente;
 *  - sem pendência: 0 e null;
 *  - a permissão é a da gaveta (ordens › editar OU excluir); sem as duas, 403;
 *  - a outra empresa vê zero; e a resposta não é cacheada.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/solicitacoes-contador-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_sol_contador_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
const como = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1") => {
  sessao.atual = { user: { id: empresaId === "e1" ? "uA" : "uB", name: "Ana", email: "ana@x.com", empresaId, role: "OPERADOR", permissoes, tecnicoId: null } };
};
async function contador() {
  const mod = await import("@/app/api/solicitacoes/contador/route");
  const res: Response = await mod.GET();
  return { status: res.status, json: await res.json().catch(() => null), cache: res.headers.get("cache-control") };
}

describe.skipIf(!URL_PG)("Solicitações — o contador (PostgreSQL real)", () => {
  let prisma: any;
  const os = (id: string, extra: Record<string, unknown>) => ({ id, empresaId: "e1", numero: id, clienteId: "c1", criadoPorId: "uA", descricao: "x", ...extra });

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    process.env.NEXTAUTH_SECRET ||= "segredo-de-teste-0123456789abcdef";
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana", email: "ana@x.com", senha: "x" },
      { id: "uB", empresaId: "e2", nome: "Beto", email: "beto@x.com", senha: "x" },
    ] });
    await prisma.cliente.create({ data: { id: "c1", empresaId: "e1", nome: "Hospital", cpfCnpj: "1" } });
    await prisma.ordemServico.createMany({ data: [
      // as duas solicitações pendentes (portal e QR gravam assim), em horas diferentes
      os("S-antiga", { origem: "PORTAL_CLIENTE", status: "AGUARDANDO_ATENDIMENTO", criadoEm: new Date("2026-11-25T12:00:00.000Z") }),
      os("S-nova", { origem: "PORTAL_CLIENTE", status: "AGUARDANDO_ATENDIMENTO", criadoEm: new Date("2026-11-25T12:05:00.000Z") }),
      // já aceita: virou AGENDADA, não é mais pendência
      os("S-aceita", { origem: "PORTAL_CLIENTE", status: "AGENDADA", criadoEm: new Date("2026-11-25T12:30:00.000Z") }),
      // OS manual que por acaso está aguardando: não é solicitação de cliente
      os("M-aguardando", { origem: "MANUAL", status: "AGUARDANDO_ATENDIMENTO", criadoEm: new Date("2026-11-25T12:40:00.000Z") }),
    ] });
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("conta só as solicitações pendentes e dá a mais recente delas (não a OS aceita, nem a manual)", async () => {
    como();
    const r = await contador();
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ total: 2, maisRecenteEm: "2026-11-25T12:05:00.000Z" });
    expect(r.cache).toContain("no-store");
  });

  it("a permissão é a da gaveta: editar OU excluir basta; sem as duas, 403", async () => {
    como(montarPermissoes({ ordens: ["visualizar", "excluir"] }));
    expect((await contador()).status).toBe(200);
    como(montarPermissoes({ ordens: ["visualizar", "editar"] }));
    expect((await contador()).status).toBe(200);
    como(montarPermissoes({ ordens: ["visualizar"] }));
    expect((await contador()).status).toBe(403);
  });

  it("a outra empresa não vê nada: 0 e null", async () => {
    como(permissoesTotais(), "e2");
    expect((await contador()).json).toEqual({ total: 0, maisRecenteEm: null });
  });
});
