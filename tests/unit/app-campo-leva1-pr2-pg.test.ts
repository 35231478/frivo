/**
 * App de campo, leva 1 (PR 2) — rotas reais, Prisma real, PostgreSQL real:
 *  - o início da atividade fica gravado (hora do toque no aparelho); reabrir pelo escritório recomeça;
 *  - concluir com término informado: vale se ficou entre o início e o toque; fica no histórico; fora disso, 422;
 *  - o retrato e o Meu dia levam o limite da empresa, a jornada e a última gravação; o WhatsApp do topo só com
 *    "Exibir contatos do cliente"; o cartão leva o início e o dado de escritório;
 *  - o sino do gestor conta as esquecidas (limite, outro dia, atividade antiga sem início); nunca para o técnico;
 *  - o limite é configurável por empresa (1 a 24 h) em Equipes › App do colaborador.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/app-campo-leva1-pr2-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextRequest } from "next/server";
import { PRESETS, montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { inicioHojeBR } from "@/lib/fuso";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_app_campo_l1b_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
vi.setConfig({ testTimeout: 60_000 });

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
const comoTecnico = () => { sessao.atual = { user: { id: "uT", name: "João", email: "joao@clima.com", empresaId: "e1", role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId: "t1" } }; };
const comoEscritorio = (permissoes: Permissoes = permissoesTotais()) => {
  sessao.atual = { user: { id: "uA", name: "Ana", email: "ana@clima.com", empresaId: "e1", role: "OPERADOR", permissoes, tecnicoId: null } };
};
async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest("http://localhost/api/x", { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const op = (tipo: string, atividadeId: string, extra: Record<string, unknown> = {}) => ({ id: randomUUID(), tipo, atividadeId, em: new Date().toISOString(), ...extra });
const sync = async (operacoes: unknown[], agora?: string) => (await chamar("tecnico/sync", "POST", {}, { operacoes, ...(agora && { agora }) })).json.resultados as any[];
const H = 3_600_000;

describe.skipIf(!URL_PG)("app de campo, leva 1 (PR 2): atividade esquecida e topo da OS (PostgreSQL real)", () => {
  let prisma: any;
  const hoje = inicioHojeBR();
  const atividade = (id: string) => prisma.atividadeOs.findUnique({ where: { id } });
  const sino = async () => (await chamar("alertas", "GET")).json;

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(["tecnico/sync", "tecnico/atividades/[atividadeId]", "tecnico/meu-dia", "alertas", "configuracoes", "ordens/[id]/atividades/[atividadeId]"]
      .map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));
    await prisma.empresa.create({ data: { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" } });
    await prisma.configuracao.create({ data: { empresaId: "e1" } });
    await prisma.usuario.createMany({ data: [
      { id: "uT", empresaId: "e1", nome: "João", email: "joao@clima.com", senha: "x", role: "TECNICO" },
      { id: "uA", empresaId: "e1", nome: "Ana Escritório", email: "ana@clima.com", senha: "x", role: "ADMIN" },
    ] });
    await prisma.tecnico.create({ data: { id: "t1", empresaId: "e1", nome: "João Silva", cpf: "1", telefone: "1", email: "joao@clima.com" } });
    await prisma.cliente.create({ data: { id: "c1", empresaId: "e1", nome: "Hospital Santa Luzia LTDA", nomeFantasia: "Hospital Santa Luzia", cpfCnpj: "1", celular: "(11) 96666-5555", telefone: "1133334444" } });
    await prisma.unidade.create({ data: { id: "un1", empresaId: "e1", clienteId: "c1", nome: "Matriz" } });
    const os = (id: string, numero: string, extra: Record<string, unknown> = {}) => ({ id, empresaId: "e1", numero, clienteId: "c1", unidadeId: "un1", criadoPorId: "uA", descricao: "Ar pingando na recepção", origem: "PORTAL_CLIENTE", ...extra });
    await prisma.ordemServico.createMany({ data: [os("osA", "OS-1"), os("osB", "OS-2"), os("osC", "OS-3"), os("osD", "OS-4")] });
    // Tipo que não exige equipamento: concluir sem trava de checklist
    await prisma.tipoOs.create({ data: { id: "tVis", empresaId: "e1", nome: "Visita técnica", exigeEquipamento: false } });
    const at = (id: string, ordemServicoId: string, dataAgendada: Date, status = "AGENDADA", extra: Record<string, unknown> = {}) =>
      ({ id, empresaId: "e1", ordemServicoId, titulo: "Visita", tipoOsId: "tVis", tecnicoId: "t1", dataAgendada, status, ...extra });
    await prisma.atividadeOs.createMany({ data: [
      at("aA", "osA", new Date(hoje.getTime() + 9 * H)),
      at("aB", "osB", new Date(hoje.getTime() + 10 * H)),
      // Antigas (antes da coluna nova): em andamento SEM início gravado
      at("aVelhaOntem", "osC", new Date(hoje.getTime() - 20 * H), "EM_ANDAMENTO"),
      at("aVelhaAgora", "osD", new Date(Date.now() - 30 * 60_000), "EM_ANDAMENTO"),
    ] });
  }, 180_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("iniciar grava o início pela hora do TOQUE (mesmo que a fila chegue depois)", async () => {
    comoTecnico();
    const toque = new Date(Date.now() - 5 * H).toISOString();
    await sync([{ ...op("iniciar", "aA"), em: toque }], new Date().toISOString());
    const a = await atividade("aA");
    expect(a.status).toBe("EM_ANDAMENTO");
    // A hora do toque, corrigida pelo relógio do servidor (o aparelho mandou o "agora" dele junto): milissegundos
    expect(Math.abs(a.iniciadaEm.getTime() - Date.parse(toque))).toBeLessThan(2000);
    expect(Date.now() - a.iniciadaEm.getTime()).toBeGreaterThan(4.9 * H);
  });

  it("retrato e Meu dia: limite da empresa, jornada, última gravação, início no cartão e dado de escritório", async () => {
    comoTecnico();
    await prisma.servicoAdicional.create({ data: { empresaId: "e1", atividadeId: "aA", ordemServicoId: "osA", descricao: "Extra", criadoEm: new Date(Date.now() - 2 * H) } });
    const r = (await chamar("tecnico/atividades/[atividadeId]", "GET", { atividadeId: "aA" })).json;
    expect(r.andamento.limiteHoras).toBe(4);
    expect(r.andamento.jornada).toHaveLength(7);
    expect(new Date(r.andamento.ultimaGravacaoEm).getTime()).toBeCloseTo(Date.now() - 2 * H, -4);
    expect(r.cartao).toMatchObject({ iniciadaEm: (await atividade("aA")).iniciadaEm.toISOString(), criadoPor: "Ana Escritório", origem: "PORTAL_CLIENTE" });
    expect(r.whatsapp).toBe("(11) 96666-5555");
    const d = (await chamar("tecnico/meu-dia", "GET")).json;
    expect(d.andamento).toMatchObject({ limiteHoras: 4 });
    // Atividade antiga em andamento (sem a coluna): o cartão usa a hora agendada
    const velha = [...d.atividades, ...d.anteriores].find((c: any) => c.atividadeId === "aVelhaOntem");
    expect(velha.iniciadaEm).toBe((await atividade("aVelhaOntem")).dataAgendada.toISOString());
    // Agendada não começou: sem início
    expect([...d.atividades, ...d.anteriores].find((c: any) => c.atividadeId === "aB").iniciadaEm).toBeNull();
  });

  it("privacidade: sem 'Exibir contatos do cliente', o WhatsApp nem sai do servidor; limite da empresa vale no retrato", async () => {
    await prisma.configuracao.update({ where: { empresaId: "e1" }, data: { appExibirContatosCliente: false, appAlertaAndamentoHoras: 6 } });
    comoTecnico();
    const r = (await chamar("tecnico/atividades/[atividadeId]", "GET", { atividadeId: "aA" })).json;
    expect(r.whatsapp).toBeNull();
    expect(r.cartao.telefone).toBeNull();
    expect(r.andamento.limiteHoras).toBe(6);
    await prisma.configuracao.update({ where: { empresaId: "e1" }, data: { appExibirContatosCliente: true, appAlertaAndamentoHoras: 4 } });
  });

  it("sino do gestor: passou do limite, começou ontem e antiga sem início contam; recente não; técnico nunca recebe", async () => {
    comoEscritorio();
    let s = await sino();
    // aA (5 h > 4 h) e aVelhaOntem (ontem, pela hora agendada); aVelhaAgora (30 min) não
    expect(s.atividadesEsquecidas).toBe(2);
    expect(s.atividadeEsquecidaOsId).toBe("osC"); // a mais antiga
    await prisma.configuracao.update({ where: { empresaId: "e1" }, data: { appAlertaAndamentoHoras: 8 } });
    s = await sino();
    expect(s.atividadesEsquecidas).toBe(1); // só a de ontem: aA tem 5 h < 8 h
    await prisma.configuracao.update({ where: { empresaId: "e1" }, data: { appAlertaAndamentoHoras: 4 } });
    comoEscritorio(montarPermissoes({ financeiro: ["contasReceber"] } as never));
    expect((await sino()).atividadesEsquecidas).toBe(0);
    comoTecnico();
    expect((await sino()).atividadesEsquecidas).toBe(0);
  });

  it("concluir com término informado (entre o início e o toque): vale como data da conclusão e fica no histórico", async () => {
    comoTecnico();
    const a = await atividade("aA");
    const termino = new Date(a.iniciadaEm.getTime() + 90 * 60_000).toISOString();
    const [r] = await sync([op("concluir", "aA", { dados: { terminoEm: termino } })]);
    expect(r).toMatchObject({ ok: true });
    const depois = await atividade("aA");
    expect(depois.status).toBe("CONCLUIDA");
    expect(depois.concluidaEm.toISOString()).toBe(termino);
    const h = await prisma.osHistorico.findFirst({ where: { ordemServicoId: "osA", acao: "Horário de término informado" } });
    expect(h).toMatchObject({ usuarioId: "uT", detalhes: expect.stringMatching(/^"Visita": Término informado pelo técnico: \d\d:\d\d \(concluída no app às \d\d:\d\d\)$/) });
    // Sem esquecida agora: o sino deixa de contar a aA
    comoEscritorio();
    expect((await sino()).atividadesEsquecidas).toBe(1);
  });

  it("término fora do intervalo (antes do início ou depois do toque): 422 e a atividade continua aberta", async () => {
    comoTecnico();
    await sync([op("iniciar", "aB")]);
    const ini = (await atividade("aB")).iniciadaEm.getTime();
    const [antes] = await sync([op("concluir", "aB", { dados: { terminoEm: new Date(ini - 60_000).toISOString() } })]);
    expect(antes).toMatchObject({ ok: false, status: 422, erro: "O horário de término precisa ficar entre o início da atividade e agora." });
    const [depois] = await sync([op("concluir", "aB", { dados: { terminoEm: new Date(Date.now() + 10 * 60_000).toISOString() } })]);
    expect(depois.status).toBe(422);
    expect((await atividade("aB")).status).toBe("EM_ANDAMENTO");
    // Formato inválido: barrado na validação
    expect((await sync([op("concluir", "aB", { dados: { terminoEm: "ontem" } })]))[0].status).toBe(400);
    // Sem término: como antes (vale a hora do toque)
    const [ok] = await sync([op("concluir", "aB", { dados: {} })]);
    expect(ok.ok).toBe(true);
    expect(Math.abs((await atividade("aB")).concluidaEm.getTime() - Date.now())).toBeLessThan(60_000);
    expect(await prisma.osHistorico.count({ where: { ordemServicoId: "osB", acao: "Horário de término informado" } })).toBe(0);
  });

  it("reabrir pelo escritório recomeça o início (não acusa esquecida pela execução anterior)", async () => {
    comoEscritorio();
    const r = await chamar("ordens/[id]/atividades/[atividadeId]", "PUT", { id: "osA", atividadeId: "aA" }, { status: "EM_ANDAMENTO" });
    expect(r.status).toBe(200);
    const a = await atividade("aA");
    expect(Math.abs(a.iniciadaEm.getTime() - Date.now())).toBeLessThan(60_000);
    expect(a.concluidaEm).toBeNull();
    expect((await sino()).atividadesEsquecidas).toBe(1); // continua só a de ontem
  });

  it("limite por empresa: 1 a 24 h pelo PUT de configurações", async () => {
    comoEscritorio();
    expect((await chamar("configuracoes", "PUT", {}, { appAlertaAndamentoHoras: 6 })).status).toBe(200);
    expect((await prisma.configuracao.findUnique({ where: { empresaId: "e1" } })).appAlertaAndamentoHoras).toBe(6);
    for (const v of [0, 25, 2.5, "6"]) expect((await chamar("configuracoes", "PUT", {}, { appAlertaAndamentoHoras: v })).status, String(v)).toBe(400);
    expect((await prisma.configuracao.findUnique({ where: { empresaId: "e1" } })).appAlertaAndamentoHoras).toBe(6);
  });
});
