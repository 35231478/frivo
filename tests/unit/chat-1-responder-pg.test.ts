/**
 * CHAT-1 — RESPONDER uma mensagem, no PostgreSQL REAL e pelas rotas reais (dados fictícios):
 *  - o técnico responde pela fila do app (com e sem OS); reenviar não duplica; sem sinal, responde a uma mensagem que
 *    ainda está na fila (pelo clientId) e as duas sobem no mesmo lote, a citada antes;
 *  - permissão: só cita o que pode ver, na mesma conversa/OS — a OS de outro técnico, a conversa de outra pessoa,
 *    "Ver só os próprios" e outra empresa ficam de fora (404, nada gravado); pela OS, só mensagem da mesma OS;
 *  - quem lê vê a citação; quem não pode ver a original vê "Mensagem indisponível" (o conteúdo não sai do servidor);
 *  - ir até uma citada antiga: ?ate= traz a conversa desde ela (só se ela é da conversa).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/chat-1-responder-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextRequest } from "next/server";
import { PRESETS, permissoesTotais } from "@/lib/permissoes";
import { MSG_CITADA_NAO_ENCONTRADA, ROTULO_CITACAO_INDISPONIVEL } from "@/lib/chat/regras";
import { SEM_OS } from "@/lib/tecnico/despesas";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_chat1r_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
vi.setConfig({ testTimeout: 60_000 });

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
vi.mock("@/lib/push/servidor", async (orig) => ({
  ...(await orig<typeof import("@/lib/push/servidor")>()),
  usuariosComAparelho: vi.fn(async () => []),
  enviarPush: vi.fn(async () => ({ enviados: 0 })),
}));

const TOTAIS = permissoesTotais();
const user = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, email: `${id}@clima.test`, empresaId: "e1", role: "ADMIN", permissoes: TOTAIS, tecnicoId: null, ...extra });
const como = (u: Record<string, unknown>) => { sessao.atual = { user: u }; };
const comoAdmin = () => como(user("uA"));
const comoTecnico = (id = "uT", tecnicoId = "t1", email = "joao@clima.test") => como({ id, name: id, email, empresaId: "e1", role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId });
// "Ver só os próprios" (COM-1), com "Conversas": vê a conversa da pessoa, mas só as OS que criou
const comoVera = () => como(user("uV", { role: "OPERADOR", permissoes: { ...TOTAIS, ordens: { ...TOTAIS.ordens, verSoProprios: true } } }));
const comoOutraEmpresa = () => como(user("uX", { empresaId: "e2" }));

async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown, qs = "") {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`http://localhost/api/x${qs}`, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const sync = async (operacoes: unknown[]) => { comoTecnico(); return (await chamar("tecnico/sync", "POST", {}, { operacoes })).json.resultados as any[]; };
const op = (atividadeId: string, dados: Record<string, unknown>) => ({ id: randomUUID(), tipo: "comentario", atividadeId, em: new Date().toISOString(), dados });

describe.skipIf(!URL_PG)("CHAT-1 responder (PostgreSQL real)", () => {
  let prisma: any;
  const linha = (clientId: string) => prisma.osComentario.findFirst({ where: { clientId }, select: { id: true, respostaAId: true, ordemServicoId: true } });
  const conta = (clientId: string) => prisma.osComentario.count({ where: { clientId } });

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(["tecnico/sync", "conversas/[osId]", "tecnico/conversas", "conversas/pessoas/[usuarioId]"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total (fictícia)", cnpj: "12.345.678/0001-90", email: "contato@clima.test" },
      { id: "e2", nome: "Outra (fictícia)", cnpj: "98.765.432/0001-10", email: "contato@outra.test" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana Escritório", email: "uA@clima.test", senha: "x", role: "ADMIN" },
      { id: "uV", empresaId: "e1", nome: "Vera Vendas", email: "uV@clima.test", senha: "x", role: "OPERADOR" },
      { id: "uT", empresaId: "e1", nome: "João Técnico", email: "joao@clima.test", senha: "x", role: "TECNICO" },
      { id: "uT2", empresaId: "e1", nome: "Maria Técnica", email: "maria@clima.test", senha: "x", role: "TECNICO" },
      { id: "uX", empresaId: "e2", nome: "Xavier", email: "x@outra.test", senha: "x", role: "ADMIN" },
    ] });
    await prisma.tecnico.createMany({ data: [
      { id: "t1", empresaId: "e1", nome: "João Silva", cpf: "1", telefone: "1", email: "joao@clima.test" },
      { id: "t2", empresaId: "e1", nome: "Maria Souza", cpf: "2", telefone: "2", email: "maria@clima.test" },
    ] });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital Fictício", cpfCnpj: "1" },
      { id: "c2", empresaId: "e2", nome: "Cliente da outra", cpfCnpj: "2" },
    ] });
    const os = (id: string, numero: string, extra: Record<string, unknown> = {}) => ({ id, empresaId: "e1", numero, clienteId: "c1", criadoPorId: "uA", descricao: "Manutenção", ...extra });
    await prisma.ordemServico.createMany({ data: [
      os("os1", "OS-0001"), os("os2", "OS-0002"), os("osV", "OS-0005", { criadoPorId: "uV" }),
      { id: "osX", empresaId: "e2", numero: "OS-9001", clienteId: "c2", criadoPorId: "uX", descricao: "Outra empresa" },
    ] });
    await prisma.atividadeOs.createMany({ data: [
      { id: "a1", empresaId: "e1", ordemServicoId: "os1", titulo: "Corretiva", tecnicoId: "t1", status: "EM_ANDAMENTO" },
      { id: "a2", empresaId: "e1", ordemServicoId: "os2", titulo: "Preventiva", tecnicoId: "t2", status: "AGENDADA" },
      { id: "aV", empresaId: "e1", ordemServicoId: "osV", titulo: "Da Vera", tecnicoId: "t1", status: "AGENDADA" },
    ] });
    const m = (id: string, extra: Record<string, unknown>) => ({ id, clientId: `c-${id}`, autorNome: "x", origem: "APP", texto: `Texto ${id}`, criadoEm: new Date("2026-11-12T12:00:00.000Z"), ...extra });
    await prisma.osComentario.createMany({ data: [
      m("m1", { empresaId: "e1", ordemServicoId: "os1", usuarioId: "uT", autorNome: "João Técnico", texto: "Cheguei no Hospital." }),
      m("m2", { empresaId: "e1", ordemServicoId: "os2", usuarioId: "uT2", autorNome: "Maria Técnica", texto: "Na OS da Maria." }),
      m("m3", { empresaId: "e1", ordemServicoId: null, usuarioId: "uA", autorNome: "Ana Escritório", origem: "ESCRITORIO", paraUsuarioId: "uT2", texto: "Só para a Maria." }),
      m("mV", { empresaId: "e1", ordemServicoId: "osV", usuarioId: "uT", autorNome: "João Técnico", texto: "Na OS da Vera." }),
      m("mX", { empresaId: "e2", ordemServicoId: "osX", usuarioId: "uX", autorNome: "Xavier", origem: "ESCRITORIO", texto: "Da outra empresa." }),
    ] });
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("app: responde pela fila com a OS da citada; o técnico e o escritório veem a citação; reenviar não duplica", async () => {
    const o = op("a1", { clientId: "r1", texto: "Portaria liberou.", respostaA: { id: "m1" } });
    const [r] = await sync([o]);
    expect(r.ok).toBe(true);
    expect(await linha("r1")).toMatchObject({ respostaAId: "m1", ordemServicoId: "os1" });
    const [de_novo] = await sync([o]);
    expect(de_novo.ok).toBe(true);
    expect(await conta("r1")).toBe(1);
    comoTecnico();
    const app = (await chamar("tecnico/conversas", "GET")).json.mensagens.find((x: any) => x.clientId === "r1");
    expect(app.respostaA).toMatchObject({ id: "m1", autor: "João Técnico", meu: true, texto: "Cheguei no Hospital." });
    comoAdmin();
    const os = (await chamar("conversas/[osId]", "GET", { osId: "os1" })).json.mensagens.find((x: any) => x.clientId === "r1");
    expect(os.respostaA).toMatchObject({ id: "m1", autor: "João Técnico", meu: false });
  });

  it("sem sinal: a resposta cita a mensagem ainda na fila (pelo clientId); no mesmo lote, a citada sobe antes e o vínculo fica", async () => {
    const res = await sync([
      op(SEM_OS, { clientId: "off-1", texto: "Chego em 10 minutos." }),
      op(SEM_OS, { clientId: "off-2", texto: "Corrigindo: 15 minutos.", respostaA: { clientId: "off-1" } }),
    ]);
    expect(res.map((x) => x.ok)).toEqual([true, true]);
    const citada = await linha("off-1");
    expect(await linha("off-2")).toMatchObject({ respostaAId: citada.id, ordemServicoId: null });
  });

  it("a citada nunca chegou ao servidor (recusada ou descartada no aparelho): a resposta grava sem a citação, sem travar a fila", async () => {
    const [r] = await sync([op(SEM_OS, { clientId: "orf-1", texto: "Ok.", respostaA: { clientId: "nunca-subiu" } })]);
    expect(r.ok).toBe(true);
    expect(await linha("orf-1")).toMatchObject({ respostaAId: null });
  });

  it("técnico: não cita o que não vê — a OS de outro técnico, a conversa de outra pessoa, outra empresa (404, nada gravado)", async () => {
    for (const [clientId, respostaA] of [["t-os2", { id: "m2" }], ["t-m3", { id: "m3" }], ["t-x", { id: "mX" }], ["t-x2", { clientId: "c-m2" }]] as const) {
      const [r] = await sync([op(SEM_OS, { clientId, texto: "Tentando citar.", respostaA })]);
      expect(r, clientId).toMatchObject({ ok: false, status: 404, erro: MSG_CITADA_NAO_ENCONTRADA });
      expect(await conta(clientId)).toBe(0);
    }
    // o clientId de outra empresa não existe nesta: grava sem a citação (nada da outra vaza nem se liga)
    const [r] = await sync([op(SEM_OS, { clientId: "t-x3", texto: "Ok.", respostaA: { clientId: "c-mX" } })]);
    expect(r.ok).toBe(true);
    expect(await linha("t-x3")).toMatchObject({ respostaAId: null });
  });

  it("escritório pela OS: cita só mensagem da mesma OS", async () => {
    comoAdmin();
    const ok = await chamar("conversas/[osId]", "POST", { osId: "os1" }, { clientId: "e-os1", texto: "Pode subir.", respostaA: { id: "m1" } });
    expect(ok.status).toBe(201);
    expect(ok.json.mensagem.respostaA).toMatchObject({ id: "m1", autor: "João Técnico" });
    const outra = await chamar("conversas/[osId]", "POST", { osId: "os1" }, { clientId: "e-os2", texto: "Errado.", respostaA: { id: "m2" } });
    expect(outra).toMatchObject({ status: 404, json: { erro: MSG_CITADA_NAO_ENCONTRADA } });
    expect(await conta("e-os2")).toBe(0);
    const fora = await chamar("conversas/[osId]", "POST", { osId: "os1" }, { clientId: "e-osx", texto: "Errado.", respostaA: { id: "mX" } });
    expect(fora.status).toBe(404);
    // a referência inválida não passa nem pela validação
    expect((await chamar("conversas/[osId]", "POST", { osId: "os1" }, { clientId: "e-inv", texto: "x", respostaA: { id: "m1", clientId: "c-m1" } })).status).toBe(400);
  });

  it("escritório pela pessoa: cita só a conversa dela; \"Ver só os próprios\" não cita OS fora do escopo", async () => {
    comoAdmin();
    const ok = await chamar("conversas/pessoas/[usuarioId]", "POST", { usuarioId: "uT" }, { clientId: "p-ok", texto: "Ótimo.", respostaA: { id: "m1" }, osId: null });
    expect(ok.status).toBe(201);
    expect(await linha("p-ok")).toMatchObject({ respostaAId: "m1", ordemServicoId: null });
    const deOutra = await chamar("conversas/pessoas/[usuarioId]", "POST", { usuarioId: "uT" }, { clientId: "p-m3", texto: "x", respostaA: { id: "m3" } });
    expect(deOutra.status).toBe(404);
    comoVera();
    expect((await chamar("conversas/pessoas/[usuarioId]", "POST", { usuarioId: "uT" }, { clientId: "v-m1", texto: "x", respostaA: { id: "m1" } })).status).toBe(404);
    expect(await conta("v-m1")).toBe(0);
    // a OS que ela criou, sim
    expect((await chamar("conversas/pessoas/[usuarioId]", "POST", { usuarioId: "uT" }, { clientId: "v-mV", texto: "Vi.", respostaA: { id: "mV" }, osId: "osV" })).status).toBe(201);
    comoOutraEmpresa();
    expect((await chamar("conversas/pessoas/[usuarioId]", "POST", { usuarioId: "uT" }, { clientId: "x-m1", texto: "x", respostaA: { id: "m1" } })).status).toBe(404);
  });

  it("quem não pode ver a original vê \"Mensagem indisponível\" (o conteúdo não sai do servidor)", async () => {
    // "p-ok": sem OS, cita m1 (OS-0001). A Vera vê a sem OS, mas não a OS-0001
    comoVera();
    const vera = (await chamar("conversas/pessoas/[usuarioId]", "GET", { usuarioId: "uT" })).json.mensagens;
    const daVera = vera.find((x: any) => x.clientId === "p-ok");
    expect(daVera.respostaA).toEqual({ id: null, clientId: null, autor: "", meu: false, texto: ROTULO_CITACAO_INDISPONIVEL, miniatura: null, indisponivel: true });
    expect(JSON.stringify(vera)).not.toContain("Cheguei no Hospital.");
    comoAdmin();
    const ana = (await chamar("conversas/pessoas/[usuarioId]", "GET", { usuarioId: "uT" })).json.mensagens.find((x: any) => x.clientId === "p-ok");
    expect(ana.respostaA).toMatchObject({ id: "m1", texto: "Cheguei no Hospital." });
  });

  it("?ate=: a conversa vem desde a citada antiga; citada de fora da conversa não muda nada", async () => {
    const base = Date.parse("2026-11-13T00:00:00.000Z");
    await prisma.osComentario.createMany({ data: Array.from({ length: 305 }, (_, i) => ({
      id: `n${i}`, clientId: `c-n${i}`, empresaId: "e1", ordemServicoId: null, usuarioId: "uT", autorNome: "João Técnico", origem: "APP", texto: `Mensagem ${i}`, criadoEm: new Date(base + i * 60_000),
    })) });
    comoTecnico();
    const normal = (await chamar("tecnico/conversas", "GET")).json.mensagens.map((x: any) => x.id);
    expect(normal).not.toContain("m1");
    const ate = (await chamar("tecnico/conversas", "GET", {}, undefined, "?ate=m1")).json.mensagens.map((x: any) => x.id);
    expect(ate[0]).toBe("m1");
    expect(ate.at(-1)).toBe(normal.at(-1)); // e continua até a mais recente
    expect(ate.length).toBeGreaterThan(normal.length);
    const fora = (await chamar("tecnico/conversas", "GET", {}, undefined, "?ate=m2")).json.mensagens.map((x: any) => x.id);
    expect(fora).toEqual(normal);
    comoAdmin();
    const pessoa = (await chamar("conversas/pessoas/[usuarioId]", "GET", { usuarioId: "uT" }, undefined, "?ate=m1")).json.mensagens.map((x: any) => x.id);
    expect(pessoa[0]).toBe("m1");
  });
});
