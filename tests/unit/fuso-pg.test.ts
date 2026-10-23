/**
 * Fuso de Brasília no SERVIDOR (que roda em UTC), pelas rotas e funções reais num PostgreSQL real:
 *  - arrastar no calendário mantém a hora de Brasília da visita (14h continua 14h) e a previsão
 *    só de dia continua dia; aceitar chamado "para 14h" grava 14h de Brasília (não 11h);
 *  - nova atividade pela aba grava o instante que a tela mandou;
 *  - contas: ATRASADO/VENCIDO só depois do dia de Brasília (às 21h30 do vencimento ainda não);
 *    cliente não fica INADIMPLENTE às 21h; dashboard não põe a conta de hoje em "Vencidos";
 *  - calendário: a visita das 22h aparece no dia certo e às 22:00.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/fuso-pg
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { permissoesTotais } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_fuso_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

async function chamar(rota: string, metodo: string, params: Record<string, string>, corpo?: unknown) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest("http://localhost/api/x", {
    method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const H = (iso: string) => new Date(iso);

describe.skipIf(!URL_PG)("fuso de Brasília no servidor (PostgreSQL real)", () => {
  let prisma: any;

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(["ordens/[id]", "ordens/[id]/atividades", "solicitacoes/[id]/aceitar"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));
    await Promise.all([import("@/lib/financeiro-server"), import("@/lib/status-financeiro"), import("@/lib/dashboard/dados")]);
    await prisma.empresa.create({ data: { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" } });
    await prisma.usuario.create({ data: { id: "u1", empresaId: "e1", nome: "Ana", email: "a@x.com", senha: "x" } });
    await prisma.tecnico.create({ data: { id: "t1", empresaId: "e1", nome: "João Silva", cpf: "11122233344", telefone: "11999990000" } });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital Santa Luzia", cpfCnpj: "11222333000181" },
      { id: "c2", empresaId: "e1", nome: "Padaria", cpfCnpj: "22333444000190" },
    ] });
    sessao.atual = { user: { id: "u1", name: "Ana", email: "a@x.com", empresaId: "e1", role: "OPERADOR", permissoes: permissoesTotais() } };
  }, 120_000);

  afterEach(() => { vi.useRealTimers(); });
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("arrastar no calendário: a visita das 14h (Brasília) continua 14h no novo dia; previsão só de dia continua dia", async () => {
    await prisma.ordemServico.create({ data: { id: "os1", empresaId: "e1", numero: "OS-1", clienteId: "c1", criadoPorId: "u1", descricao: "Preventiva", status: "AGENDADA", previsaoConclusao: H("2026-10-30T00:00:00Z") } });
    await prisma.atividadeOs.create({ data: { id: "a1", empresaId: "e1", ordemServicoId: "os1", titulo: "Visita", status: "AGENDADA", tecnicoId: "t1", dataAgendada: H("2026-10-30T17:00:00Z") } });
    await prisma.atividadeOs.create({ data: { id: "a2", empresaId: "e1", ordemServicoId: "os1", titulo: "Noturna", status: "AGENDADA", tecnicoId: "t1", dataAgendada: H("2026-10-31T01:00:00Z") } }); // 22h de 30/10
    expect((await chamar("ordens/[id]", "PATCH", { id: "os1" }, { data: "2026-11-02", atividadeId: "a1" })).status).toBe(200);
    expect((await prisma.atividadeOs.findUnique({ where: { id: "a1" } })).dataAgendada.toISOString()).toBe("2026-11-02T17:00:00.000Z");
    // A das 22h de Brasília (01h UTC do dia seguinte) vai para o dia escolhido às 22h — não para o anterior
    expect((await chamar("ordens/[id]", "PATCH", { id: "os1" }, { data: "2026-11-03", atividadeId: "a2" })).status).toBe(200);
    expect((await prisma.atividadeOs.findUnique({ where: { id: "a2" } })).dataAgendada.toISOString()).toBe("2026-11-04T01:00:00.000Z");
    // Sem atividade: move a previsão (dia civil)
    expect((await chamar("ordens/[id]", "PATCH", { id: "os1" }, { data: "2026-11-05" })).status).toBe(200);
    expect((await prisma.ordemServico.findUnique({ where: { id: "os1" } })).previsaoConclusao.toISOString()).toBe("2026-11-05T00:00:00.000Z");
  });

  it("calendário: a visita das 22h de Brasília fica no dia certo e às 22:00", async () => {
    const { gridCalendario, posicaoNoCalendario } = await import("@/lib/calendario/grid");
    const a2 = await prisma.atividadeOs.findUnique({ where: { id: "a2" } });
    expect(posicaoNoCalendario(a2.dataAgendada, true)).toEqual({ chave: "2026-11-03", hora: "22:00" });
    const os = await prisma.ordemServico.findUnique({ where: { id: "os1" } });
    expect(posicaoNoCalendario(os.previsaoConclusao, false)).toEqual({ chave: "2026-11-05", hora: null });
    const g = gridCalendario({ ano: 2026, mes: 11, view: "mensal", dia: 1 });
    expect(g.dias).toHaveLength(42);
    expect(g.dias[0].toISOString()).toBe("2026-11-01T00:00:00.000Z"); // 01/11/2026 é domingo
    expect(g.periodo.gte.toISOString()).toBe("2026-11-01T03:00:00.000Z");
    expect(g.periodo.lte.toISOString()).toBe("2026-12-13T02:59:59.999Z");
    expect(g.chaves.has("2026-11-03")).toBe(true);
    // a busca do calendário acha a atividade pelo intervalo de Brasília
    expect(await prisma.atividadeOs.count({ where: { id: "a2", dataAgendada: g.periodo } })).toBe(1);
    const semana = gridCalendario({ ano: 2026, mes: 11, view: "semanal", dia: 4 });
    expect(semana.dias.map((d: Date) => d.toISOString().slice(0, 10))).toEqual(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"]);
  });

  it("nova atividade pela aba grava o instante que a tela mandou (14h de Brasília = 17h UTC)", async () => {
    const r = await chamar("ordens/[id]/atividades", "POST", { id: "os1" }, { titulo: "Retorno", tecnicoIds: ["t1"], responsavelId: "t1", dataAgendada: "2026-11-06T17:00:00.000Z" });
    expect(r.status).toBe(201);
    expect((await prisma.atividadeOs.findUnique({ where: { id: r.json.id } })).dataAgendada.toISOString()).toBe("2026-11-06T17:00:00.000Z");
  });

  it("aceitar chamado 'para 14h' grava 14h de Brasília (antes ficava 11h)", async () => {
    await prisma.ordemServico.create({ data: { id: "sol1", empresaId: "e1", numero: "OS-2", clienteId: "c1", criadoPorId: "u1", descricao: "Ar pingando", origem: "PORTAL_CLIENTE", status: "AGUARDANDO_ATENDIMENTO" } });
    const r = await chamar("solicitacoes/[id]/aceitar", "POST", { id: "sol1" }, { dataHora: "2026-11-03T14:00", descricao: "Ar pingando na sala", tecnicoIds: ["t1"], responsavelId: "t1" });
    expect(r.status).toBe(200);
    const at = await prisma.atividadeOs.findFirst({ where: { ordemServicoId: "sol1" } });
    expect(at.dataAgendada.toISOString()).toBe("2026-11-03T17:00:00.000Z");
    const h = await prisma.osHistorico.findFirst({ where: { ordemServicoId: "sol1", acao: "Solicitação aceita" } });
    expect(h.detalhes).toContain("03/11/2026 às 14:00");
  });

  it("contas: às 21h30 do vencimento ainda NÃO vira atrasada; à 00h30 vira; cliente não fica inadimplente às 21h", async () => {
    await prisma.contaReceber.create({ data: { id: "cr1", empresaId: "e1", clienteId: "c2", numero: "CR-1", descricao: "Mensalidade", valor: 100, dataVencimento: H("2026-10-28T00:00:00Z"), status: "A_RECEBER" } });
    await prisma.contaPagar.create({ data: { id: "cp1", empresaId: "e1", numero: "CP-1", descricao: "Peças", fornecedor: "Refrigeração Sul", valorTotal: 50, valorPago: 0, saldoRestante: 50, dataVencimento: H("2026-10-28T00:00:00Z"), status: "PENDENTE" } });
    const { marcarContasReceberVencidas, resumoFinanceiro } = await import("@/lib/financeiro-server");
    const { calcularStatusFinanceiro } = await import("@/lib/status-financeiro");
    const { dadosFinanceiro } = await import("@/lib/dashboard/dados");

    vi.useFakeTimers({ toFake: ["Date"], now: H("2026-10-29T00:30:00Z") }); // 21h30 de 28/10 em Brasília
    await marcarContasReceberVencidas("e1");
    expect((await prisma.contaReceber.findUnique({ where: { id: "cr1" } })).status).toBe("A_RECEBER");
    expect(await calcularStatusFinanceiro("c2", "e1")).toBe("ADIMPLENTE");
    const fin = await dadosFinanceiro("e1", new Date());
    expect(fin.vencidos.quantidade).toBe(0); // a de hoje não é "vencida"
    expect(fin.proximos7.quantidade).toBe(1);
    const resumo = await resumoFinanceiro("e1");
    expect((await prisma.contaPagar.findUnique({ where: { id: "cp1" } })).status).toBe("PENDENTE");
    expect(resumo.alertas).toMatchObject({ vencemHojeReceber: 1, vencemHojePagar: 1 }); // "vence hoje" no próprio dia

    vi.setSystemTime(H("2026-10-29T03:30:00Z")); // 00h30 de 29/10
    await marcarContasReceberVencidas("e1");
    expect((await prisma.contaReceber.findUnique({ where: { id: "cr1" } })).status).toBe("ATRASADO");
    expect(await calcularStatusFinanceiro("c2", "e1")).toBe("INADIMPLENTE");
    await resumoFinanceiro("e1");
    expect((await prisma.contaPagar.findUnique({ where: { id: "cp1" } })).status).toBe("VENCIDO");
  });
});
