/**
 * CHAT-1 — o chat interno no PostgreSQL REAL, pelas rotas reais (dados fictícios):
 *  - o técnico escreve pela FILA do app (texto e foto), offline-idempotente: reenviar não duplica; a foto vai para
 *    os_comentarios_fotos (nunca para os anexos da OS);
 *  - o escritório vê a lista (uma conversa por OS) com as não lidas; abrir a conversa marca como lida e grava o ✓✓
 *    (quem e quando) na mensagem do técnico; o escritório escreve (o mesmo clientId não duplica) e o técnico lê;
 *  - isolamento: o técnico só vê as OS dele; "Ver só os próprios" (COM-1); outra empresa; sem permissão;
 *  - OS cancelada: só leitura (escritório e app); concluída segue aberta;
 *  - tempo real: a marca muda com mensagem e com leitura; o técnico só "sente" as OS dele;
 *  - push: o toque abre a conversa certa (app e escritório).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/chat-1-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextRequest } from "next/server";
import { PRESETS, permissoesTotais } from "@/lib/permissoes";
import { MSG_OS_CANCELADA, MSG_SEM_CONVERSA } from "@/lib/chat/regras";
import { MSG_COMENTARIO_DUPLICADO } from "@/lib/tecnico/comentarios";
import { JPEG, dataUrl } from "./arquivos-exemplo";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_chat1_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
vi.setConfig({ testTimeout: 60_000 });

const sessao = vi.hoisted(() => ({ atual: null as any }));
const push = vi.hoisted(() => ({ envios: [] as any[], comAparelho: [] as string[] }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
vi.mock("@/lib/push/servidor", async (orig) => ({
  ...(await orig<typeof import("@/lib/push/servidor")>()),
  usuariosComAparelho: vi.fn(async () => push.comAparelho),
  enviarPush: vi.fn(async (p: any) => { push.envios.push(p); return { enviados: p.usuarios.length }; }),
}));

const FOTO = dataUrl("image/jpeg", JPEG);
const TOTAIS = permissoesTotais();
const user = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, email: `${id}@clima.test`, empresaId: "e1", role: "ADMIN", permissoes: TOTAIS, tecnicoId: null, ...extra });
const como = (u: Record<string, unknown>) => { sessao.atual = { user: u }; };
const comoAdmin = () => como(user("uA"));
const comoTecnico = (id = "uT", tecnicoId = "t1", email = "joao@clima.test") => como({ id, name: id, email, empresaId: "e1", role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId });
const comoVendedor = () => como(user("uV", { role: "OPERADOR", permissoes: { ...TOTAIS, ordens: { ...TOTAIS.ordens, verSoProprios: true } } }));
const comoLeitor = () => como(user("uL", { role: "OPERADOR", permissoes: { ...TOTAIS, ordens: { ...TOTAIS.ordens, editar: false } } }));

async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown, qs = "") {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`http://localhost/api/x${qs}`, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  const tipo = res.headers.get("content-type") ?? "";
  return { status: res.status, tipo, json: tipo.includes("json") ? await res.json().catch(() => null) : null };
}
const sync = async (operacoes: unknown[], quem = () => comoTecnico()) => { quem(); return (await chamar("tecnico/sync", "POST", {}, { operacoes })).json.resultados as any[]; };
const mensagem = (atividadeId: string, dados: Record<string, unknown>) => ({ id: randomUUID(), tipo: "comentario", atividadeId, em: new Date().toISOString(), dados });

describe.skipIf(!URL_PG)("CHAT-1 (PostgreSQL real)", () => {
  let prisma: any;

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(["tecnico/sync", "conversas", "conversas/[osId]", "conversas/novidades", "conversas/fotos/[fotoId]", "tecnico/conversas", "tecnico/conversas/[osId]",
      "tecnico/conversas/novidades", "tecnico/conversas/fotos/[fotoId]", "ordens/[id]/comentarios"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total (fictícia)", cnpj: "12.345.678/0001-90", email: "contato@clima.test" },
      { id: "e2", nome: "Outra (fictícia)", cnpj: "98.765.432/0001-10", email: "contato@outra.test" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana Escritório", email: "uA@clima.test", senha: "x", role: "ADMIN" },
      { id: "uV", empresaId: "e1", nome: "Vera Vendas", email: "uV@clima.test", senha: "x", role: "OPERADOR" },
      { id: "uL", empresaId: "e1", nome: "Leo Leitura", email: "uL@clima.test", senha: "x", role: "OPERADOR" },
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
      os("os1", "OS-0001"), os("os2", "OS-0002"), os("osC", "OS-0003", { status: "CANCELADA" }), os("osF", "OS-0004", { status: "CONCLUIDA" }),
      os("osV", "OS-0005", { criadoPorId: "uV" }),
      { id: "osX", empresaId: "e2", numero: "OS-9001", clienteId: "c2", criadoPorId: "uX", descricao: "Outra empresa" },
    ] });
    await prisma.atividadeOs.createMany({ data: [
      { id: "a1", empresaId: "e1", ordemServicoId: "os1", titulo: "Corretiva", tecnicoId: "t1", status: "EM_ANDAMENTO" },
      { id: "a2", empresaId: "e1", ordemServicoId: "os2", titulo: "Preventiva", tecnicoId: "t2", status: "AGENDADA" },
      { id: "aC", empresaId: "e1", ordemServicoId: "osC", titulo: "Cancelada", tecnicoId: "t1", status: "AGENDADA" },
      { id: "aF", empresaId: "e1", ordemServicoId: "osF", titulo: "Concluída", tecnicoId: "t1", status: "CONCLUIDA" },
      { id: "aV", empresaId: "e1", ordemServicoId: "osV", titulo: "Da Vera", tecnicoId: "t1", status: "AGENDADA" },
    ] });
    // João também está na EQUIPE da atividade da OS 2? Não: a OS 2 é só da Maria (o isolamento entre técnicos)
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("o técnico escreve pela fila (texto e foto); reenviar a mesma gravação não duplica; a foto fica no chat, não nos anexos da OS", async () => {
    const texto = mensagem("a1", { clientId: "m-texto", texto: "Cheguei no cliente." });
    const foto = mensagem("a1", { clientId: "m-foto", texto: "Dreno entupido", foto: FOTO, miniatura: FOTO });
    const r = await sync([texto, foto]);
    expect(r.map((x) => [x.ok, x.status])).toEqual([[true, 201], [true, 201]]);
    // a mesma fila reenviada (sem sinal na 1ª vez, por exemplo) não cria outra mensagem
    const de_novo = await sync([texto, { ...foto, id: randomUUID() }]);
    expect(de_novo.every((x) => x.ok)).toBe(true);
    expect(await prisma.osComentario.count({ where: { ordemServicoId: "os1" } })).toBe(2);
    expect(await prisma.osComentarioFoto.count()).toBe(1);
    expect(await prisma.osAnexo.count()).toBe(0);
    // o mesmo clientId usado para OUTRA OS é recusado
    const outra = await sync([mensagem("aF", { clientId: "m-texto", texto: "x" })]);
    expect(outra[0]).toMatchObject({ ok: false, status: 409, erro: MSG_COMENTARIO_DUPLICADO });
  });

  it("o escritório vê a conversa na lista com as não lidas; abrir marca como lida e grava o ✓✓ (quem e quando) nas mensagens do técnico", async () => {
    comoAdmin();
    const l = await chamar("conversas", "GET");
    expect(l.status).toBe(200);
    expect(l.json.conversas.map((c: any) => c.osId)).toEqual(["os1"]);
    expect(l.json.conversas[0]).toMatchObject({ osNumero: "OS-0001", cliente: "Hospital Fictício", tecnicos: ["João Silva"], naoLidas: 2, ultima: { foto: true, minha: false, autor: "João Técnico" } });
    expect(l.json.naoLidas).toBe(1);
    const c = await chamar("conversas/[osId]", "GET", { osId: "os1" });
    expect(c.status).toBe(200);
    expect(c.json.mensagens.map((m: any) => [m.texto, m.meu, !!m.foto, m.lida?.por])).toEqual([["Cheguei no cliente.", false, false, "Ana Escritório"], ["Dreno entupido", false, true, "Ana Escritório"]]);
    const lida = await prisma.osComentario.findFirst({ where: { clientId: "m-texto" } });
    expect(lida.lidaPorId).toBe("uA");
    expect(lida.lidaEm).toBeInstanceOf(Date);
    expect((await chamar("conversas", "GET")).json.conversas[0].naoLidas).toBe(0);
    // ler de novo não troca quem leu primeiro
    comoVendedor();
    await prisma.ordemServico.update({ where: { id: "os1" }, data: { criadoPorId: "uV" } });
    await chamar("conversas/[osId]", "GET", { osId: "os1" });
    expect((await prisma.osComentario.findFirst({ where: { clientId: "m-texto" } })).lidaPorId).toBe("uA");
    await prisma.ordemServico.update({ where: { id: "os1" }, data: { criadoPorId: "uA" } });
  });

  it("a foto inteira (ampliar): quem vê a conversa; outro técnico, outra empresa e fora do escopo não", async () => {
    const f = await prisma.osComentarioFoto.findFirst();
    comoAdmin();
    const r = await chamar("conversas/fotos/[fotoId]", "GET", { fotoId: f.id });
    expect([r.status, r.tipo]).toEqual([200, "image/jpeg"]);
    comoTecnico();
    expect((await chamar("tecnico/conversas/fotos/[fotoId]", "GET", { fotoId: f.id })).status).toBe(200);
    comoTecnico("uT2", "t2", "maria@clima.test");
    expect((await chamar("tecnico/conversas/fotos/[fotoId]", "GET", { fotoId: f.id })).json).toEqual({ erro: MSG_SEM_CONVERSA });
    como({ ...user("uX"), empresaId: "e2" });
    expect((await chamar("conversas/fotos/[fotoId]", "GET", { fotoId: f.id })).status).toBe(404);
    comoVendedor();
    expect((await chamar("conversas/fotos/[fotoId]", "GET", { fotoId: f.id })).status).toBe(404);
  });

  it("o escritório escreve (o mesmo clientId não duplica); o técnico vê não lida, abre e o escritório ganha o ✓✓", async () => {
    comoAdmin();
    const corpo = { clientId: "e-1", texto: "Pode desobstruir, o cliente autorizou." };
    const a = await chamar("conversas/[osId]", "POST", { osId: "os1" }, corpo);
    const b = await chamar("conversas/[osId]", "POST", { osId: "os1" }, corpo);
    expect([a.status, b.status]).toEqual([201, 200]);
    expect(b.json.mensagem.id).toBe(a.json.mensagem.id);
    expect(await prisma.osComentario.count({ where: { ordemServicoId: "os1", origem: "ESCRITORIO" } })).toBe(1);
    comoTecnico();
    const l = await chamar("tecnico/conversas", "GET");
    const c1 = l.json.conversas.find((c: any) => c.osId === "os1");
    expect(c1).toMatchObject({ naoLidas: 1, atividadeId: "a1", atividadeIds: ["a1"] });
    expect(l.json.naoLidas).toBe(1);
    const conv = await chamar("tecnico/conversas/[osId]", "GET", { osId: "os1" });
    expect(conv.json.conversa.atividadeId).toBe("a1");
    expect(conv.json.mensagens.at(-1)).toMatchObject({ texto: corpo.texto, meu: false, origem: "ESCRITORIO" });
    comoAdmin();
    const visto = await chamar("conversas/[osId]", "GET", { osId: "os1" });
    expect(visto.json.mensagens.at(-1)).toMatchObject({ meu: true, lida: { por: "João Técnico" } });
    // a rota antiga da OS (Resumo) continua: sem clientId o servidor dá um
    const antigo = await chamar("ordens/[id]/comentarios", "POST", { id: "os1" }, { texto: "Pela rota antiga" });
    expect(antigo.status).toBe(201);
  });

  it("isolamento entre técnicos: o João só vê as OS dele; a da Maria não aparece e não abre", async () => {
    comoTecnico();
    const l = await chamar("tecnico/conversas", "GET");
    // as OS dele em aberto (a em andamento e a da Vera); a cancelada sem mensagem e a concluída sem mensagem recente ficam fora
    expect(l.json.conversas.map((c: any) => c.osId).sort()).toEqual(["os1", "osV"]);
    expect((await chamar("tecnico/conversas/[osId]", "GET", { osId: "os2" })).status).toBe(404);
    // escrever pela fila numa atividade que não é dele é recusado pelo escopo da execução
    const r = await sync([mensagem("a2", { clientId: "intruso", texto: "oi" })]);
    expect(r[0].ok).toBe(false);
    expect(await prisma.osComentario.count({ where: { clientId: "intruso" } })).toBe(0);
  });

  it("OS cancelada: só leitura (escritório 409, app recusado); concluída segue aberta e volta à lista do técnico", async () => {
    comoAdmin();
    expect((await chamar("conversas/[osId]", "POST", { osId: "osC" }, { clientId: "c-x", texto: "oi" })).json).toEqual({ erro: MSG_OS_CANCELADA });
    const app = await sync([mensagem("aC", { clientId: "c-y", texto: "oi" })]);
    expect(app[0]).toMatchObject({ ok: false, status: 409, erro: MSG_OS_CANCELADA });
    comoAdmin();
    expect((await chamar("conversas/[osId]", "POST", { osId: "osF" }, { clientId: "f-1", texto: "Garantia: o cliente ligou de novo." })).status).toBe(201);
    comoTecnico();
    expect((await chamar("tecnico/conversas", "GET")).json.conversas.map((c: any) => c.osId)).toContain("osF");
  });

  it("permissões: sem editar OS não escreve (403); técnico na rota do escritório (403); \"Ver só os próprios\" e outra empresa não veem", async () => {
    comoLeitor();
    expect((await chamar("conversas/[osId]", "GET", { osId: "os1" })).status).toBe(200);
    expect((await chamar("conversas/[osId]", "POST", { osId: "os1" }, { clientId: "l-1", texto: "oi" })).status).toBe(403);
    comoTecnico();
    expect((await chamar("conversas", "GET")).status).toBe(403);
    comoVendedor();
    expect((await chamar("conversas", "GET")).json.conversas.map((c: any) => c.osId)).toEqual([]);
    expect((await chamar("conversas/[osId]", "GET", { osId: "os1" })).status).toBe(404);
    expect((await chamar("conversas/[osId]", "POST", { osId: "os1" }, { clientId: "v-1", texto: "oi" })).status).toBe(404);
    expect((await chamar("conversas/[osId]", "POST", { osId: "osV" }, { clientId: "v-2", texto: "Combinado com o cliente." })).status).toBe(201);
    expect((await chamar("conversas", "GET")).json.conversas.map((c: any) => c.osId)).toEqual(["osV"]);
    como({ ...user("uX"), empresaId: "e2" });
    expect((await chamar("conversas", "GET")).json.conversas).toEqual([]);
    expect((await chamar("conversas/[osId]", "GET", { osId: "os1" })).status).toBe(404);
    expect((await chamar("conversas/[osId]", "POST", { osId: "os1" }, { clientId: "x-1", texto: "oi" })).status).toBe(404);
  });

  it("busca: acha pelo cliente e oferece começar a conversa nas OS que ainda não têm", async () => {
    comoAdmin();
    const r = await chamar("conversas", "GET", {}, undefined, "?busca=OS-0002");
    expect(r.json.conversas).toEqual([]);
    expect(r.json.semConversa).toEqual([{ osId: "os2", osNumero: "OS-0002", cliente: "Hospital Fictício" }]);
    // a conversa de uma OS sem mensagem abre vazia (para começar)
    const v = await chamar("conversas/[osId]", "GET", { osId: "os2" });
    expect([v.status, v.json.mensagens]).toEqual([200, []]);
  });

  it("tempo real: a marca muda com mensagem nova e com leitura nova; o técnico só sente as OS dele", async () => {
    comoAdmin();
    const m0 = (await chamar("conversas/novidades", "GET")).json;
    expect(m0.mudou).toBe(false);
    expect(typeof m0.naoLidas).toBe("number");
    comoTecnico();
    const t0 = (await chamar("tecnico/conversas/novidades", "GET")).json.marca;
    // mensagem nova numa OS da Maria: o escritório sente; o João, não (a marca dele não mexe)
    await sync([mensagem("a2", { clientId: "maria-1", texto: "Na portaria." })], () => comoTecnico("uT2", "t2", "maria@clima.test"));
    comoAdmin();
    const m1 = await chamar("conversas/novidades", "GET", {}, undefined, `?desde=${m0.marca}`);
    expect(m1.json).toMatchObject({ mudou: true });
    comoTecnico();
    expect((await chamar("tecnico/conversas/novidades", "GET")).json.marca).toBe(t0);
    // leitura nova (o ✓✓): também muda a marca
    comoAdmin();
    await chamar("conversas/[osId]", "GET", { osId: "os2" });
    const m2 = await chamar("conversas/novidades", "GET", {}, undefined, `?desde=${m1.json.marca}`);
    expect(m2.json.mudou).toBe(true);
  });

  it("push: o técnico recebe o endereço da conversa no app; o escritório ligado à OS, o da tela Conversas", async () => {
    const { notificarComentarioOS } = await import("@/lib/push/eventos");
    push.envios = []; push.comAparelho = ["uA", "uT", "uL"];
    await notificarComentarioOS("os1", "uL", { comentarioId: "x", texto: "Teste" });
    const [app, escritorio] = push.envios;
    expect(app.usuarios).toEqual(["uT"]);
    expect(app.mensagem({ restrito: true }).url).toBe("/tecnico?ver=chat&os=os1");
    expect(app.mensagem({ restrito: false }).url).toBe("/conversas?os=os1");
    expect(app.mensagem({ restrito: true })).toMatchObject({ titulo: "Mensagem nova na OS OS-0001", acao: "Abrir conversa" });
    expect(escritorio.usuarios).toEqual(["uA"]); // ligado à OS (abriu e conversou); o autor (uL) não
    expect(escritorio.mensagem.url).toBe("/conversas?os=os1");
  });
});
