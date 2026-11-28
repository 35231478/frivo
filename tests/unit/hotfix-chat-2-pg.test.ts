/**
 * HOTFIX 2 do chat, no PostgreSQL REAL e pelas rotas reais (dados fictícios) — o teste do Zé no iPhone reproduzido:
 *  - o técnico com 3 OS no dia (uma direta em andamento, uma pela EQUIPE, uma de hoje ainda não iniciada) + a OS de
 *    OUTRO técnico em andamento na empresa: o seletor oferece exatamente as dele (a de outro NÃO aparece — antes um OR
 *    sobrescrito apagava o filtro do técnico) e TODA OS do seletor é aceita pela gravação (a mesma fonte);
 *  - o ponto "em andamento" em UMA OS só (a iniciada por último);
 *  - a recusa (a OS de outro técnico) diz o porquê e NÃO trava a fila: a seguinte da mesma atividade é processada;
 *  - o push: "Mensagem nova · OS-… · cliente", "Fulano: texto" e a mesma tag para a mesma conversa;
 *  - ✓✓ para trás: abrir a conversa marca como lidas as que o outro lado já tinha respondido.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/hotfix-chat-2-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextRequest } from "next/server";
import { PRESETS, permissoesTotais } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_hfchat2_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
vi.setConfig({ testTimeout: 60_000 });

const sessao = vi.hoisted(() => ({ atual: null as any }));
const push = vi.hoisted(() => ({ envios: [] as any[] }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (f: () => unknown) => { void f(); } }));
vi.mock("@/lib/push/servidor", async (orig) => ({
  ...(await orig<typeof import("@/lib/push/servidor")>()),
  usuariosComAparelho: vi.fn(async () => ["uA", "uT"]),
  enviarPush: vi.fn(async (p: any) => { push.envios.push(p); return { enviados: p.usuarios.length }; }),
}));

const TOTAIS = permissoesTotais();
const comoAdmin = () => { sessao.atual = { user: { id: "uA", name: "uA", email: "uA@exemplo.test", empresaId: "e1", role: "ADMIN", permissoes: TOTAIS, tecnicoId: null } }; };
const comoTecnico = () => { sessao.atual = { user: { id: "uT", name: "uT", email: "joao@exemplo.test", empresaId: "e1", role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId: "t1" } }; };

async function chamar(rota: string, metodo = "GET", params: Record<string, string> = {}, corpo?: unknown) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest("http://localhost/api/x", { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const op = (atividadeId: string, texto: string) => ({ id: randomUUID(), tipo: "comentario", atividadeId, em: new Date().toISOString(), dados: { clientId: randomUUID(), texto } });
const sync = async (ops: unknown[]) => { comoTecnico(); return (await chamar("tecnico/sync", "POST", {}, { operacoes: ops })).json.resultados as any[]; };
const esperarPush = () => new Promise((r) => setTimeout(r, 30));

describe.skipIf(!URL_PG)("HOTFIX 2: o seletor de OS e a gravação na mesma fonte (PostgreSQL real)", () => {
  let prisma: any;
  const agora = new Date();
  const horas = (h: number) => new Date(agora.getTime() + h * 3_600_000);

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(["tecnico/sync", "tecnico/conversas", "conversas/pessoas/[usuarioId]", "conversas/[osId]"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));
    await prisma.empresa.create({ data: { id: "e1", nome: "Empresa Exemplo", cnpj: "12.345.678/0001-90", email: "contato@exemplo.test" } });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana Souza", email: "uA@exemplo.test", senha: "x", role: "ADMIN" },
      { id: "uT", empresaId: "e1", nome: "João Silva", email: "joao@exemplo.test", senha: "x", role: "TECNICO" },
      { id: "uM", empresaId: "e1", nome: "Maria Lima", email: "maria@exemplo.test", senha: "x", role: "TECNICO" },
    ] });
    await prisma.tecnico.createMany({ data: [
      { id: "t1", empresaId: "e1", nome: "João Silva", cpf: "1", telefone: "1", email: "joao@exemplo.test" },
      { id: "t2", empresaId: "e1", nome: "Maria Lima", cpf: "2", telefone: "2", email: "maria@exemplo.test" },
    ] });
    await prisma.cliente.create({ data: { id: "c1", empresaId: "e1", nome: "Supermercado Exemplo de Bairro Ltda", nomeFantasia: "Mercado Exemplo", cpfCnpj: "1" } });
    const os = (id: string, numero: string) => ({ id, empresaId: "e1", numero, clienteId: "c1", criadoPorId: "uA", descricao: "Manutenção", status: "EM_ANDAMENTO" });
    await prisma.ordemServico.createMany({ data: [os("os40", "OS-4440"), os("os41", "OS-4441"), os("os42", "OS-4442"), os("os43", "OS-4443"), os("os44", "OS-4444"), os("os45", "OS-4445"), os("os46", "OS-4446"), os("os47", "OS-4447")] });
    await prisma.atividadeOs.createMany({ data: [
      // direta, em andamento, iniciada há 1 h
      { id: "a42", empresaId: "e1", ordemServicoId: "os42", titulo: "Corretiva", tecnicoId: "t1", status: "EM_ANDAMENTO", iniciadaEm: horas(-1), dataAgendada: horas(-2) },
      // pela EQUIPE (o responsável é a Maria), em andamento, iniciada há 10 min — a mais recente: o ponto
      { id: "a41", empresaId: "e1", ordemServicoId: "os41", titulo: "Preventiva em dupla", tecnicoId: "t2", status: "EM_ANDAMENTO", iniciadaEm: horas(-0.17), dataAgendada: horas(-1) },
      // de hoje, ainda não iniciada
      { id: "a40", empresaId: "e1", ordemServicoId: "os40", titulo: "Instalação", tecnicoId: "t1", status: "AGENDADA", dataAgendada: horas(0) },
      // de OUTRO técnico (só a Maria), em andamento: NÃO pode aparecer para o João
      { id: "a43", empresaId: "e1", ordemServicoId: "os43", titulo: "Da Maria", tecnicoId: "t2", status: "EM_ANDAMENTO", iniciadaEm: horas(-0.05), dataAgendada: horas(-1) },
      // dele, mas de outro dia e não iniciada: fora do seletor
      { id: "a44", empresaId: "e1", ordemServicoId: "os44", titulo: "Semana que vem", tecnicoId: "t1", status: "AGENDADA", dataAgendada: horas(24 * 7) },
      // o caso do print: OS do MESMO cliente, hoje, com a atividade SEM técnico — ele não a vê no dia: sem chip
      { id: "a45", empresaId: "e1", ordemServicoId: "os45", titulo: "Sem técnico", tecnicoId: null, status: "AGENDADA", dataAgendada: horas(0) },
      // OS do mesmo cliente com a atividade DELE (hoje) e outra da Maria em andamento: o chip sobe pela DELE
      { id: "a46j", empresaId: "e1", ordemServicoId: "os46", titulo: "Do João", tecnicoId: "t1", status: "AGENDADA", dataAgendada: horas(1) },
      { id: "a46m", empresaId: "e1", ordemServicoId: "os46", titulo: "Da Maria", tecnicoId: "t2", status: "EM_ANDAMENTO", iniciadaEm: horas(-0.01), dataAgendada: horas(-1) },
      // dele, em andamento e SEM data: está no Meu dia ("Começadas antes — falta concluir") e, portanto, no seletor
      { id: "a47", empresaId: "e1", ordemServicoId: "os47", titulo: "Sem data", tecnicoId: "t1", status: "EM_ANDAMENTO", iniciadaEm: horas(-5), dataAgendada: null },
    ] });
    await prisma.atividadeTecnico.create({ data: { atividadeId: "a41", tecnicoId: "t1" } });
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  it("o seletor oferece exatamente as OS do técnico (direta, pela equipe, de hoje); a de outro técnico NÃO; UM ponto só", async () => {
    comoTecnico();
    const r = (await chamar("tecnico/conversas")).json;
    expect(r.osDoDia.map((o: any) => o.numero).sort()).toEqual(["OS-4440", "OS-4441", "OS-4442", "OS-4446", "OS-4447"]);
    // a OS com atividade dele e de outra técnica: pela DELE, sem o ponto da outra
    expect(r.osDoDia.find((o: any) => o.numero === "OS-4446")).toMatchObject({ atividadeId: "a46j", emAndamento: false });
    expect(r.osDoDia.filter((o: any) => o.emAndamento).map((o: any) => o.numero)).toEqual(["OS-4441"]); // a iniciada por último
    expect(r.osDoDia[0].numero).toBe("OS-4441"); // e é a padrão
    expect(r.osPadrao).toBe("os41");
  });

  it("o seletor e o \"Meu dia\" são a MESMA fonte: as mesmas atividades; a sem técnico e as dos outros, em nenhum dos dois", async () => {
    const { meuDia } = await import("@/lib/tecnico/dia");
    const { osDoDiaDoTecnico } = await import("@/lib/chat/pessoas-servidor");
    const dia = await meuDia("e1", "t1", agora);
    const doDia = [...dia.atividades, ...dia.anteriores].map((c) => c.atividadeId).sort();
    expect(doDia).toEqual(["a40", "a41", "a42", "a46j", "a47"]);
    expect(dia.anteriores.map((c) => c.atividadeId)).toContain("a47"); // começada, falta concluir
    expect((await osDoDiaDoTecnico("e1", "t1", agora)).map((o) => o.atividadeId).sort()).toEqual(doDia);
  });

  it("TODA OS do seletor é aceita pela gravação, com a atividade que o seletor deu (a mesma fonte)", async () => {
    comoTecnico();
    const r = (await chamar("tecnico/conversas")).json;
    const res = await sync(r.osDoDia.map((o: any) => op(o.atividadeId, `Mensagem na ${o.numero}`)));
    expect(res.map((x) => x.ok)).toEqual(r.osDoDia.map(() => true));
    for (const o of r.osDoDia) expect(await prisma.osComentario.count({ where: { ordemServicoId: o.osId, texto: `Mensagem na ${o.numero}` } })).toBe(1);
  });

  it("a OS de outro técnico é recusada com o porquê; a recusa da mensagem NÃO trava a seguinte da mesma atividade", async () => {
    // (importado só agora: o módulo abre o banco, e o banco do teste só existe depois do beforeAll)
    const { MSG_FORA_DO_ESCOPO } = await import("@/lib/tecnico/escopo");
    const res = await sync([op("a43", "Primeira"), op("a43", "Segunda")]);
    expect(res[0]).toMatchObject({ ok: false, status: 403, erro: MSG_FORA_DO_ESCOPO });
    expect(res[1]).toMatchObject({ ok: false, status: 403 }); // processada (recusada pelo mesmo motivo), não "adiada"
    expect(res[1].adiada).toBeUndefined();
  });

  it("o push do escritório: \"Mensagem nova · OS-4442 · Mercado Exemplo\", \"João Silva: Opa\"; mesma conversa, mesma tag", async () => {
    push.envios = [];
    await sync([op("a42", "Opa")]);
    await esperarPush();
    const doEscritorio = push.envios.filter((e) => e.alcance === "escritorio").map((e) => (typeof e.mensagem === "function" ? e.mensagem({ restrito: false }) : e.mensagem));
    expect(doEscritorio.at(-1)).toMatchObject({ titulo: "Mensagem nova · OS-4442 · Mercado Exemplo", corpo: "João Silva: Opa", tag: "conversa-uT" });
    push.envios = [];
    await sync([op("a41", "Outra OS, mesma conversa")]);
    await sync([{ ...op("sem-os", "Sem OS"), atividadeId: "sem-os" }]);
    await esperarPush();
    const tags = push.envios.filter((e) => e.alcance === "escritorio").map((e) => (typeof e.mensagem === "function" ? e.mensagem({ restrito: false }) : e.mensagem));
    expect(tags.map((m) => m.tag)).toEqual(["conversa-uT", "conversa-uT"]); // o mesmo técnico: o mesmo aviso, atualizado
    expect(tags[1]).toMatchObject({ titulo: "Mensagem nova · João Silva", corpo: "João Silva: Sem OS" });
  });

  it("✓✓ para trás: as do técnico de antes da resposta do escritório ficam lidas ao abrir; a de depois, não", async () => {
    const base = Date.now() + 3_600_000;
    const msg = (id: string, origem: string, usuarioId: string, min: number) => ({
      id, clientId: id, empresaId: "e1", ordemServicoId: "os42", atividadeId: origem === "APP" ? "a42" : null, usuarioId, autorNome: usuarioId, origem, texto: id, criadoEm: new Date(base + min * 60_000),
    });
    await prisma.osComentario.createMany({ data: [msg("v1", "APP", "uT", 0), msg("v2", "APP", "uT", 3), msg("r1", "ESCRITORIO", "uA", 4), msg("v3", "APP", "uT", 29)] });
    // quem abre é o próprio técnico (o app dele): mesmo assim as respondidas ficam lidas pelo escritório
    comoTecnico();
    await chamar("tecnico/conversas");
    const lida = async (id: string) => prisma.osComentario.findFirst({ where: { id }, select: { lidaEm: true, lidaPorId: true } });
    expect(await lida("v1")).toEqual({ lidaEm: new Date(base + 4 * 60_000), lidaPorId: "uA" });
    expect(await lida("v2")).toEqual({ lidaEm: new Date(base + 4 * 60_000), lidaPorId: "uA" });
    expect((await lida("v3")).lidaEm).toBeNull(); // ainda sem resposta do escritório
    // e a resposta do escritório ficou lida pelo técnico, que escreveu depois dela
    expect(await lida("r1")).toMatchObject({ lidaPorId: "uT" });
  });

  it("a mensagem do chat INVÁLIDA (ex.: vazia) é recusada, mas não segura o serviço da mesma OS: o início sobe", async () => {
    const res = await sync([op("a40", ""), { id: randomUUID(), tipo: "iniciar", atividadeId: "a40", em: new Date().toISOString() }]);
    expect(res[0]).toMatchObject({ ok: false, status: 400 });
    expect(res[1]).toMatchObject({ ok: true });
    expect((await prisma.atividadeOs.findUnique({ where: { id: "a40" }, select: { status: true } })).status).toBe("EM_ANDAMENTO");
  });
});
