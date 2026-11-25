/**
 * CALENDÁRIO — a gaveta "Editar OS" aberta do cartão, no servidor de verdade (PostgreSQL real):
 *  - o PATCH do reagendar (o mesmo do arrastar) aceita `hora`: dia E hora da visita, no relógio de
 *    Brasília; sem `hora` continua como era (o arrastar não muda);
 *  - hora que não existe é recusada antes de tocar no banco;
 *  - OS pela data prevista também aceita a hora;
 *  - a permissão continua a mesma (ordens › editar) e a outra empresa não enxerga;
 *  - o GET da OS devolve `trava` (por que o registro está fechado) para a gaveta abrir em leitura.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/calendario-gaveta-pg
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { TRAVA_ASSINADA } from "@/lib/edicao-contexto";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_cal_gaveta_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
const como = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1") => {
  sessao.atual = { user: { id: empresaId === "e1" ? "uA" : "uB", name: "Ana", email: "ana@x.com", empresaId, role: "OPERADOR", permissoes, tecnicoId: null } };
};

async function chamar(metodo: "GET" | "PATCH", id: string, corpo?: unknown) {
  const mod = await import("@/app/api/ordens/[id]/route");
  const req = new NextRequest("http://localhost/api/x", { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve({ id }) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

/** 09:00 de Brasília do dia 17/11/2026 (= 12:00Z) */
const NOVE_DO_17 = new Date("2026-11-17T12:00:00.000Z");

