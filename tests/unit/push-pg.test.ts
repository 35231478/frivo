/**
 * PUSH em PostgreSQL real, pelas rotas e eventos de verdade (o serviço de push é simulado: `web-push`
 * registra o que seria enviado; o `after` do Next guarda o envio e o teste roda depois, como a resposta):
 *  - sem as chaves, nada (e a rota de inscrição recusa);
 *  - aparelhos: inscrever, listar e revogar só os próprios; o navegador que recusa (410) é apagado;
 *  - preferência por tipo (só os tipos que a pessoa pode receber);
 *  - eventos: atribuição (só quem ENTROU, e só se continuou), reagendamento, cancelamento, esquecida
 *    (técnico e escritório, sem repetir), aceite, portal, orçamento, estoque, comentário e despesa;
 *  - escopo: o técnico nunca recebe o que é da empresa inteira; outra empresa nunca recebe nada;
 *  - a rota do agendador só com o CRON_SECRET, e sem repetir.
 * Pula sem PG_TESTE_URL.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { PRESETS, permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_push_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const h = vi.hoisted(() => ({
  sessao: null as any,
  pendentes: [] as (() => unknown)[],
  enviados: [] as { endpoint: string; msg: any }[],
  falhar: {} as Record<string, number>,
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => h.sessao) }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => { h.pendentes.push(fn); } }));
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(async (sub: { endpoint: string }, corpo: string) => {
      const status = h.falhar[sub.endpoint];
      if (status) throw Object.assign(new Error("recusado"), { statusCode: status });
      h.enviados.push({ endpoint: sub.endpoint, msg: JSON.parse(corpo) });
    }),
  },
}));

/** Roda o que ficou para depois da resposta (o `after`), na ordem */
async function depoisDaResposta() {
  while (h.pendentes.length) await h.pendentes.shift()!();
}
const CHAVES = { VAPID_PUBLIC_KEY: "BPublicaFicticia", VAPID_PRIVATE_KEY: "privadaFicticia", VAPID_SUBJECT: "mailto:contato@exemplo.com" };
const ligar = () => Object.assign(process.env, CHAVES);
const desligar = () => { for (const k of Object.keys(CHAVES)) delete process.env[k]; };

const USUARIOS: Record<string, { empresaId: string; role: string; permissoes: Permissoes; tecnicoId: string | null; email: string }> = {
  uAdmin: { empresaId: "e1", role: "ADMIN", permissoes: permissoesTotais(), tecnicoId: null, email: "ana@clima.exemplo" },
  uFin: { empresaId: "e1", role: "OPERADOR", permissoes: PRESETS.FINANCEIRO, tecnicoId: null, email: "fin@clima.exemplo" },
  uCarlos: { empresaId: "e1", role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId: "tCarlos", email: "carlos@clima.exemplo" },
  uRosa: { empresaId: "e1", role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId: "tRosa", email: "rosa@clima.exemplo" },
  uOutra: { empresaId: "e2", role: "ADMIN", permissoes: permissoesTotais(), tecnicoId: null, email: "dono@outra.exemplo" },
  uCarlosE2: { empresaId: "e2", role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId: "tCarlosE2", email: "carlos@clima.exemplo" },
};
const como = (id: keyof typeof USUARIOS) => {
  const u = USUARIOS[id];
  h.sessao = { user: { id, name: id, email: u.email, empresaId: u.empresaId, empresaNome: "x", role: u.role, permissoes: u.permissoes, tecnicoId: u.tecnicoId } };
};

