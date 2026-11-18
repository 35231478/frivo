/**
 * Pausa de SLA por causa do cliente — PR A, pela ROTA real com o Prisma real num PostgreSQL real.
 * Prova, no banco:
 *  - justificar grava motivo, causa, quem e quando — e a causa é a que o gestor mandou;
 *  - o GATILHO AMPLIADO: o chamado que estourou só "comparecer" (ou só "resolver") agora aceita
 *    justificativa; antes a rota recusava com 409;
 *  - sem nada descumprido continua 409; sem a causa, 400 (e nada é gravado);
 *  - alterar troca a causa; desfazer limpa TUDO (inclusive a causa);
 *  - o histórico da OS registra motivo, causa e explicação;
 *  - RBAC: sem "Desempenho › Revisar" é 403; o técnico não entra; outra empresa é 404;
 *  - o desempenho não muda: a métrica continua olhando só a existência da justificativa.
 *
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sla-responsabilidade-pg
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { PRESETS, montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { MSG_ATRASO_NAO_ATRASADA, MSG_ATRASO_SEM_RESPONSAVEL } from "@/lib/os/prazo-execucao";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_sla_resp_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

/** O gestor que revisa o desempenho (é quem justifica) */
const GESTOR = montarPermissoes({ ordens: ["visualizar", "editar"], desempenho: ["visualizar", "revisar"] });
/** Quem vê as OS mas não revisa desempenho */
const SO_OS = montarPermissoes({ ordens: ["visualizar", "editar"] });
const logar = (o: { id?: string; empresaId?: string; role?: string; permissoes?: Permissoes; tecnicoId?: string | null } = {}) => {
  const id = o.id ?? "uGestor";
  sessao.atual = { user: { id, name: id, email: `${id}@x.com`, empresaId: o.empresaId ?? "e1", role: o.role ?? "OPERADOR", permissoes: o.permissoes ?? GESTOR, tecnicoId: o.tecnicoId ?? null } };
};

