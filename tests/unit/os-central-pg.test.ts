/**
 * Central da OS — status AUTOMÁTICO com ajuste manual e prazos, pelas rotas reais com o Prisma real
 * num PostgreSQL real (schema descartável via `prisma db push`). Prova, de ponta a ponta:
 *  - criar OS / agendar / iniciar (pelo app do técnico) / concluir atividade movem o status sozinhos,
 *    com histórico "Status automático" em nome de QUEM causou;
 *  - Concluída só passa pela trava de equipamento; ao concluir sozinha gera os relatórios;
 *  - ajuste manual grava quem/quando, NÃO é sobrescrito pelo automático, e "Voltar ao automático"
 *    recalcula; reabrir uma OS cancelada volta ao automático;
 *  - prazo da atividade grava/valida/limpa e entra no histórico; previsão da OS de contrato;
 *  - isolamento por empresa e permissão (editar/concluir).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/os-central-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextRequest } from "next/server";
import { PRESETS, permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_os_central_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

const logar = (permissoes: Permissoes = permissoesTotais(), id = "u1", empresaId = "e1") => {
  sessao.atual = { user: { id, name: id === "u1" ? "Ana" : "Outro", email: `${id}@x.com`, empresaId, role: "OPERADOR", permissoes, tecnicoId: null } };
};
const comoTecnico = () => {
  sessao.atual = { user: { id: "uT", name: "João", email: "joao@x.com", empresaId: "e1", role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId: "t1" } };
};
const sem = (modulo: string, acao: string) => {
  const p = permissoesTotais() as any;
  p[modulo] = { ...p[modulo], [acao]: false };
  return p as Permissoes;
};

async function chamar(rota: string, metodo: string, params: Record<string, string>, corpo?: unknown) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest("http://localhost/api/x", {
    method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  const tipo = res.headers.get("content-type") ?? "";
  return { status: res.status, json: tipo.includes("json") ? await res.json() : null };
}
const OS = "ordens/[id]";
const ATS = "ordens/[id]/atividades";
const A = "ordens/[id]/atividades/[atividadeId]";
const TUDO_OK = `${A}/execucao/equipamentos/[equipamentoId]/tudo-ok`;

describe.skipIf(!URL_PG)("central da OS: status automático, ajuste manual e prazos (PostgreSQL real)", () => {
  let prisma: any;
  let osId: string, at1: string;

  const statusDe = async (id: string) => prisma.ordemServico.findUnique({ where: { id }, select: { status: true, statusManual: true, dataInicio: true, dataConclusao: true } });
  const historico = async (id: string, acao: string) =>
    (await prisma.osHistorico.findMany({ where: { ordemServicoId: id, acao }, orderBy: { criadoEm: "asc" } })).map((h: any) => [h.usuarioId, h.detalhes]);

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(["ordens", OS, ATS, A, TUDO_OK, "tecnico/sync"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));
    await Promise.all([import("@/lib/relatorio-server"), import("@/lib/os/sincronizar-status")]);
    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "u1", empresaId: "e1", nome: "Ana", email: "a@x.com", senha: "x" },
      { id: "u3", empresaId: "e1", nome: "Carla", email: "c@x.com", senha: "x" },
      { id: "uT", empresaId: "e1", nome: "João", email: "joao@x.com", senha: "x", role: "TECNICO" },
      { id: "u2", empresaId: "e2", nome: "Beto", email: "b@x.com", senha: "x" },
    ] });
    await prisma.tecnico.create({ data: { id: "t1", empresaId: "e1", nome: "João Silva", cpf: "11122233344", telefone: "11999990000" } });
    await prisma.cliente.create({ data: { id: "c1", empresaId: "e1", nome: "Hospital Santa Luzia", cpfCnpj: "11222333000181" } });
    await prisma.unidade.create({ data: { id: "un1", empresaId: "e1", clienteId: "c1", nome: "Matriz" } });
    await prisma.tipoEquipamentoCustom.create({ data: { id: "te1", empresaId: "e1", nome: "Split", chaveEnum: "AR_CONDICIONADO_SPLIT" } });
    await prisma.checklistTipoItem.createMany({ data: [
      { id: "i1", empresaId: "e1", tipoEquipamentoId: "te1", texto: "Limpeza dos filtros", ordem: 0 },
      { id: "i2", empresaId: "e1", tipoEquipamentoId: "te1", texto: "Teste de funcionamento", ordem: 1 },
    ] });
    await prisma.equipamento.create({ data: { id: "eqA", empresaId: "e1", unidadeId: "un1", tipo: "AR_CONDICIONADO_SPLIT", tipoEquipamentoId: "te1", marca: "Daikin", modelo: "FTXS", nome: "Split Sala 1" } });
    logar();
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("OS nova sem data fica Aberta; com a 1ª atividade agendada COM data já nasce Agendada (histórico em nome de quem criou)", async () => {
    logar();
    const r1 = await chamar("ordens", "POST", {}, { clienteId: "c1", unidadeId: "un1", descricao: "Preventiva mensal", execucao: { tecnicoIds: ["t1"], responsavelId: "t1" } });
    expect(r1.status).toBe(201);
    expect(await statusDe(r1.json.id)).toMatchObject({ status: "ABERTA", statusManual: false });
    expect(await historico(r1.json.id, "Status automático")).toEqual([]);

    const r2 = await chamar("ordens", "POST", {}, {
      clienteId: "c1", unidadeId: "un1", descricao: "Corretiva no split", equipamentoIds: ["eqA"],
      execucao: { tecnicoIds: ["t1"], responsavelId: "t1", dataAgendada: "2026-10-30T13:00:00.000Z" },
    });
    osId = r2.json.id;
    at1 = (await prisma.atividadeOs.findFirst({ where: { ordemServicoId: osId } })).id;
    expect(await statusDe(osId)).toMatchObject({ status: "AGENDADA", statusManual: false });
    expect(await historico(osId, "Status automático")).toEqual([["u1", "ABERTA → AGENDADA"]]);
  });

  it("técnico INICIA pelo app → Em execução sozinha, com data de início e histórico em nome do técnico", async () => {
    comoTecnico();
    const r = await chamar("tecnico/sync", "POST", {}, { operacoes: [{ id: randomUUID(), tipo: "iniciar", atividadeId: at1, em: new Date().toISOString() }] });
    expect(r.status).toBe(200);
    expect(r.json.resultados[0]).toMatchObject({ ok: true });
    const s = await statusDe(osId);
    expect(s).toMatchObject({ status: "EM_ANDAMENTO", statusManual: false });
    expect(s.dataInicio).toBeInstanceOf(Date);
    expect((await historico(osId, "Status automático")).at(-1)).toEqual(["uT", "AGENDADA → EM_ANDAMENTO"]);
    logar();
  });

  it("uma 2ª atividade em aberto segura a OS em execução; concluir as duas (trava ok) → Concluída sozinha + relatórios", async () => {
    const nova = await chamar(ATS, "POST", { id: osId }, { titulo: "Retorno", tecnicoIds: ["t1"], responsavelId: "t1", prazo: "2026-11-05" });
    expect(nova.status).toBe(201);
    const at2 = nova.json.id;
    expect(await statusDe(osId)).toMatchObject({ status: "EM_ANDAMENTO" });

    // Trava: a 1ª atividade não conclui sem o checklist do equipamento
    expect((await chamar(A, "PUT", { id: osId, atividadeId: at1 }, { status: "CONCLUIDA" })).status).toBe(422);
    expect((await chamar(TUDO_OK, "POST", { id: osId, atividadeId: at1, equipamentoId: "eqA" })).status).toBe(200);
    expect((await chamar(A, "PUT", { id: osId, atividadeId: at1 }, { status: "CONCLUIDA" })).status).toBe(200);
    expect(await statusDe(osId)).toMatchObject({ status: "EM_ANDAMENTO" }); // ainda falta a 2ª

    // A 2ª é cancelada (não conta): todas as que valem estão concluídas
    expect((await chamar(A, "PUT", { id: osId, atividadeId: at2 }, { status: "CANCELADA" })).status).toBe(200);
    const s = await statusDe(osId);
    expect(s).toMatchObject({ status: "CONCLUIDA", statusManual: false });
    expect(s.dataConclusao).toBeInstanceOf(Date);
    expect((await historico(osId, "Status automático")).at(-1)).toEqual(["u1", "EM_ANDAMENTO → CONCLUIDA"]);
    expect(await prisma.relatorioOs.count({ where: { ordemServicoId: osId } })).toBeGreaterThan(0);
  });

  it("idempotente: sincronizar de novo não grava nada nem duplica histórico", async () => {
    const { sincronizarStatusOs } = await import("@/lib/os/sincronizar-status");
    const antes = (await historico(osId, "Status automático")).length;
    expect(await sincronizarStatusOs(osId, "e1", "u1")).toBe("CONCLUIDA");
    expect(await sincronizarStatusOs(osId, "e2", "u2")).toBeNull(); // de outra empresa: não enxerga
    expect((await historico(osId, "Status automático")).length).toBe(antes);
  });

  it("todas as atividades concluídas mas trava não passa (sem equipamento atendido): fica Em execução, não conclui", async () => {
    const r = await chamar("ordens", "POST", {}, { clienteId: "c1", descricao: "Visita técnica", execucao: { tecnicoIds: ["t1"], responsavelId: "t1" } });
    const at = (await prisma.atividadeOs.findFirst({ where: { ordemServicoId: r.json.id } })).id;
    // atividade concluída "por fora" (dado legado) — a OS não pode virar Concluída sem a trava
    await prisma.atividadeOs.update({ where: { id: at }, data: { status: "CONCLUIDA" } });
    const { sincronizarStatusOs } = await import("@/lib/os/sincronizar-status");
    expect(await sincronizarStatusOs(r.json.id, "e1", "u1")).toBe("EM_ANDAMENTO");
    expect(await statusDe(r.json.id)).toMatchObject({ status: "EM_ANDAMENTO" });
  });

  it("ajuste MANUAL grava quem/quando e o automático NÃO sobrescreve; Voltar ao automático recalcula", async () => {
    const r = await chamar("ordens", "POST", {}, {
      clienteId: "c1", descricao: "Instalação", execucao: { tecnicoIds: ["t1"], responsavelId: "t1", dataAgendada: "2026-11-02T13:00:00.000Z" },
    });
    const id = r.json.id;
    const at = (await prisma.atividadeOs.findFirst({ where: { ordemServicoId: id } })).id;
    expect(await statusDe(id)).toMatchObject({ status: "AGENDADA" });

    logar(permissoesTotais(), "u3");
    const aj = await chamar(OS, "PUT", { id }, { status: "AGUARDANDO_PECA" });
    expect(aj.status).toBe(200);
    expect(aj.json).toMatchObject({ status: "AGUARDANDO_PECA", statusManual: true });
    const [h] = await prisma.osHistorico.findMany({ where: { ordemServicoId: id, acao: "Status ajustado manualmente" } });
    expect([h.usuarioId, h.detalhes]).toEqual(["u3", "AGENDADA → AGUARDANDO_PECA"]);
    expect(h.criadoEm).toBeInstanceOf(Date);

    // O técnico começa: a atividade muda, mas a OS fica no ajuste manual
    comoTecnico();
    await chamar("tecnico/sync", "POST", {}, { operacoes: [{ id: randomUUID(), tipo: "iniciar", atividadeId: at, em: new Date().toISOString() }] });
    expect(await statusDe(id)).toMatchObject({ status: "AGUARDANDO_PECA", statusManual: true });
    expect(await historico(id, "Status automático")).toEqual([["u1", "ABERTA → AGENDADA"]]);

    logar();
    // Trocar à mão para o que os fatos dizem não é exceção: volta (ou segue) no automático
    const confirma = await chamar(OS, "PUT", { id }, { status: "EM_ANDAMENTO" });
    expect(confirma.json).toMatchObject({ status: "EM_ANDAMENTO", statusManual: false });
    expect(await historico(id, "Status alterado")).toEqual([["u1", "AGUARDANDO_PECA → EM_ANDAMENTO"]]);
    await chamar(OS, "PUT", { id }, { status: "AGUARDANDO_PECA" });
    expect(await statusDe(id)).toMatchObject({ status: "AGUARDANDO_PECA", statusManual: true });

    const volta = await chamar(OS, "PUT", { id }, { voltarAutomatico: true });
    expect(volta.status).toBe(200);
    expect(volta.json).toMatchObject({ status: "EM_ANDAMENTO", statusManual: false });
    expect(await historico(id, "Status voltou ao automático")).toEqual([["u1", "Ajuste manual (AGUARDANDO_PECA) desligado"]]);
    expect((await historico(id, "Status automático")).at(-1)).toEqual(["u1", "AGUARDANDO_PECA → EM_ANDAMENTO"]);
  });

  it("ajuste manual para Concluída respeita a trava e a permissão de concluir; editar é exigido", async () => {
    const r = await chamar("ordens", "POST", {}, { clienteId: "c1", descricao: "Limpeza geral", execucao: { tecnicoIds: ["t1"], responsavelId: "t1" } });
    const id = r.json.id;
    logar(sem("ordens", "concluir"));
    expect((await chamar(OS, "PUT", { id }, { status: "CONCLUIDA" })).status).toBe(403);
    logar();
    expect((await chamar(OS, "PUT", { id }, { status: "CONCLUIDA" })).status).toBe(422); // trava
    logar(sem("ordens", "editar"));
    expect((await chamar(OS, "PUT", { id }, { status: "PAUSADA" })).status).toBe(403);
    expect((await chamar(OS, "PUT", { id }, { voltarAutomatico: true })).status).toBe(403);
    logar();
    expect(await statusDe(id)).toMatchObject({ status: "ABERTA", statusManual: false });
    // outra empresa não enxerga a OS
    logar(permissoesTotais(), "u2", "e2");
    expect((await chamar(OS, "PUT", { id }, { voltarAutomatico: true })).status).toBe(404);
    expect((await chamar(OS, "PUT", { id }, { status: "PAUSADA" })).status).toBe(404);
    logar();
  });

  it("reabrir uma OS cancelada volta ao automático (e recalcula pelos fatos); cancelada não volta por voltarAutomatico", async () => {
    const r = await chamar("ordens", "POST", {}, {
      clienteId: "c1", descricao: "Vistoria anual", execucao: { tecnicoIds: ["t1"], responsavelId: "t1", dataAgendada: "2026-11-03T13:00:00.000Z" },
    });
    const id = r.json.id;
    await chamar(OS, "PUT", { id }, { status: "PAUSADA" });
    expect((await chamar(OS, "DELETE", { id }, { motivo: "cliente desistiu" })).status).toBe(200);
    expect((await chamar(OS, "PUT", { id }, { voltarAutomatico: true })).status).toBe(409);
    const re = await chamar(OS, "PUT", { id }, { status: "ABERTA" });
    expect(re.status).toBe(200);
    expect(re.json).toMatchObject({ status: "AGENDADA", statusManual: false }); // tem atividade com data
    expect(await historico(id, "OS reaberta")).toEqual([["u1", "CANCELADA → ABERTA"]]);
  });

  it("prazo da atividade: grava (dia civil), valida, entra no histórico e limpa", async () => {
    const ruim = await chamar(ATS, "POST", { id: osId }, { titulo: "X", tecnicoIds: ["t1"], prazo: "05/11/2026" });
    expect(ruim.status).toBe(400);
    const r = await chamar("ordens", "POST", {}, { clienteId: "c1", descricao: "Troca de compressor", execucao: { tecnicoIds: ["t1"], responsavelId: "t1" } });
    const id = r.json.id;
    const at = (await prisma.atividadeOs.findFirst({ where: { ordemServicoId: id } })).id;

    const p = await chamar(A, "PUT", { id, atividadeId: at }, { prazo: "2026-11-05" });
    expect(p.status).toBe(200);
    const salvo = await prisma.atividadeOs.findUnique({ where: { id: at } });
    expect(salvo.prazo.toISOString()).toBe("2026-11-05T00:00:00.000Z"); // DATE: o dia, sem hora/fuso
    const hist = await prisma.osHistorico.findFirst({ where: { ordemServicoId: id, acao: { contains: "tividade" }, detalhes: { contains: "prazo" } } });
    expect(hist).toBeTruthy();
    expect((await chamar(A, "PUT", { id, atividadeId: at }, { prazo: "2026-13-45x" })).status).toBe(400);
    expect((await chamar(A, "PUT", { id, atividadeId: at }, { prazo: "" })).status).toBe(200);
    expect((await prisma.atividadeOs.findUnique({ where: { id: at } })).prazo).toBeNull();
  });

  it("OS de contrato SEM atividade e com data prevista é Agendada; dado legado Aberta é promovido ao abrir (sync)", async () => {
    const os = await prisma.ordemServico.create({ data: {
      empresaId: "e1", numero: "OS-2026-9001", clienteId: "c1", criadoPorId: "u1", descricao: "Preventiva do contrato",
      status: "ABERTA", previsaoConclusao: new Date("2026-11-10T00:00:00Z"),
    } });
    const { sincronizarStatusOs } = await import("@/lib/os/sincronizar-status");
    expect(await sincronizarStatusOs(os.id, "e1")).toBe("AGENDADA");
    expect(await historico(os.id, "Status automático")).toEqual([["u1", "ABERTA → AGENDADA"]]); // sem usuário: em nome de quem criou
    // tirar a previsão pela tela devolve a Aberta
    const r = await chamar(OS, "PUT", { id: os.id }, { previsaoConclusao: "" });
    expect(r.json).toMatchObject({ status: "ABERTA", statusManual: false });
  });
});
