/**
 * HOTFIX do chat — o ✓✓ (lida) das mensagens do técnico, no PostgreSQL real e pelas rotas reais (dados fictícios):
 *  - o escritório abre a conversa POR PESSOA: as mensagens do técnico (com e sem OS) ficam lidas, e o tempo real do app
 *    muda (o app relê e mostra o ✓✓) — não só pela visão da OS;
 *  - quem já estava com a conversa aberta e RESPONDE: responder é ler — o ✓✓ vale também para o que chegou depois de
 *    abrir (antes ficava só ✓ até alguém reabrir); o mesmo para o técnico que responde ao escritório;
 *  - "Ver só os próprios": responder não marca como lida a mensagem de OS que a pessoa não vê.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/hotfix-chat-lida-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextRequest } from "next/server";
import { PRESETS, permissoesTotais } from "@/lib/permissoes";
import { SEM_OS } from "@/lib/tecnico/despesas";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_hfchat_${process.pid}`;
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
const comoAdmin = () => { sessao.atual = { user: { id: "uA", name: "uA", email: "uA@exemplo.test", empresaId: "e1", role: "ADMIN", permissoes: TOTAIS, tecnicoId: null } }; };
const comoVera = () => { sessao.atual = { user: { id: "uV", name: "uV", email: "uV@exemplo.test", empresaId: "e1", role: "OPERADOR", permissoes: { ...TOTAIS, ordens: { ...TOTAIS.ordens, verSoProprios: true } }, tecnicoId: null } }; };
const comoTecnico = () => { sessao.atual = { user: { id: "uT", name: "uT", email: "joao@exemplo.test", empresaId: "e1", role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId: "t1" } }; };

async function chamar(rota: string, metodo = "GET", params: Record<string, string> = {}, corpo?: unknown) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest("http://localhost/api/x", { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const sync = async (atividadeId: string, texto: string, clientId = randomUUID()) => {
  comoTecnico();
  const r = await chamar("tecnico/sync", "POST", {}, { operacoes: [{ id: randomUUID(), tipo: "comentario", atividadeId, em: new Date().toISOString(), dados: { clientId, texto } }] });
  expect(r.json.resultados[0].ok).toBe(true);
  return clientId;
};

describe.skipIf(!URL_PG)("HOTFIX: o ✓✓ das mensagens do técnico (PostgreSQL real)", () => {
  let prisma: any;
  const lida = async (clientId: string) => (await prisma.osComentario.findFirst({ where: { clientId }, select: { lidaEm: true, lidaPorId: true } }));

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(["tecnico/sync", "tecnico/conversas", "tecnico/conversas/novidades", "conversas/pessoas/[usuarioId]"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));
    await prisma.empresa.create({ data: { id: "e1", nome: "Empresa Exemplo", cnpj: "12.345.678/0001-90", email: "contato@exemplo.test" } });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana Souza", email: "uA@exemplo.test", senha: "x", role: "ADMIN" },
      { id: "uV", empresaId: "e1", nome: "Vera Lima", email: "uV@exemplo.test", senha: "x", role: "OPERADOR" },
      { id: "uT", empresaId: "e1", nome: "João Silva", email: "joao@exemplo.test", senha: "x", role: "TECNICO" },
    ] });
    await prisma.tecnico.create({ data: { id: "t1", empresaId: "e1", nome: "João Silva", cpf: "1", telefone: "1", email: "joao@exemplo.test" } });
    await prisma.cliente.create({ data: { id: "c1", empresaId: "e1", nome: "Mercado Exemplo", cpfCnpj: "1" } });
    await prisma.ordemServico.createMany({ data: [
      { id: "os1", empresaId: "e1", numero: "OS-0101", clienteId: "c1", criadoPorId: "uA", descricao: "Manutenção" },
      { id: "osV", empresaId: "e1", numero: "OS-0102", clienteId: "c1", criadoPorId: "uV", descricao: "Da Vera" },
    ] });
    await prisma.atividadeOs.createMany({ data: [
      { id: "a1", empresaId: "e1", ordemServicoId: "os1", titulo: "Corretiva", tecnicoId: "t1", status: "EM_ANDAMENTO" },
      { id: "aV", empresaId: "e1", ordemServicoId: "osV", titulo: "Preventiva", tecnicoId: "t1", status: "AGENDADA" },
    ] });
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("o escritório abre a conversa POR PESSOA: com e sem OS ficam lidas; o tempo real do app muda e a conversa do app mostra ✓✓", async () => {
    const comOs = await sync("a1", "Cheguei no cliente.");
    const semOs = await sync(SEM_OS, "Chego em 10 minutos.");
    comoTecnico();
    const antes = (await chamar("tecnico/conversas/novidades")).json.marca as string;
    comoAdmin();
    expect((await chamar("conversas/pessoas/[usuarioId]", "GET", { usuarioId: "uT" })).status).toBe(200);
    expect(await lida(comOs)).toMatchObject({ lidaPorId: "uA" });
    expect(await lida(semOs)).toMatchObject({ lidaPorId: "uA" });
    comoTecnico();
    const depois = (await chamar("tecnico/conversas/novidades")).json.marca as string;
    // A 2ª parte da marca (a 1ª leitura mais nova) mudou: o app relê a conversa
    expect(depois.split(".")[1]).not.toBe(antes.split(".")[1]);
    const app = (await chamar("tecnico/conversas")).json.mensagens.filter((m: any) => [comOs, semOs].includes(m.clientId));
    expect(app.map((m: any) => m.lida?.por)).toEqual(["Ana Souza", "Ana Souza"]);
  });

  it("com a conversa já aberta, o escritório RESPONDE: o que o técnico mandou depois de abrir também fica lido", async () => {
    comoAdmin();
    await chamar("conversas/pessoas/[usuarioId]", "GET", { usuarioId: "uT" }); // abriu
    const depoisDeAbrir = await sync(SEM_OS, "Opa, o portão está fechado.");
    expect((await lida(depoisDeAbrir)).lidaEm).toBeNull();
    comoAdmin();
    expect((await chamar("conversas/pessoas/[usuarioId]", "POST", { usuarioId: "uT" }, { texto: "Liguei para a portaria." })).status).toBe(201);
    expect(await lida(depoisDeAbrir)).toMatchObject({ lidaPorId: "uA" });
  });

  it("o técnico responde: a mensagem do escritório fica lida por ele", async () => {
    comoAdmin();
    const r = await chamar("conversas/pessoas/[usuarioId]", "POST", { usuarioId: "uT" }, { texto: "Traz a nota da peça, por favor." });
    const doEscritorio = r.json.mensagem.clientId as string;
    expect((await lida(doEscritorio)).lidaEm).toBeNull();
    await sync(SEM_OS, "Combinado.");
    expect(await lida(doEscritorio)).toMatchObject({ lidaPorId: "uT" });
  });

  it("\"Ver só os próprios\": responder marca só o que a pessoa vê (a OS dela sim; a OS dos outros não)", async () => {
    const naOsDela = await sync("aV", "Filtro trocado.");
    const naOsDeOutro = await sync("a1", "Dreno limpo.");
    comoVera();
    expect((await chamar("conversas/pessoas/[usuarioId]", "POST", { usuarioId: "uT" }, { texto: "Obrigada." })).status).toBe(201);
    expect(await lida(naOsDela)).toMatchObject({ lidaPorId: "uV" });
    expect((await lida(naOsDeOutro)).lidaEm).toBeNull();
  });
});