async function chamar(metodo: "POST" | "DELETE", id: string, corpo?: unknown) {
  const mod = await import("@/app/api/ordens/[id]/atraso-justificado/route");
  const req = new NextRequest("http://localhost/api/x", {
    method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const res: Response = await (mod as any)[metodo](req, { params: Promise.resolve({ id }) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const erro = async (r: Promise<{ status: number; json: any }>) => { const x = await r; return `${x.status} ${x.json?.erro ?? ""}`.trim(); };

vi.setConfig({ testTimeout: 90_000 });
const br = (data: string, hora = "00:00") => new Date(`${data}T${hora}:00-03:00`);
const dia = (data: string) => new Date(`${data}T00:00:00Z`);
const AGORA = br("2026-11-18", "15:00");

describe.skipIf(!URL_PG)("Pausa de SLA — a marcação da causa pela rota (PostgreSQL real)", () => {
  let prisma: any;
  let seq = 0;

  const os = (dados: Record<string, unknown> = {}) => prisma.ordemServico.create({ data: {
    empresaId: "e1", clienteId: "c1", criadoPorId: "uGestor", numero: `OS-${String(++seq).padStart(3, "0")}`,
    descricao: "Split da recepção pingando", status: "CONCLUIDA", ...dados,
  } });
  /** Um chamado com 4 h para comparecer e 24 h para resolver, aberto em `abertoEm` */
  const chamado = (abertoEm: Date, dados: Record<string, unknown> = {}) => os({
    chamadoNumero: `CH-${seq + 1}`, origem: "PORTAL_CLIENTE", chamadoAbertoEm: abertoEm,
    atendimentoComparecerAte: new Date(abertoEm.getTime() + 4 * 3600_000),
    atendimentoResolverAte: new Date(abertoEm.getTime() + 24 * 3600_000),
    ...dados,
  });
  const lido = (id: string) => prisma.ordemServico.findUnique({
    where: { id },
    select: { atrasoJustificadoMotivo: true, atrasoResponsavel: true, atrasoJustificadoObs: true, atrasoJustificadoPorId: true, atrasoJustificadoEm: true },
  });
  const historico = (id: string) => prisma.osHistorico.findMany({ where: { ordemServicoId: id }, orderBy: { criadoEm: "asc" }, select: { acao: true, detalhes: true } });

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    process.env.NEXTAUTH_SECRET ||= "segredo-de-teste-0123456789abcdef";
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uGestor", empresaId: "e1", nome: "Gabi Gestora", email: "g@x.com", senha: "x", role: "ADMIN" },
      { id: "uTec", empresaId: "e1", nome: "João Silva", email: "t@x.com", senha: "x", role: "TECNICO" },
      { id: "uB", empresaId: "e2", nome: "Beto", email: "b@x.com", senha: "x", role: "ADMIN" },
    ] });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital Santa Luzia", cpfCnpj: "11222333000181" },
      { id: "cX", empresaId: "e2", nome: "Cliente da outra", cpfCnpj: "11222333000343" },
    ] });
    await prisma.tecnico.create({ data: { id: "t1", empresaId: "e1", nome: "João Silva", cpf: "11122233344", telefone: "11999990000" } });
    logar();
  }, 180_000);

  afterEach(async () => { logar(); vi.useRealTimers(); await prisma.osHistorico.deleteMany({}); await prisma.ordemServico.deleteMany({}); });

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  const noRelogio = (quando: Date = AGORA) => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(quando); };

  /* ───────── gravar ───────── */

  it("justificar grava motivo, CAUSA, quem e quando — e o histórico conta as três coisas", async () => {
    noRelogio();
    const o = await os({ prazoExecucao: dia("2026-11-10"), dataConclusao: br("2026-11-12", "10:00") });
    const r = await chamar("POST", o.id, { motivo: "ACESSO_NEGADO", responsavel: "CLIENTE", observacao: "Sala trancada, responsável não apareceu" });
    expect(r.status).toBe(200);
    expect(r.json.atrasoResponsavel).toBe("CLIENTE");

    const g = await lido(o.id);
    expect(g.atrasoJustificadoMotivo).toBe("ACESSO_NEGADO");
    expect(g.atrasoResponsavel).toBe("CLIENTE");
    expect(g.atrasoJustificadoObs).toBe("Sala trancada, responsável não apareceu");
    expect(g.atrasoJustificadoPorId).toBe("uGestor");
    expect(new Date(g.atrasoJustificadoEm).toISOString()).toBe(AGORA.toISOString());

    expect(await historico(o.id)).toEqual([{
      acao: "Atraso justificado",
      detalhes: "Acesso ao local negado (Causa do cliente): Sala trancada, responsável não apareceu",
    }]);
  });

  it("a causa é a que o gestor mandou, não a que o motivo sugeriria", async () => {
    const o = await os({ prazoExecucao: dia("2026-11-10"), dataConclusao: br("2026-11-12") });
    // "cliente ausente" sugeriria CLIENTE; o gestor viu que a culpa foi nossa e marcou INTERNA
    await chamar("POST", o.id, { motivo: "CLIENTE_AUSENTE", responsavel: "INTERNA", observacao: "Fomos no horário errado" });
    expect((await lido(o.id)).atrasoResponsavel).toBe("INTERNA");
  });

  /* ───────── o gatilho ampliado ───────── */

  it("o chamado que estourou SÓ o comparecer agora pode ser justificado (antes a rota recusava)", async () => {
    noRelogio();
    const o = await chamado(br("2026-11-10", "08:00"), {
      atendimentoComparecidoEm: br("2026-11-10", "14:00"), dataConclusao: br("2026-11-10", "18:00"),
    });
    const r = await chamar("POST", o.id, { motivo: "ACESSO_NEGADO", responsavel: "CLIENTE" });
    expect(r.status).toBe(200);
    expect((await lido(o.id)).atrasoResponsavel).toBe("CLIENTE");
  });

  it("o chamado que estourou SÓ o resolver também", async () => {
    noRelogio();
    const o = await chamado(br("2026-11-10", "08:00"), {
      atendimentoComparecidoEm: br("2026-11-10", "09:00"), dataConclusao: br("2026-11-12", "09:00"),
    });
    expect((await chamar("POST", o.id, { motivo: "PECA_FALTANDO", responsavel: "INTERNA" })).status).toBe(200);
  });

  it("sem nada descumprido continua 409 — e nada é gravado", async () => {
    noRelogio();
    const tudoCumprido = await chamado(br("2026-11-10", "08:00"), {
      atendimentoComparecidoEm: br("2026-11-10", "09:00"), dataConclusao: br("2026-11-10", "16:00"), prazoExecucao: dia("2026-11-11"),
    });
    expect(await erro(chamar("POST", tudoCumprido.id, { motivo: "CLIMA", responsavel: "TERCEIROS" }))).toBe(`409 ${MSG_ATRASO_NAO_ATRASADA}`);
    expect((await lido(tudoCumprido.id)).atrasoJustificadoMotivo).toBeNull();

    // encerrou sem "Cheguei": ninguém mediu o comparecer, então não é descumprimento
    const semRegistro = await chamado(br("2026-11-10", "08:00"), { dataConclusao: br("2026-11-10", "18:00") });
    expect(await erro(chamar("POST", semRegistro.id, { motivo: "CLIMA", responsavel: "TERCEIROS" }))).toBe(`409 ${MSG_ATRASO_NAO_ATRASADA}`);

    const correndo = await os({ status: "EM_ANDAMENTO", prazoExecucao: dia("2026-11-25"), dataConclusao: null });
    expect(await erro(chamar("POST", correndo.id, { motivo: "CLIMA", responsavel: "TERCEIROS" }))).toBe(`409 ${MSG_ATRASO_NAO_ATRASADA}`);
  });

  /* ───────── validação ───────── */

  it("sem a causa é 400 e nada muda; causa inventada também", async () => {
    const o = await os({ prazoExecucao: dia("2026-11-10"), dataConclusao: br("2026-11-12") });
    expect(await erro(chamar("POST", o.id, { motivo: "CLIMA" }))).toBe(`400 ${MSG_ATRASO_SEM_RESPONSAVEL}`);
    expect(await erro(chamar("POST", o.id, { motivo: "CLIMA", responsavel: "CULPA_DA_CHUVA" }))).toBe(`400 ${MSG_ATRASO_SEM_RESPONSAVEL}`);
    expect((await lido(o.id)).atrasoJustificadoMotivo).toBeNull();
    expect(await historico(o.id)).toEqual([]);
  });

  /* ───────── alterar e desfazer ───────── */

  it("alterar troca a causa (e o histórico guarda as duas passagens); desfazer limpa TUDO", async () => {
    const o = await os({ prazoExecucao: dia("2026-11-10"), dataConclusao: br("2026-11-12") });
    await chamar("POST", o.id, { motivo: "CLIENTE_AUSENTE", responsavel: "CLIENTE" });
    await chamar("POST", o.id, { motivo: "OUTRO", responsavel: "INTERNA", observacao: "Na verdade a equipe remanejou" });
    expect((await lido(o.id)).atrasoResponsavel).toBe("INTERNA");
    expect((await historico(o.id)).map((h: any) => h.acao)).toEqual(["Atraso justificado", "Justificativa do atraso alterada"]);

    const d = await chamar("DELETE", o.id);
    expect(d.status).toBe(200);
    expect(await lido(o.id)).toEqual({
      atrasoJustificadoMotivo: null, atrasoResponsavel: null, atrasoJustificadoObs: null, atrasoJustificadoPorId: null, atrasoJustificadoEm: null,
    });
    expect((await historico(o.id)).at(-1).acao).toBe("Justificativa do atraso desfeita");
    // desfazer de novo não tem o que desfazer
    expect((await chamar("DELETE", o.id)).status).toBe(409);
  });

  /* ───────── quem pode ───────── */

  it("sem \"Desempenho › Revisar\" é 403; o técnico não entra; outra empresa é 404 — e nada é gravado", async () => {
    const o = await os({ prazoExecucao: dia("2026-11-10"), dataConclusao: br("2026-11-12") });

    logar({ permissoes: SO_OS });
    expect((await chamar("POST", o.id, { motivo: "CLIMA", responsavel: "TERCEIROS" })).status).toBe(403);
    expect((await chamar("DELETE", o.id)).status).toBe(403);

    logar({ id: "uTec", role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId: "t1" });
    expect([403, 404]).toContain((await chamar("POST", o.id, { motivo: "CLIMA", responsavel: "TERCEIROS" })).status);

    logar({ id: "uB", empresaId: "e2", role: "ADMIN", permissoes: permissoesTotais() });
    expect((await chamar("POST", o.id, { motivo: "CLIMA", responsavel: "TERCEIROS" })).status).toBe(404);

    expect((await lido(o.id)).atrasoJustificadoMotivo).toBeNull();
  });

  /* ───────── o que NÃO muda ───────── */

  it("a OS continua atrasada e o desempenho continua vendo só a justificativa (a causa não chega lá)", async () => {
    noRelogio();
    const o = await os({ prazoExecucao: dia("2026-11-10"), dataConclusao: br("2026-11-12", "10:00") });
    await chamar("POST", o.id, { motivo: "ACESSO_NEGADO", responsavel: "CLIENTE" });

    const { atrasosDaOs } = await import("@/lib/os/prazo-execucao");
    const depois = await prisma.ordemServico.findUnique({ where: { id: o.id }, select: { status: true, prazoExecucao: true, previsaoConclusao: true, dataConclusao: true } });
    expect(atrasosDaOs(depois, AGORA).os).toBe(true); // a pausa é do papel do cliente, não da operação

    const { atrasoDaAtividade } = await import("@/lib/desempenho/regras");
    const osDoAtraso = await prisma.ordemServico.findUnique({
      where: { id: o.id },
      select: { numero: true, atrasoJustificadoMotivo: true, atrasoJustificadoObs: true, atrasoJustificadoEm: true, atrasoJustificadoPor: { select: { nome: true } } },
    });
    const atraso = atrasoDaAtividade({ concluidaEm: br("2026-11-12"), prazo: dia("2026-11-10"), dataAgendada: null }, osDoAtraso);
    expect(atraso!.justificado).toBe("ACESSO_NEGADO");
    expect(JSON.stringify(atraso)).not.toContain("CLIENTE\""); // a causa não entra na medição
  });
});