async function rota(caminho: string, metodo: string, corpo?: unknown, params: Record<string, string> = {}, headers: Record<string, string> = {}) {
  const mod = await import(/* @vite-ignore */ `@/app/${caminho}/route`);
  const req = new NextRequest("https://app.exemplo.com/x", { method: metodo, headers: { "Content-Type": "application/json", ...headers }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
/** Quem recebeu (pelo aparelho) e o quê, desde a última limpeza */
const recebidos = () => h.enviados.map((e) => [e.endpoint.replace("https://push.exemplo/", ""), e.msg.titulo]);
const limpar = () => { h.enviados.length = 0; };

describe.skipIf(!URL_PG)("push (PostgreSQL real)", () => {
  let prisma: any;
  let ev: typeof import("@/lib/push/eventos");

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    ev = await import("@/lib/push/eventos");

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "c@x.com" },
      { id: "e2", nome: "Outra Climatização", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.perfilAcesso.create({ data: { id: "pFin", empresaId: "e1", nome: "Financeiro", tipo: "FINANCEIRO", permissoes: PRESETS.FINANCEIRO } });
    for (const [id, u] of Object.entries(USUARIOS)) {
      await prisma.usuario.create({ data: { id, empresaId: u.empresaId, nome: id, email: u.email, senha: "x", role: u.role === "OPERADOR" ? "OPERADOR" : u.role, ...(id === "uFin" ? { perfilAcessoId: "pFin" } : {}) } });
    }
    await prisma.tecnico.createMany({ data: [
      { id: "tCarlos", empresaId: "e1", nome: "Carlos", cpf: "1", telefone: "1", email: "carlos@clima.exemplo" },
      { id: "tRosa", empresaId: "e1", nome: "Rosa", cpf: "2", telefone: "2", email: "rosa@clima.exemplo" },
      { id: "tCarlosE2", empresaId: "e2", nome: "Carlos da outra", cpf: "3", telefone: "3", email: "carlos@clima.exemplo" },
    ] });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Comercial de Alimentos Silva Ltda", nomeFantasia: "Mercado do Zé", cpfCnpj: "44.555.666/0001-77" },
      { id: "cE2", empresaId: "e2", nome: "Cliente da outra", cpfCnpj: "33.444.555/0001-66" },
    ] });
    const os = (id: string, numero: string, status = "AGENDADA", empresaId = "e1") => ({ id, empresaId, numero, clienteId: empresaId === "e1" ? "c1" : "cE2", criadoPorId: empresaId === "e1" ? "uAdmin" : "uOutra", descricao: "Câmara fria", status });
    await prisma.ordemServico.createMany({ data: [os("os1", "OS-0001"), os("os2", "OS-0002", "EM_ANDAMENTO"), os("os3", "OS-0003"), os("osE2", "OS-E2", "AGENDADA", "e2")] });
    await prisma.atividadeOs.createMany({ data: [
      { id: "at1", empresaId: "e1", ordemServicoId: "os1", titulo: "Preventiva", status: "AGENDADA", dataAgendada: new Date("2026-12-10T17:30:00Z"), tecnicoId: "tCarlos" },
      { id: "at2", empresaId: "e1", ordemServicoId: "os2", titulo: "Corretiva", status: "EM_ANDAMENTO", iniciadaEm: new Date("2026-11-20T11:00:00Z"), tecnicoId: "tCarlos" },
      { id: "at3a", empresaId: "e1", ordemServicoId: "os3", titulo: "Visita 1", status: "AGENDADA", dataAgendada: new Date("2026-12-20T12:00:00Z"), tecnicoId: "tCarlos" },
      { id: "at3b", empresaId: "e1", ordemServicoId: "os3", titulo: "Visita 2", status: "AGENDADA", dataAgendada: new Date("2026-12-21T12:00:00Z"), tecnicoId: "tCarlos" },
      { id: "atE2", empresaId: "e2", ordemServicoId: "osE2", titulo: "Da outra", status: "EM_ANDAMENTO", iniciadaEm: new Date("2026-11-20T11:00:00Z"), tecnicoId: "tCarlosE2" },
    ] });
    // Um aparelho por pessoa (o Carlos tem dois: celular e tablet)
    const sub = (id: string, userId: string, empresaId: string) => ({ id, userId, empresaId, endpoint: `https://push.exemplo/${id}`, p256dh: "p", auth: "a" });
    await prisma.pushSubscription.createMany({ data: [
      sub("admin", "uAdmin", "e1"), sub("fin", "uFin", "e1"), sub("carlos-cel", "uCarlos", "e1"), sub("carlos-tab", "uCarlos", "e1"),
      sub("rosa", "uRosa", "e1"), sub("outra", "uOutra", "e2"), sub("carlos-e2", "uCarlosE2", "e2"),
    ] });
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  beforeEach(() => { ligar(); limpar(); h.pendentes.length = 0; h.falhar = {}; });

  /* ───────── Desligado ───────── */
  it("sem as chaves: nada sai, a chave pública diz desligado e a inscrição é recusada", async () => {
    desligar();
    const r = await ev.notificarAtribuicao("at1", ["tCarlos"]);
    expect(r).toMatchObject({ desligado: true, enviados: [] });
    como("uCarlos");
    expect(await rota("api/push/chave", "GET")).toEqual({ status: 200, json: { ligado: false, chave: null } });
    expect((await rota("api/push/subscribe", "POST", { endpoint: "https://push.exemplo/novo", keys: { p256dh: "p", auth: "a" } })).status).toBe(409);
    expect(h.enviados).toEqual([]);
    expect(await prisma.pushEnvio.count()).toBe(0);
    ligar();
    expect((await rota("api/push/chave", "GET")).json).toEqual({ ligado: true, chave: "BPublicaFicticia" });
  });

  /* ───────── Aparelhos ───────── */
  it("aparelhos: inscrever grava a empresa; listar e revogar só os próprios; desinscrever o endpoint de outro não apaga", async () => {
    como("uRosa");
    expect((await rota("api/push/subscribe", "POST", { endpoint: "https://push.exemplo/rosa-tab", keys: { p256dh: "p", auth: "a" }, userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/131.0 Mobile Safari/537.36" })).status).toBe(201);
    expect((await prisma.pushSubscription.findUnique({ where: { endpoint: "https://push.exemplo/rosa-tab" } })).empresaId).toBe("e1");
    const lista = (await rota("api/push/aparelhos", "GET")).json;
    // o endpoint não volta inteiro: só o final, para a tela marcar "este aparelho"
    expect(lista.map((a: any) => a.final)).toEqual(["https://push.exemplo/rosa-tab".slice(-24), "https://push.exemplo/rosa".slice(-24)]);
    expect(lista[0].aparelho).toBe("Android · Chrome");
    expect(JSON.stringify(lista)).not.toContain("https://push.exemplo/rosa-tab");
    // o do Carlos: 404 na revogação e nada apagado pelo DELETE do endpoint
    expect((await rota("api/push/aparelhos/[id]", "DELETE", undefined, { id: "carlos-tab" })).status).toBe(404);
    await rota("api/push/subscribe", "DELETE", { endpoint: "https://push.exemplo/carlos-tab" });
    expect(await prisma.pushSubscription.count({ where: { userId: "uCarlos" } })).toBe(2);
    expect((await rota("api/push/aparelhos/[id]", "DELETE", undefined, { id: lista[0].id })).status).toBe(200);
    expect(await prisma.pushSubscription.count({ where: { userId: "uRosa" } })).toBe(1);
  });

  it("o navegador que recusa de vez (410) é apagado; falha passageira conta, e na 5ª sai", async () => {
    await prisma.pushSubscription.create({ data: { id: "rosa-velho", userId: "uRosa", empresaId: "e1", endpoint: "https://push.exemplo/rosa-velho", p256dh: "p", auth: "a" } });
    await prisma.pushSubscription.create({ data: { id: "rosa-instavel", userId: "uRosa", empresaId: "e1", endpoint: "https://push.exemplo/rosa-instavel", p256dh: "p", auth: "a", falhas: 3 } });
    h.falhar = { "https://push.exemplo/rosa-velho": 410, "https://push.exemplo/rosa-instavel": 503 };
    const { enviarPush } = await import("@/lib/push/servidor");
    const r = await enviarPush({ empresaId: "e1", tipo: "TESTE", alcance: "pessoal", usuarios: ["uRosa"], chave: "t1", mensagem: { titulo: "Teste", corpo: "", url: "/", tag: "t" } });
    expect(r.enviados).toEqual([{ usuarioId: "uRosa", aparelhos: 1 }]);
    expect(await prisma.pushSubscription.findUnique({ where: { id: "rosa-velho" } })).toBeNull();
    expect((await prisma.pushSubscription.findUnique({ where: { id: "rosa-instavel" } })).falhas).toBe(4);
    expect((await prisma.pushSubscription.findUnique({ where: { id: "rosa" } })).ultimoEnvioEm).not.toBeNull();
    await enviarPush({ empresaId: "e1", tipo: "TESTE", alcance: "pessoal", usuarios: ["uRosa"], chave: "t2", mensagem: { titulo: "Teste", corpo: "", url: "/", tag: "t" } });
    expect(await prisma.pushSubscription.findUnique({ where: { id: "rosa-instavel" } })).toBeNull();
    expect((await prisma.pushEnvio.findFirst({ where: { chave: "t1" } })).aparelhos).toBe(1);
  });

  /* ───────── Preferências ───────── */
  it("preferências: cada um vê os tipos que pode receber; desligar um tipo corta o envio; tipo de fora é ignorado", async () => {
    como("uCarlos");
    expect((await rota("api/push/preferencias", "GET")).json.map((t: any) => t.id)).toEqual(["OS_NOVA", "OS_REAGENDADA", "OS_CANCELADA", "ATIVIDADE_ESQUECIDA", "OS_COMENTARIO", "ACEITE", "DESPESA"]);
    expect((await rota("api/push/preferencias", "PUT", { OS_NOVA: false, SOLICITACAO_PORTAL: false })).status).toBe(200);
    expect((await prisma.preferenciaUsuario.findFirst({ where: { usuarioId: "uCarlos", chave: "push:tipos" } })).valor).toEqual({ OS_NOVA: false });
    expect((await rota("api/push/preferencias", "GET")).json.find((t: any) => t.id === "OS_NOVA").ligado).toBe(false);
    await ev.notificarAtribuicao("at1", ["tCarlos"]);
    expect(recebidos()).toEqual([]);
    await rota("api/push/preferencias", "PUT", { OS_NOVA: true });
    como("uAdmin");
    expect((await rota("api/push/preferencias", "GET")).json.map((t: any) => t.id)).toEqual(["ATIVIDADE_ESQUECIDA", "OS_COMENTARIO", "ACEITE", "DESPESA", "SOLICITACAO_PORTAL", "ORCAMENTO_RESPOSTA", "ESTOQUE_NEGATIVO"]);
  });

  /* ───────── Atribuição ───────── */
  it("atribuição: só quem ENTROU recebe (em todos os aparelhos), uma vez; transação desfeita ou técnico retirado, nada", async () => {
    const { gravarTecnicos } = await import("@/lib/atividade-tecnicos");
    // Rosa entra na at1 (o Carlos já estava)
    await prisma.$transaction((tx: any) => gravarTecnicos(tx, "at1", { responsavel: "tCarlos", outros: ["tRosa"], equipeId: null }));
    await depoisDaResposta();
    expect(recebidos()).toEqual([["rosa", "Nova OS para você: OS-0001"]]);
    const msg = h.enviados[0].msg;
    expect([msg.corpo.replace(/ /g, " "), msg.url]).toEqual(["Mercado do Zé · qui. 10/12 às 14:30 · Preventiva", "/tecnico?ver=os&a=at1"]);
    // gravar de novo a mesma composição: ninguém é novo
    limpar();
    await prisma.$transaction((tx: any) => gravarTecnicos(tx, "at1", { responsavel: "tCarlos", outros: ["tRosa"], equipeId: null }));
    await depoisDaResposta();
    expect(recebidos()).toEqual([]);
    // sai e volta: a chave da atividade não repete o aviso para a mesma pessoa
    await prisma.$transaction((tx: any) => gravarTecnicos(tx, "at1", { responsavel: "tCarlos", outros: [], equipeId: null }));
    await prisma.$transaction((tx: any) => gravarTecnicos(tx, "at1", { responsavel: "tCarlos", outros: ["tRosa"], equipeId: null }));
    await depoisDaResposta();
    expect(recebidos()).toEqual([]);
    // transação desfeita: o aviso agendado relê a atividade e não acha a Rosa na at3a
    await prisma.$transaction(async (tx: any) => { await gravarTecnicos(tx, "at3a", { responsavel: "tCarlos", outros: ["tRosa"], equipeId: null }); throw new Error("desfaz"); }).catch(() => null);
    await depoisDaResposta();
    expect(recebidos()).toEqual([]);
    // o técnico homônimo da OUTRA empresa (mesmo e-mail) nunca recebe
    expect(h.enviados.some((e) => e.endpoint.endsWith("carlos-e2"))).toBe(false);
  });

  it("isolamento: destinatários só da empresa do evento (o técnico homônimo da outra empresa, nunca)", async () => {
    const { enviarPush, usuariosDosTecnicos } = await import("@/lib/push/servidor");
    expect(await usuariosDosTecnicos("e1", ["tCarlos"])).toEqual(["uCarlos"]);
    expect(await usuariosDosTecnicos("e1", ["tCarlosE2"])).toEqual([]);
    const r = await enviarPush({ empresaId: "e1", tipo: "TESTE", alcance: "pessoal", usuarios: ["uOutra", "uCarlosE2"], chave: "iso", mensagem: { titulo: "x", corpo: "", url: "/", tag: "t" } });
    expect(r.enviados).toEqual([]);
    expect(h.enviados).toEqual([]);
  });

  it("reagendar para a MESMA data (a edição regravou a data igual): ninguém recebe, nem na primeira vez", async () => {
    const at1 = await prisma.atividadeOs.findUnique({ where: { id: "at1" }, select: { dataAgendada: true } });
    expect(await ev.notificarReagendamento("e1", "at1", at1.dataAgendada)).toBeNull();
    expect(h.enviados).toEqual([]);
    expect(await prisma.pushEnvio.count({ where: { tipo: "OS_REAGENDADA" } })).toBe(0);
  });

  /* ───────── Reagendamento e cancelamento pelas rotas ───────── */
  it("reagendar pelo calendário avisa os técnicos (de → para), uma vez por nova data", async () => {
    como("uAdmin");
    expect((await rota("api/ordens/[id]", "PATCH", { data: "2026-12-15", atividadeId: "at1" }, { id: "os1" })).status).toBe(200);
    await depoisDaResposta();
    expect(recebidos().sort()).toEqual([["carlos-cel", "OS reagendada: OS-0001"], ["carlos-tab", "OS reagendada: OS-0001"], ["rosa", "OS reagendada: OS-0001"]]);
    expect(h.enviados[0].msg.corpo.replace(/ /g, " ")).toBe("Mercado do Zé · de qui. 10/12 às 14:30 para ter. 15/12 às 14:30");
    limpar();
    await rota("api/ordens/[id]", "PATCH", { data: "2026-12-15", atividadeId: "at1" }, { id: "os1" });
    await depoisDaResposta();
    expect(recebidos()).toEqual([]); // a mesma data: nada mudou
  });

  it("cancelar a OS avisa os técnicos das atividades em aberto — um aviso por pessoa, mesmo em duas atividades", async () => {
    como("uAdmin");
    expect((await rota("api/ordens/[id]", "DELETE", { motivo: "Cliente desistiu" }, { id: "os3" })).status).toBe(200);
    await depoisDaResposta();
    expect(recebidos().sort()).toEqual([["carlos-cel", "OS cancelada: OS-0003"], ["carlos-tab", "OS cancelada: OS-0003"]]);
    expect(h.enviados[0].msg.corpo).toBe("Mercado do Zé · Motivo: Cliente desistiu");
  });

  /* ───────── Esquecida ───────── */
  it("esquecida: o técnico (no app) e o escritório (na OS); o outro técnico e a outra empresa não; não repete", async () => {
    await prisma.preferenciaUsuario.create({ data: { usuarioId: "uFin", chave: "push:tipos", valor: { ATIVIDADE_ESQUECIDA: false } } });
    expect(await ev.verificarEsquecidas("e1", new Date("2026-11-27T15:00:00Z"))).toBe(1);
    const por = Object.fromEntries(h.enviados.map((e) => [e.endpoint.replace("https://push.exemplo/", ""), e.msg]));
    expect(Object.keys(por).sort()).toEqual(["admin", "carlos-cel", "carlos-tab"]); // Financeiro desligou; Rosa não está nela
    expect([por["carlos-cel"].titulo, por["carlos-cel"].url]).toEqual(["Atividade ainda em andamento: OS-0002", "/tecnico?ver=os&a=at2"]);
    expect([por.admin.titulo, por.admin.url]).toEqual(["Atividade esquecida em andamento: OS-0002", "/ordens/os2"]);
    limpar();
    expect(await ev.verificarEsquecidas("e1", new Date("2026-11-27T16:00:00Z"))).toBe(1);
    expect(recebidos()).toEqual([]); // push_envios: a mesma atividade, o mesmo início — não repete
    // o sino confere no máximo a cada 5 min por empresa
    expect(ev.conferirEsquecidasPeloSino("e9", 1_000_000)).toBe(true);
    expect(ev.conferirEsquecidasPeloSino("e9", 1_000_000 + 60_000)).toBe(false);
    expect(ev.conferirEsquecidasPeloSino("e9", 1_000_000 + ev.INTERVALO_ESQUECIDAS_MS)).toBe(true);
    h.pendentes.length = 0;
  });

  it("rota do agendador: só com o CRON_SECRET; confere todas as empresas com aparelho e não repete", async () => {
    process.env.CRON_SECRET = "segredo-teste";
    expect((await rota("api/cron/push", "GET")).status).toBe(401);
    expect((await rota("api/cron/push", "GET", undefined, {}, { authorization: "Bearer errado" })).status).toBe(401);
    const r = await rota("api/cron/push", "GET", undefined, {}, { authorization: "Bearer segredo-teste" });
    expect(r).toMatchObject({ status: 200, json: { ok: true, ligado: true, empresas: 2 } });
    // a da outra empresa saiu (para o técnico e o dono dela); a da e1 já tinha saído no teste anterior
    expect(recebidos().map((x) => x[0]).sort()).toEqual(["carlos-e2", "outra"]);
    limpar();
    await rota("api/cron/push", "GET", undefined, {}, { authorization: "Bearer segredo-teste" });
    expect(recebidos()).toEqual([]);
    delete process.env.CRON_SECRET;
  });

  /* ───────── Aceite ───────── */
  it("aceite colhido no local com nota baixa: o escritório recebe; quem colheu, não; aceite limpo, ninguém", async () => {
    const { registrarAceiteLocal } = await import("@/lib/os/aceite-server");
    await prisma.ordemServico.update({ where: { id: "os2" }, data: { status: "CONCLUIDA" } });
    await registrarAceiteLocal({ empresaId: "e1", usuarioId: "uCarlos", osId: "os2", atividadeId: "at2", exigirOsConcluida: false },
      { nome: "Sr. Zé", assinatura: "data:image/png;base64,AAAA", avaliacao: 1, avaliacaoComentario: "Demorou muito" } as any);
    await depoisDaResposta();
    expect(recebidos().sort()).toEqual([["admin", "Aceite com nota baixa: OS-0002"], ["fin", "Aceite com nota baixa: OS-0002"]]);
    expect(h.enviados[0].msg.corpo).toBe("Mercado do Zé · Nota 1 de 5 · Demorou muito");
    // aceite limpo (nota 5, sem comentário): ninguém
    limpar();
    await prisma.osAceite.updateMany({ where: { ordemServicoId: "os2" }, data: { avaliacao: 5, avaliacaoComentario: null } });
    await prisma.pushEnvio.deleteMany({ where: { chave: "aceite:os2" } });
    await ev.notificarAceite("e1", "os2");
    expect(recebidos()).toEqual([]);
  });

  /* ───────── Escritório ───────── */
  it("portal, orçamento e estoque: só o escritório, pela permissão; técnico e outra empresa, nunca", async () => {
    await ev.notificarSolicitacaoPortal("e1", "os1");
    expect(recebidos().map((x) => x[0]).sort()).toEqual(["admin", "fin"]);
    limpar();
    await prisma.orcamento.create({ data: { id: "orc1", empresaId: "e1", clienteId: "c1", codigo: "ORC-7", nome: "Troca", criadoPorId: "uAdmin", tokenPublico: "tk1", status: "APROVADO" } });
    await ev.notificarRespostaOrcamento("e1", "orc1");
    expect(recebidos()).toEqual([["admin", "Orçamento aprovado: ORC-7"], ["fin", "Orçamento aprovado: ORC-7"]].sort());
    // o da outra empresa não existe para a e1
    expect(await ev.notificarRespostaOrcamento("e2", "orc1")).toBeNull();
    limpar();
    await prisma.produto.create({ data: { id: "p1", empresaId: "e1", nome: "Gás R-410A", unidade: "kg", saldo: -2 } });
    await ev.notificarEstoqueNegativo("e1", "p1", "OS-0002", new Date("2026-11-27T15:00:00Z"));
    await ev.notificarEstoqueNegativo("e1", "p1", "OS-0002", new Date("2026-11-27T18:00:00Z"));
    expect(recebidos().sort()).toEqual([["admin", "Saldo negativo por uso em campo"], ["fin", "Saldo negativo por uso em campo"]]); // um por dia
    limpar();
    await prisma.produto.update({ where: { id: "p1" }, data: { saldo: 3 } });
    expect(await ev.notificarEstoqueNegativo("e1", "p1", null, new Date("2026-11-28T15:00:00Z"))).toBeNull();
  });

  /* ───────── Prontos sem chamador ───────── */
  it("comentário na OS (pronto): os técnicos da OS (no app) e o escritório, menos o autor", async () => {
    await ev.notificarComentarioOS("os1", "uAdmin", { comentarioId: "cm1", texto: "Levar escada" });
    const por = Object.fromEntries(h.enviados.map((e) => [e.endpoint.replace("https://push.exemplo/", ""), e.msg]));
    expect(Object.keys(por).sort()).toEqual(["carlos-cel", "carlos-tab", "fin", "rosa"]);
    expect([por.rosa.url, por.fin.url, por.fin.corpo]).toEqual(["/tecnico?ver=os&a=at1", "/ordens/os1", "uAdmin · Levar escada"]);
    limpar();
    await ev.notificarComentarioOS("os1", "uAdmin", { comentarioId: "cm1", texto: "Levar escada" });
    expect(recebidos()).toEqual([]); // o mesmo comentário não repete
  });

  it("despesa (pronta): enviada vai ao escritório que aprova; aprovada/recusada, a quem enviou", async () => {
    const base = { empresaId: "e1", despesaId: "d1", autorUsuarioId: "uCarlos", descricao: "Pedágio", valor: 12.5, url: "/financeiro/despesas/d1" };
    await ev.notificarDespesa({ ...base, situacao: "ENVIADA" });
    expect(recebidos().sort()).toEqual([["admin", "Despesa para aprovar"], ["fin", "Despesa para aprovar"]]);
    limpar();
    await ev.notificarDespesa({ ...base, situacao: "RECUSADA", motivo: "Sem nota fiscal" });
    expect(recebidos().sort()).toEqual([["carlos-cel", "Despesa recusada"], ["carlos-tab", "Despesa recusada"]]);
  });

  it("teste pela rota: só os aparelhos da própria pessoa; sem aparelho, 409", async () => {
    como("uFin");
    expect((await rota("api/push/teste", "POST")).json).toEqual({ ok: true, aparelhos: 1 });
    expect(recebidos()).toEqual([["fin", "Notificações ligadas"]]);
    await prisma.pushSubscription.deleteMany({ where: { userId: "uFin" } });
    expect((await rota("api/push/teste", "POST")).status).toBe(409);
  });
});