describe.skipIf(!URL_PG)("Calendário — a gaveta no servidor: PATCH com hora e a trava no GET (PostgreSQL real)", () => {
  let prisma: any;

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
      { id: "uA", empresaId: "e1", nome: "Ana Souza", email: "ana@x.com", senha: "x" },
      { id: "uB", empresaId: "e2", nome: "Beto", email: "beto@x.com", senha: "x" },
    ] });
    await prisma.cliente.create({ data: { id: "c1", empresaId: "e1", nome: "Hospital Santa Clara", cpfCnpj: "1" } });
    await prisma.tipoOs.create({ data: { id: "t1", empresaId: "e1", nome: "Preventiva" } });
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  /** Uma OS agendada com UMA visita às 09:00 do dia 17 (e outra OS só pela data prevista) */
  let osId: string, atividadeId: string, osPrevistaId: string;
  beforeEach(async () => {
    como();
    await prisma.osHistorico.deleteMany({});
    await prisma.osAceite.deleteMany({});
    await prisma.atividadeOs.deleteMany({});
    await prisma.ordemServico.deleteMany({});
    const os = await prisma.ordemServico.create({ data: {
      empresaId: "e1", numero: "OS-0147", clienteId: "c1", criadoPorId: "uA", status: "AGENDADA", descricao: "Preventiva do chiller",
      atividades: { create: { empresaId: "e1", tipoOsId: "t1", titulo: "Preventiva", dataAgendada: NOVE_DO_17 } },
    }, include: { atividades: true } });
    osId = os.id; atividadeId = os.atividades[0].id;
    osPrevistaId = (await prisma.ordemServico.create({ data: {
      empresaId: "e1", numero: "OS-0148", clienteId: "c1", criadoPorId: "uA", status: "ABERTA", descricao: "Visita a marcar",
      previsaoConclusao: new Date("2026-11-17T00:00:00.000Z"), // só o dia
    } })).id;
  });

  const visita = async () => (await prisma.atividadeOs.findUnique({ where: { id: atividadeId } })).dataAgendada as Date;
  const historico = async (id: string) => (await prisma.osHistorico.findMany({ where: { ordemServicoId: id }, orderBy: { criadoEm: "asc" } })).map((h: any) => h.detalhes);

  it("dia E hora: a visita vai para o instante certo de Brasília, e o histórico diz a hora", async () => {
    const r = await chamar("PATCH", osId, { data: "2026-11-19", hora: "14:30", atividadeId });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect((await visita()).toISOString()).toBe("2026-11-19T17:30:00.000Z"); // 14:30 BRT = 17:30Z
    expect(await historico(osId)).toEqual(["Movida para 19/11/2026 às 14:30"]);
  });

  it("só o dia (o arrastar, como sempre foi): mantém as 09:00 de Brasília", async () => {
    const r = await chamar("PATCH", osId, { data: "2026-11-19", atividadeId });
    expect(r.status).toBe(200);
    expect((await visita()).toISOString()).toBe("2026-11-19T12:00:00.000Z");
    expect(await historico(osId)).toEqual(["Movida para 19/11/2026"]);
  });

  it("hora vazia é o mesmo que não mandar (mantém a que estava)", async () => {
    expect((await chamar("PATCH", osId, { data: "2026-11-19", hora: "", atividadeId })).status).toBe(200);
    expect((await visita()).toISOString()).toBe("2026-11-19T12:00:00.000Z");
  });

  it("hora que não existe é recusada antes de mexer no banco", async () => {
    for (const hora of ["25:00", "12:60", "9:30", "14h30", "abc"]) {
      const r = await chamar("PATCH", osId, { data: "2026-11-19", hora, atividadeId });
      expect(r.status, hora).toBe(400);
      expect(r.json?.erro).toBe("Hora inválida.");
    }
    expect((await visita()).toISOString(), "nada mudou").toBe("2026-11-17T12:00:00.000Z");
    expect(await historico(osId)).toEqual([]);
  });

  it("meia-noite e 23:59 valem (os limites)", async () => {
    expect((await chamar("PATCH", osId, { data: "2026-11-19", hora: "00:00", atividadeId })).status).toBe(200);
    expect((await visita()).toISOString()).toBe("2026-11-19T03:00:00.000Z");
    expect((await chamar("PATCH", osId, { data: "2026-11-19", hora: "23:59", atividadeId })).status).toBe(200);
    expect((await visita()).toISOString()).toBe("2026-11-20T02:59:00.000Z");
  });

  it("OS pela data prevista: com hora, a previsão ganha o instante; sem hora, continua só o dia", async () => {
    expect((await chamar("PATCH", osPrevistaId, { data: "2026-11-20" })).status).toBe(200);
    let os = await prisma.ordemServico.findUnique({ where: { id: osPrevistaId } });
    expect(os.previsaoConclusao.toISOString()).toBe("2026-11-20T00:00:00.000Z");
    expect((await chamar("PATCH", osPrevistaId, { data: "2026-11-20", hora: "08:15" })).status).toBe(200);
    os = await prisma.ordemServico.findUnique({ where: { id: osPrevistaId } });
    expect(os.previsaoConclusao.toISOString()).toBe("2026-11-20T11:15:00.000Z");
  });

  it("a permissão é a mesma de sempre: sem 'ordens › editar' é 403, e nada muda", async () => {
    como(montarPermissoes({ ordens: ["visualizar"] }));
    const r = await chamar("PATCH", osId, { data: "2026-11-19", hora: "14:30", atividadeId });
    expect(r.status).toBe(403);
    expect((await visita()).toISOString()).toBe("2026-11-17T12:00:00.000Z");
  });

  it("a outra empresa não enxerga a OS (404), nem pelo GET nem pelo PATCH", async () => {
    como(permissoesTotais(), "e2");
    expect((await chamar("GET", osId)).status).toBe(404);
    expect((await chamar("PATCH", osId, { data: "2026-11-19", hora: "14:30", atividadeId })).status).toBe(404);
    expect((await visita()).toISOString()).toBe("2026-11-17T12:00:00.000Z");
  });

  it("o GET devolve a trava: null na OS comum; o motivo quando o cliente já assinou", async () => {
    let r = await chamar("GET", osId);
    expect(r.status).toBe(200);
    expect(r.json.trava).toBeNull();
    expect(r.json.numero).toBe("OS-0147");

    await prisma.osAceite.create({ data: { empresaId: "e1", ordemServicoId: osId, token: "tok-1", situacao: "CONFIRMADO" } });
    r = await chamar("GET", osId);
    expect(r.json.trava).toBe(TRAVA_ASSINADA);
  });
});
