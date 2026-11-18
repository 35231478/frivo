/**
 * Prazos da OS — PR 1: PRAZO DE EXECUÇÃO separado da DATA PREVISTA, pelas rotas reais com o Prisma
 * real num PostgreSQL real (schema descartável via `prisma db push`). Prova:
 *  - Nova OS: o "Prazo para finalizar" grava `prazoExecucao` (um dia) e NÃO a data prevista; sem nada
 *    digitado, o tipo de OS preenche (dias contados do dia agendado EM BRASÍLIA); o digitado vence o
 *    padrão; sem padrão e sem digitar, fica vazio; data inválida é recusada;
 *  - Editar OS: prazo e data prevista são campos independentes — mexer num não mexe no outro;
 *  - a regra ÚNICA de "atrasada": dashboard, sino e a conta feita OS a OS dão o MESMO resultado, por
 *    dia de Brasília; a OS antiga (só com data prevista) atrasa como sempre; o prazo próprio vence a
 *    data prevista nos dois sentidos; concluída e cancelada não atrasam; outra empresa não entra;
 *  - OS recorrente do contrato e "gerar OS" do relatório: a data prevista é a do agendamento; o prazo
 *    só existe quando o tipo de OS tem padrão.
 *
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/prazos-pr1-pg
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { permissoesTotais } from "@/lib/permissoes";
import { osAtrasada, prazoEfetivo, whereOsAtrasada } from "@/lib/os/prazo-execucao";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_prazos_pr1_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));

const logar = (id = "uA", empresaId = "e1") => {
  sessao.atual = { user: { id, name: "Ana", email: `${id}@x.com`, empresaId, role: "ADMIN", permissoes: permissoesTotais(), tecnicoId: null } };
};

async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest("http://localhost/api/x", {
    method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

vi.setConfig({ testTimeout: 90_000 });
const dia = (chave: string) => new Date(`${chave}T00:00:00.000Z`);
const iso = (d: Date | null) => (d ? d.toISOString() : null);

describe.skipIf(!URL_PG)("Prazos da OS — PR 1: prazo de execução × data prevista (PostgreSQL real)", () => {
  let prisma: any;
  let seq = 0;

  const novaOs = (corpo: Record<string, unknown>, execucao: Record<string, unknown> = {}) => chamar("ordens", "POST", {}, {
    clienteId: "c1", unidadeId: "un1", descricao: "Preventiva mensal", prioridade: "NORMAL", ...corpo,
    execucao: { dataAgendada: null, tecnicoIds: ["t1"], responsavelId: "t1", ...execucao },
  });
  const lerOs = (id: string) => prisma.ordemServico.findUnique({ where: { id } });
  /** OS gravada direto (como as que já existem no banco) */
  const semear = (dados: Record<string, unknown>) => prisma.ordemServico.create({ data: {
    empresaId: "e1", clienteId: "c1", criadoPorId: "uA", numero: `OS-T${String(++seq).padStart(3, "0")}`, descricao: "Serviço", status: "ABERTA", ...dados,
  } });

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana", email: "a@x.com", senha: "x", role: "ADMIN" },
      { id: "uB", empresaId: "e2", nome: "Beto", email: "b@x.com", senha: "x", role: "ADMIN" },
    ] });
    await prisma.tecnico.create({ data: { id: "t1", empresaId: "e1", nome: "João Silva", cpf: "11122233344", telefone: "11999990000" } });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital Santa Luzia", cpfCnpj: "11222333000181" },
      { id: "cX", empresaId: "e2", nome: "Cliente da outra", cpfCnpj: "11222333000343" },
    ] });
    await prisma.unidade.create({ data: { id: "un1", empresaId: "e1", clienteId: "c1", nome: "Matriz" } });
    await prisma.tipoOs.createMany({ data: [
      { id: "tp3", empresaId: "e1", nome: "Corretiva", prazoExecucaoDias: 3 },
      { id: "tp0", empresaId: "e1", nome: "Emergência", prazoExecucaoDias: 0 },
      { id: "tpSem", empresaId: "e1", nome: "Visita técnica" },
    ] });
    // o técnico tem competência nos três tipos (senão a Nova OS recusa o tipo)
    await prisma.tecnico.update({ where: { id: "t1" }, data: { competencias: { connect: [{ id: "tp3" }, { id: "tp0" }, { id: "tpSem" }] } } });
    logar();
  }, 180_000);

  afterEach(() => { vi.useRealTimers(); logar(); });

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  /* ───────── quem grava: Nova OS ───────── */
  it("Nova OS: o prazo digitado grava prazoExecucao (um dia) e NÃO a data prevista", async () => {
    const r = await novaOs({ prazoExecucao: "2026-11-25" }, { dataAgendada: "2026-11-18T17:30:00.000Z" });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    const os = await lerOs(r.json.id);
    expect(iso(os.prazoExecucao)).toBe("2026-11-25T00:00:00.000Z");
    expect(os.previsaoConclusao).toBeNull(); // o prazo deixou de ser gravado no campo da agenda
    // atrasa só DEPOIS do dia do prazo, em Brasília
    expect(osAtrasada(os, new Date("2026-11-25T23:30:00-03:00"))).toBe(false);
    expect(osAtrasada(os, new Date("2026-11-26T00:30:00-03:00"))).toBe(true);
  });

  it("sem prazo digitado, o tipo de OS preenche: dias contados do dia agendado EM BRASÍLIA (0 = o próprio dia)", async () => {
    const tres = await novaOs({}, { tipoOsId: "tp3", dataAgendada: "2026-11-18T17:30:00.000Z" });
    expect(tres.status, JSON.stringify(tres.json)).toBe(201);
    expect(iso((await lerOs(tres.json.id)).prazoExecucao)).toBe("2026-11-21T00:00:00.000Z");

    // 22h30 do dia 18 em Brasília já é dia 19 em UTC: o prazo conta do dia 18
    const noite = await novaOs({ prazoExecucao: "" }, { tipoOsId: "tp0", dataAgendada: "2026-11-19T01:30:00.000Z" });
    expect(iso((await lerOs(noite.json.id)).prazoExecucao)).toBe("2026-11-18T00:00:00.000Z");
  });

  it("o digitado vence o padrão do tipo; tipo sem padrão, sem tipo ou sem dia agendado: a OS nasce sem prazo próprio", async () => {
    const digitado = await novaOs({ prazoExecucao: "2026-12-10" }, { tipoOsId: "tp3", dataAgendada: "2026-11-18T17:30:00.000Z" });
    expect(iso((await lerOs(digitado.json.id)).prazoExecucao)).toBe("2026-12-10T00:00:00.000Z");

    for (const execucao of [
      { tipoOsId: "tpSem", dataAgendada: "2026-11-18T17:30:00.000Z" }, // tipo sem padrão
      { dataAgendada: "2026-11-18T17:30:00.000Z" },                     // sem tipo
      { tipoOsId: "tp3", dataAgendada: null },                          // padrão, mas sem dia de onde contar
    ]) {
      const r = await novaOs({}, execucao);
      expect(r.status, JSON.stringify(r.json)).toBe(201);
      const os = await lerOs(r.json.id);
      expect(os.prazoExecucao, JSON.stringify(execucao)).toBeNull();
      expect(os.previsaoConclusao).toBeNull();
    }
  });

  it("prazo inválido é recusado (400) e nenhuma OS nasce", async () => {
    const antes = await prisma.ordemServico.count();
    for (const prazoExecucao of ["amanhã", "2026-13-45", "2026-02-31", "20/11/2026"]) {
      const r = await novaOs({ prazoExecucao });
      expect(r.status, prazoExecucao).toBe(400);
      expect(r.json.erro).toBe("Prazo para finalizar inválido.");
    }
    expect(await prisma.ordemServico.count()).toBe(antes);
  });

  it("a data prevista continua aceita na criação (calendário, integrações) e não vira prazo", async () => {
    const r = await novaOs({ previsaoConclusao: "2026-11-20" });
    const os = await lerOs(r.json.id);
    expect(iso(os.previsaoConclusao)).toBe("2026-11-20T00:00:00.000Z");
    expect(os.prazoExecucao).toBeNull();
    expect(iso(prazoEfetivo(os))).toBe("2026-11-20T00:00:00.000Z"); // sem prazo próprio, vale o dia previsto
  });

  /* ───────── quem grava: Editar OS ───────── */
  it("Editar OS: prazo e data prevista são independentes; vazio limpa; inválido é 400 e nada muda", async () => {
    const os = await semear({ previsaoConclusao: new Date("2026-11-20T15:00:00.000Z") });
    const editar = (corpo: unknown) => chamar("ordens/[id]", "PUT", { id: os.id }, corpo);

    expect((await editar({ prazoExecucao: "2026-11-27" })).status).toBe(200);
    let agora = await lerOs(os.id);
    expect(iso(agora.prazoExecucao)).toBe("2026-11-27T00:00:00.000Z");
    expect(iso(agora.previsaoConclusao)).toBe("2026-11-20T15:00:00.000Z"); // a agenda não mexeu

    expect((await editar({ previsaoConclusao: "2026-11-22" })).status).toBe(200);
    agora = await lerOs(os.id);
    expect(iso(agora.previsaoConclusao)).toBe("2026-11-22T00:00:00.000Z");
    expect(iso(agora.prazoExecucao)).toBe("2026-11-27T00:00:00.000Z"); // o prazo não mexeu

    const ruim = await editar({ prazoExecucao: "31/02/2026" });
    expect(ruim.status).toBe(400);
    expect(ruim.json.erro).toBe("Prazo para finalizar inválido.");
    expect(iso((await lerOs(os.id)).prazoExecucao)).toBe("2026-11-27T00:00:00.000Z");

    expect((await editar({ descricao: "Outra descrição" })).status).toBe(200); // sem o campo no pedido: fica como está
    expect(iso((await lerOs(os.id)).prazoExecucao)).toBe("2026-11-27T00:00:00.000Z");

    expect((await editar({ prazoExecucao: "" })).status).toBe(200);
    agora = await lerOs(os.id);
    expect(agora.prazoExecucao).toBeNull();
    expect(iso(prazoEfetivo(agora))).toBe("2026-11-22T00:00:00.000Z"); // voltou a valer o dia previsto
  });

  /* ───────── a regra única de "atrasada" ───────── */
  it("ATRASADA é uma regra só: dashboard, sino e a conta OS a OS dão o mesmo, por dia de Brasília", async () => {
    await prisma.ordemServico.deleteMany({});
    // "hoje" = 18/11/2026 em Brasília
    const ontem = dia("2026-11-17"), hoje = dia("2026-11-18"), amanha = dia("2026-11-19");
    const casos: Array<[string, Record<string, unknown>, boolean]> = [
      ["prazo próprio ontem", { prazoExecucao: ontem }, true],
      ["prazo próprio hoje (vence hoje, ainda não atrasou)", { prazoExecucao: hoje }, false],
      ["OS antiga: só a data prevista, ontem com hora", { previsaoConclusao: new Date("2026-11-17T18:00:00.000Z") }, true],
      ["OS antiga: prevista para hoje às 8h — a hora passou, o dia não", { previsaoConclusao: new Date("2026-11-18T11:00:00.000Z") }, false],
      ["prevista ontem, mas com prazo próprio amanhã: o prazo vence a agenda", { previsaoConclusao: new Date("2026-11-17T12:00:00.000Z"), prazoExecucao: amanha }, false],
      ["prevista amanhã, mas com prazo próprio ontem", { previsaoConclusao: new Date("2026-11-19T12:00:00.000Z"), prazoExecucao: ontem }, true],
      ["sem prazo e sem data prevista", {}, false],
      ["concluída com prazo vencido", { prazoExecucao: ontem, status: "CONCLUIDA" }, false],
      ["cancelada com prazo vencido", { previsaoConclusao: new Date("2026-11-10T12:00:00.000Z"), status: "CANCELADA" }, false],
      ["em andamento com prazo vencido", { prazoExecucao: ontem, status: "EM_ANDAMENTO" }, true],
    ];
    const ids = new Map<string, string>();
    for (const [nome, dados] of casos) ids.set(nome, (await semear(dados)).id);
    // outra empresa: atrasada lá, não conta aqui
    await prisma.ordemServico.create({ data: { empresaId: "e2", clienteId: "cX", criadoPorId: "uB", numero: "OS-E2", descricao: "Serviço", status: "ABERTA", prazoExecucao: ontem } });

    const agora = new Date("2026-11-18T15:00:00-03:00");
    const esperadas = casos.filter(([, , atrasada]) => atrasada).map(([nome]) => ids.get(nome)!).sort();

    // 1. o filtro do banco
    const doBanco = (await prisma.ordemServico.findMany({ where: { empresaId: "e1", ...whereOsAtrasada(agora) }, select: { id: true } })).map((o: any) => o.id).sort();
    expect(doBanco).toEqual(esperadas);
    // 2. a mesma regra aplicada OS a OS (o que o calendário e a central da OS usam)
    const todas = await prisma.ordemServico.findMany({ where: { empresaId: "e1" } });
    expect(todas.filter((o: any) => osAtrasada(o, agora)).map((o: any) => o.id).sort()).toEqual(esperadas);
    for (const [nome, , atrasada] of casos) expect(osAtrasada(todas.find((o: any) => o.id === ids.get(nome)), agora), nome).toBe(atrasada);
    // 3. o dashboard
    const { dadosOperacional } = await import("@/lib/dashboard/dados");
    expect((await dadosOperacional("e1", agora)).atrasadas).toBe(esperadas.length);
    expect((await dadosOperacional("e2", agora)).atrasadas).toBe(1);
    // 4. o sino
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(agora);
    const { contarAlertasPrazos } = await import("@/lib/prazo-server");
    expect((await contarAlertasPrazos("e1")).atendimentosAtraso).toBe(esperadas.length);

    // A virada é a meia-noite de BRASÍLIA: às 23h do dia 18 o prazo do dia 18 ainda não atrasou; 1h depois, sim
    const venceHoje = ids.get("prazo próprio hoje (vence hoje, ainda não atrasou)")!;
    const atrasadasEm = async (quando: string) => (await prisma.ordemServico.findMany({ where: { empresaId: "e1", ...whereOsAtrasada(new Date(quando)) }, select: { id: true } })).map((o: any) => o.id);
    expect(await atrasadasEm("2026-11-18T23:00:00-03:00")).not.toContain(venceHoje);
    expect(await atrasadasEm("2026-11-19T00:30:00-03:00")).toContain(venceHoje);
  });

  /* ───────── quem grava: recorrência do contrato ───────── */
  it("OS recorrente do contrato: a data prevista é a do agendamento; o prazo só existe se o tipo de OS tem padrão", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-18T15:00:00-03:00"));
    const rec = await import("@/lib/recorrencia-server");
    const contrato = (numero: string, tipoOsRecorrenciaId: string | null) => prisma.contrato.create({ data: {
      empresaId: "e1", clienteId: "c1", numero, tipo: "MANUTENCAO_PREVENTIVA", status: "ATIVO", dataInicio: new Date("2026-09-01T12:00:00.000Z"),
      recorrencia: true, frequenciaRecorrencia: "MENSAL", diaRecorrencia: 20, tipoOsRecorrenciaId,
    } });
    const comPadrao = await contrato("CT-P1", "tp3");
    const semPadrao = await contrato("CT-P2", "tpSem");
    expect(await rec.gerarOsRecorrentesContrato(comPadrao.id, "uA", 3)).toBe(3);
    expect(await rec.gerarOsRecorrentesContrato(semPadrao.id, "uA", 3)).toBe(3);

    const doContrato = (id: string) => prisma.ordemServico.findMany({ where: { contratoId: id }, orderBy: { previsaoConclusao: "asc" } });
    const a = await doContrato(comPadrao.id);
    expect(a).toHaveLength(3);
    for (const os of a) {
      expect(os.previsaoConclusao).not.toBeNull();
      // prazo = dia previsto + 3
      expect(os.prazoExecucao.getTime() - prazoEfetivo({ previsaoConclusao: os.previsaoConclusao })!.getTime()).toBe(3 * 864e5);
    }
    for (const os of await doContrato(semPadrao.id)) {
      expect(os.previsaoConclusao).not.toBeNull();
      expect(os.prazoExecucao).toBeNull(); // sem padrão: vale o dia previsto, como sempre
    }

    // "Gerar OS" do relatório de contratos (um mês ainda sem OS)
    const g = await chamar("contratos/[id]/gerar-os", "POST", { id: comPadrao.id }, { mes: 6, ano: 2027 });
    expect(g.status, JSON.stringify(g.json)).toBe(201);
    const gerada = await lerOs(g.json.id);
    expect(gerada.prazoExecucao.getTime() - prazoEfetivo({ previsaoConclusao: gerada.previsaoConclusao })!.getTime()).toBe(3 * 864e5);
    const g2 = await chamar("contratos/[id]/gerar-os", "POST", { id: semPadrao.id }, { mes: 6, ano: 2027 });
    expect((await lerOs(g2.json.id)).prazoExecucao).toBeNull();
  });

  it("recorrência POR LOCAL: cada local usa o padrão do tipo de OS dele (ou nenhum)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-18T15:00:00-03:00"));
    const rec = await import("@/lib/recorrencia-server");
    await prisma.unidade.create({ data: { id: "un2", empresaId: "e1", clienteId: "c1", nome: "Anexo" } });
    const ct = await prisma.contrato.create({ data: {
      empresaId: "e1", clienteId: "c1", numero: "CT-L1", tipo: "MANUTENCAO_PREVENTIVA", status: "ATIVO", dataInicio: new Date("2026-09-01T12:00:00.000Z"),
      recorrenciasLocais: { create: [
        { empresaId: "e1", unidadeId: "un1", ativa: true, frequencia: "MENSAL", tipoOsId: "tp0", dataPrimeiraOs: new Date("2026-12-10T12:00:00.000Z") },
        { empresaId: "e1", unidadeId: "un2", ativa: true, frequencia: "MENSAL", tipoOsId: "tpSem", dataPrimeiraOs: new Date("2026-12-10T12:00:00.000Z") },
      ] },
    } });
    expect(await rec.gerarOsRecorrentesLocais(ct.id, "uA", 2)).toBe(4);
    const doLocal = (unidadeId: string) => prisma.ordemServico.findMany({ where: { contratoId: ct.id, unidadeId }, orderBy: { previsaoConclusao: "asc" } });
    // tipo com padrão 0: o prazo é o próprio dia previsto, gravado como prazo próprio
    for (const os of await doLocal("un1")) expect(iso(os.prazoExecucao)).toBe(iso(prazoEfetivo({ previsaoConclusao: os.previsaoConclusao })));
    expect((await doLocal("un1")).length).toBe(2);
    // tipo sem padrão: sem prazo próprio
    expect((await doLocal("un2")).map((o: any) => o.prazoExecucao)).toEqual([null, null]);
  });
});
