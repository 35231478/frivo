/**
 * Leva I — /ordens pelo PostgreSQL real: o filtro de mês olha a DATA AGENDADA / DE EXECUÇÃO (não a abertura) e as OS
 * sem agendamento aparecem no filtro rápido "Sem agendamento" (com a contagem), para não se perderem.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/leva-i-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_leva_i_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
vi.setConfig({ testTimeout: 60_000 });
const DIA = (m: number, d: number, h = 15) => new Date(Date.UTC(2026, m - 1, d, h));

describe.skipIf(!URL_PG)("Leva I — /ordens pela data agendada (PostgreSQL real)", () => {
  let prisma: any;
  let lista: typeof import("@/lib/os/lista-server");
  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=5`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    lista = await import("@/lib/os/lista-server");
    await prisma.empresa.create({ data: { id: "e1", nome: "Aurora (fictícia)", cnpj: "45.678.912/0001-55", email: "a@x.test" } });
    await prisma.configuracao.create({ data: { empresaId: "e1" } });
    await prisma.usuario.create({ data: { id: "uA", empresaId: "e1", nome: "Ana", email: "ana@x.test", senha: "x", role: "ADMIN" } });
    await prisma.cliente.create({ data: { id: "c1", empresaId: "e1", nome: "Hospital (fictício)", cpfCnpj: "1" } });
    const os = (id: string, criadoEm: Date, extra: Record<string, unknown> = {}) => ({ id, empresaId: "e1", numero: `OS-${id}`, clienteId: "c1", criadoPorId: "uA", descricao: "x", status: "AGENDADA", criadoEm, ...extra });
    await prisma.ordemServico.createMany({ data: [
      os("outNov", DIA(10, 20)),               // aberta em outubro, agendada para novembro
      os("novSemAgenda", DIA(11, 5)),          // aberta em novembro, sem data nenhuma
      os("outExecNov", DIA(10, 1)),            // aberta em outubro, executada (iniciada) em novembro
      os("prevNov", DIA(10, 2), { previsaoConclusao: new Date("2026-11-20T00:00:00Z") }), // só a previsão em novembro
      os("dez", DIA(11, 25)),                  // aberta em novembro, agendada para dezembro
    ] });
    await prisma.atividadeOs.createMany({ data: [
      { id: "a1", empresaId: "e1", ordemServicoId: "outNov", titulo: "Visita", status: "AGENDADA", dataAgendada: DIA(11, 12) },
      { id: "a2", empresaId: "e1", ordemServicoId: "outExecNov", titulo: "Visita", status: "EM_ANDAMENTO", iniciadaEm: DIA(11, 3) },
      { id: "a3", empresaId: "e1", ordemServicoId: "dez", titulo: "Visita", status: "AGENDADA", dataAgendada: DIA(12, 2) },
    ] });
  }, 240_000);
  afterAll(async () => { await prisma?.$disconnect(); execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" }); });

  const ids = (l: { linhas: { id: string }[] }) => l.linhas.map((x) => x.id).sort();
  const agora = DIA(11, 15);

  it("novembro: as agendadas, executadas ou previstas para novembro — não as só abertas nele", async () => {
    expect(ids(await lista.carregarListaOs("e1", { mes: "2026-11" }, agora))).toEqual(["outExecNov", "outNov", "prevNov"]);
    // outubro: nenhuma (abrir em outubro não põe a OS em outubro)
    expect(ids(await lista.carregarListaOs("e1", { mes: "2026-10" }, agora))).toEqual([]);
    expect(ids(await lista.carregarListaOs("e1", { mes: "2026-12" }, agora))).toEqual(["dez"]);
  });

  it("o padrão continua o mês atual; \"Sem agendamento\" mostra e conta a OS sem data (em qualquer período)", async () => {
    const padrao = await lista.carregarListaOs("e1", {}, agora);
    expect(ids(padrao)).toEqual(["outExecNov", "outNov", "prevNov"]);
    expect(padrao.semAgendamento).toBe(1);
    expect(ids(await lista.carregarListaOs("e1", { agenda: "sem" }, agora))).toEqual(["novSemAgenda"]);
    expect(ids(await lista.carregarListaOs("e1", { agenda: "sem", mes: "2026-01" }, agora))).toEqual(["novSemAgenda"]);
    expect(ids(await lista.carregarListaOs("e1", { periodo: "todos" }, agora))).toEqual(["dez", "novSemAgenda", "outExecNov", "outNov", "prevNov"]);
  });
});
