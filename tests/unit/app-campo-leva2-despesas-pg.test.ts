/**
 * App de campo, leva 2 (PR B) — DESPESAS DE CAMPO com rotas reais, Prisma real, PostgreSQL real:
 *  - o técnico lança pela fila (com ou sem OS; idempotente; só nas OS dele; dia e foto validados; permissão da empresa;
 *    usuário sem colaborador não lança) e vê SÓ as próprias (sem custo da OS);
 *  - a foto do cupom: o colaborador vê a dele; o escritório vê qualquer uma da empresa;
 *  - o escritório aprova (do bolso → UMA conta a pagar de reembolso ao colaborador, mesmo com dois cliques; pela
 *    empresa → só registra) ou recusa (motivo obrigatório); categoria financeira (de mesmo nome, criada, ligada pela
 *    empresa ou escolhida na hora); reembolsada quando a conta é paga;
 *  - as despesas da OS (o custo na OS), o sino (quem lança contas a pagar) e as permissões.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/app-campo-leva2-despesas-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextRequest } from "next/server";
import { PRESETS, montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { chaveHojeBR, inicioHojeBR } from "@/lib/fuso";
import { MSG_DESPESAS_DESLIGADAS, MSG_SEM_COLABORADOR, SEM_OS } from "@/lib/tecnico/despesas";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_app_campo_l2b_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
vi.setConfig({ testTimeout: 60_000 });

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
const comoTecnico = (tecnicoId: string | null = "t1", id = "uT", email = "joao@clima.com") => {
  sessao.atual = { user: { id, name: "João", email, empresaId: "e1", role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId } };
};
const comoEscritorio = (permissoes: Permissoes = permissoesTotais(), id = "uA", empresaId = "e1") => {
  sessao.atual = { user: { id, name: "Ana", email: `${id}@clima.com`, empresaId, role: "OPERADOR", permissoes, tecnicoId: null } };
};
async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown, query = "") {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`http://localhost/api/x${query}`, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  const tipo = res.headers.get("content-type") ?? "";
  return { status: res.status, tipo, json: tipo.includes("json") ? await res.json().catch(() => null) : null };
}
const FOTO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const HOJE = chaveHojeBR();
const despesa = (atividadeId: string, clientId: string, extra: Record<string, unknown> = {}) => ({
  id: randomUUID(), tipo: "despesa", atividadeId, em: new Date().toISOString(),
  dados: { clientId, categoria: "COMBUSTIVEL", valor: 187.4, data: HOJE, pagamento: "PROPRIO", foto: FOTO, ...extra },
});
const sync = async (operacoes: unknown[]) => (await chamar("tecnico/sync", "POST", {}, { operacoes })).json.resultados as any[];
const H = 3_600_000;

describe.skipIf(!URL_PG)("app de campo, leva 2 (PR B): despesas de campo (PostgreSQL real)", () => {
  let prisma: any;
  const hoje = inicioHojeBR();
  const minhas = async () => (await chamar("tecnico/despesas", "GET")).json;
  const idDe = async (clientId: string) => (await prisma.despesaCampo.findFirst({ where: { clientId }, select: { id: true } })).id as string;
  const aprovar = (id: string, corpo: unknown = {}) => chamar("despesas-campo/[id]/aprovar", "POST", { id }, corpo);
  const recusar = (id: string, corpo: unknown) => chamar("despesas-campo/[id]/recusar", "POST", { id }, corpo);

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all([
      "tecnico/sync", "tecnico/despesas", "tecnico/despesas/[id]/foto", "despesas-campo", "despesas-campo/[id]/foto", "despesas-campo/[id]/aprovar",
      "despesas-campo/[id]/recusar", "despesas-campo/categorias", "ordens/[id]/despesas-campo", "alertas",
    ].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));
    await prisma.empresa.createMany({ data: [{ id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" }, { id: "e2", nome: "Outra", cnpj: "98.765.432/0001-10", email: "o@x.com" }] });
    await prisma.configuracao.create({ data: { empresaId: "e1" } });
    await prisma.usuario.createMany({ data: [
      { id: "uT", empresaId: "e1", nome: "João Silva", email: "joao@clima.com", senha: "x", role: "TECNICO" },
      { id: "uT2", empresaId: "e1", nome: "Maria Souza", email: "maria@clima.com", senha: "x", role: "TECNICO" },
      { id: "uX", empresaId: "e1", nome: "Sem colaborador", email: "solto@clima.com", senha: "x", role: "TECNICO" },
      { id: "uA", empresaId: "e1", nome: "Ana Escritório", email: "uA@clima.com", senha: "x" },
      { id: "uE2", empresaId: "e2", nome: "Beto", email: "b@x.com", senha: "x" },
    ] });
    await prisma.tecnico.createMany({ data: [
      { id: "t1", empresaId: "e1", nome: "João Silva", cpf: "1", telefone: "1", email: "joao@clima.com" },
      { id: "t2", empresaId: "e1", nome: "Maria Souza", cpf: "2", telefone: "2", email: "maria@clima.com" },
    ] });
    await prisma.cliente.create({ data: { id: "c1", empresaId: "e1", nome: "Hospital", cpfCnpj: "1" } });
    await prisma.unidade.create({ data: { id: "un1", empresaId: "e1", clienteId: "c1", nome: "Matriz" } });
    const os = (id: string, numero: string) => ({ id, empresaId: "e1", numero, clienteId: "c1", unidadeId: "un1", criadoPorId: "uA", descricao: "Preventiva" });
    await prisma.ordemServico.createMany({ data: [os("osA", "OS-1"), os("osM", "OS-2"), os("osC", "OS-3")] });
    await prisma.atividadeOs.createMany({ data: [
      { id: "aA", empresaId: "e1", ordemServicoId: "osA", titulo: "Preventiva", tecnicoId: "t1", dataAgendada: new Date(hoje.getTime() + 9 * H), status: "EM_ANDAMENTO" },
      { id: "aM", empresaId: "e1", ordemServicoId: "osM", titulo: "Da Maria", tecnicoId: "t2", dataAgendada: new Date(hoje.getTime() + 9 * H), status: "EM_ANDAMENTO" },
      { id: "aC", empresaId: "e1", ordemServicoId: "osC", titulo: "Concluída", tecnicoId: "t1", dataAgendada: new Date(hoje.getTime() + 8 * H), status: "CONCLUIDA" },
    ] });
    await prisma.categoriaFinanceira.createMany({ data: [
      { id: "cfV", empresaId: "e1", nome: "Veículos" }, { id: "cfEst", empresaId: "e1", nome: "ESTACIONAMENTO" }, { id: "cfX", empresaId: "e2", nome: "Da outra" },
    ] });
  }, 180_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  describe("o técnico lança pela fila", () => {
    it("sem OS: grava com o colaborador, sem OS, pendente e com a foto; reenviar ou repetir o clientId não duplica", async () => {
      comoTecnico();
      const o = despesa(SEM_OS, "d1", { descricao: "  Abastecimento da van  " });
      expect((await sync([o]))[0]).toMatchObject({ ok: true, status: 201 });
      expect((await sync([o]))[0]).toMatchObject({ ok: true, repetida: true });
      expect((await sync([despesa(SEM_OS, "d1", { valor: 999 })]))[0]).toMatchObject({ ok: true, status: 200 });
      await Promise.all([1, 2, 3].map(() => sync([despesa(SEM_OS, "d2", { categoria: "PEDAGIO", valor: 12.5, pagamento: "EMPRESA" })])));
      const l = await prisma.despesaCampo.findMany({ where: { clientId: { in: ["d1", "d2"] } }, orderBy: { clientId: "asc" }, include: { foto: true } });
      expect(l.map((d: any) => [d.clientId, d.tecnicoId, d.usuarioId, d.ordemServicoId, d.atividadeId, d.categoria, Number(d.valor), d.pagamento, d.status, d.descricao])).toEqual([
        ["d1", "t1", "uT", null, null, "COMBUSTIVEL", 187.4, "PROPRIO", "PENDENTE", "Abastecimento da van"],
        ["d2", "t1", "uT", null, null, "PEDAGIO", 12.5, "EMPRESA", "PENDENTE", null],
      ]);
      expect(l[0].foto.conteudo).toBe(FOTO);
    });
    it("da OS: liga à OS e à atividade (também com a atividade concluída); nunca na OS de outro técnico", async () => {
      comoTecnico();
      expect((await sync([despesa("aA", "d3", { categoria: "ESTACIONAMENTO", valor: 18, pagamento: "EMPRESA" })]))[0]).toMatchObject({ ok: true, status: 201 });
      expect((await sync([despesa("aC", "d4", { categoria: "ALIMENTACAO", valor: 35 })]))[0]).toMatchObject({ ok: true, status: 201 });
      expect((await sync([despesa("aM", "d5")]))[0]).toMatchObject({ ok: false, status: 403 });
      const d3 = await prisma.despesaCampo.findFirst({ where: { clientId: "d3" } });
      expect([d3.ordemServicoId, d3.atividadeId]).toEqual(["osA", "aA"]);
      expect(await prisma.despesaCampo.count({ where: { clientId: "d5" } })).toBe(0);
    });
    it("o servidor confere o dia, a foto e o formato; o mesmo clientId de outro colaborador é recusado", async () => {
      comoTecnico();
      const amanha = chaveHojeBR(1);
      expect((await sync([despesa(SEM_OS, "d6", { data: amanha })]))[0]).toMatchObject({ ok: false, status: 422 });
      expect((await sync([despesa(SEM_OS, "d7", { data: chaveHojeBR(-61) })]))[0]).toMatchObject({ ok: false, status: 422 });
      expect((await sync([despesa(SEM_OS, "d8", { foto: "data:image/png;base64,isto-nao-e-uma-imagem-de-verdade" })]))[0]).toMatchObject({ ok: false, status: 400 });
      expect((await sync([despesa(SEM_OS, "d9", { categoria: "OUTROS" })]))[0]).toMatchObject({ ok: false, status: 400 });
      comoTecnico("t2", "uT2", "maria@clima.com");
      expect((await sync([despesa(SEM_OS, "d1")]))[0]).toMatchObject({ ok: false, status: 409 });
      expect(await prisma.despesaCampo.count({ where: { clientId: { in: ["d6", "d7", "d8", "d9"] } } })).toBe(0);
    });
    it("a empresa desliga 'Lançar despesas pelo app': o app não lança; usuário sem colaborador também não", async () => {
      await prisma.configuracao.update({ where: { empresaId: "e1" }, data: { appLancarDespesas: false } });
      comoTecnico();
      expect((await sync([despesa(SEM_OS, "d10")]))[0]).toMatchObject({ ok: false, status: 403, erro: MSG_DESPESAS_DESLIGADAS });
      await prisma.configuracao.update({ where: { empresaId: "e1" }, data: { appLancarDespesas: true } });
      comoTecnico(null, "uX", "solto@clima.com");
      expect((await sync([despesa(SEM_OS, "d11")]))[0]).toMatchObject({ ok: false, status: 403, erro: MSG_SEM_COLABORADOR });
      expect(await minhas()).toEqual({ despesas: [], aviso: MSG_SEM_COLABORADOR });
      expect(await prisma.despesaCampo.count({ where: { clientId: { in: ["d10", "d11"] } } })).toBe(0);
    });
    it("colaborador ligado depois do login (sessão sem tecnicoId): acha pelo e-mail", async () => {
      comoTecnico(null);
      expect((await sync([despesa(SEM_OS, "d12", { valor: 9.9, categoria: "ALIMENTACAO" })]))[0]).toMatchObject({ ok: true, status: 201 });
      expect((await prisma.despesaCampo.findFirst({ where: { clientId: "d12" } })).tecnicoId).toBe("t1");
    });
  });

  describe("o técnico vê só as próprias", () => {
    it("'Minhas despesas': as do João, com a OS e a situação; nunca a da Maria, nem foto, nem custo da OS", async () => {
      comoTecnico("t2", "uT2", "maria@clima.com");
      await sync([despesa("aM", "dM", { categoria: "HOSPEDAGEM", valor: 220 })]);
      comoTecnico();
      const r = await minhas();
      expect(r.despesas.map((d: any) => d.clientId).sort()).toEqual(["d1", "d12", "d2", "d3", "d4"]);
      const d3 = r.despesas.find((d: any) => d.clientId === "d3");
      expect(d3).toEqual({ id: expect.any(String), clientId: "d3", categoria: "ESTACIONAMENTO", valor: 18, data: HOJE, pagamento: "EMPRESA", descricao: null, osNumero: "OS-1", situacao: "PENDENTE", motivoRecusa: null });
      expect(JSON.stringify(r)).not.toMatch(/data:image|contaPagar|custo/);
    });
    it("a foto: a própria sim; a da Maria não (não encontrada)", async () => {
      comoTecnico();
      const minha = await chamar("tecnico/despesas/[id]/foto", "GET", { id: await idDe("d1") });
      expect([minha.status, minha.tipo]).toEqual([200, "image/png"]);
      expect((await chamar("tecnico/despesas/[id]/foto", "GET", { id: await idDe("dM") })).status).toBe(404);
    });
    it("o modo técnico não usa as rotas do escritório", async () => {
      comoTecnico();
      expect((await chamar("despesas-campo", "GET")).status).toBe(403);
      expect((await chamar("despesas-campo/[id]/foto", "GET", { id: await idDe("dM") })).status).toBe(403);
      expect((await aprovar(await idDe("d1"), { vencimento: HOJE })).status).toBe(403);
      expect((await recusar(await idDe("d1"), { motivo: "Eu mesmo" })).status).toBe(403);
      expect((await chamar("ordens/[id]/despesas-campo", "GET", { id: "osA" })).status).toBe(403);
      expect((await chamar("alertas", "GET")).json.despesasCampo).toBe(0);
    });
  });

  describe("o escritório decide", () => {
    it("lista as pendentes (padrão) com colaborador e OS, sem foto; o sino conta para quem lança contas a pagar", async () => {
      comoEscritorio();
      const r = await chamar("despesas-campo", "GET");
      expect(r.json.despesas).toHaveLength(6);
      const d3 = r.json.despesas.find((d: any) => d.categoria === "ESTACIONAMENTO");
      expect(d3).toMatchObject({ colaborador: "João Silva", categoriaNome: "Estacionamento", valor: 18, pagamento: "EMPRESA", os: { id: "osA", numero: "OS-1" }, status: "PENDENTE", contaPagar: null });
      expect(JSON.stringify(r.json)).not.toMatch(/data:image/);
      const foto = await chamar("despesas-campo/[id]/foto", "GET", { id: await idDe("dM") });
      expect(foto.status).toBe(200);
      expect((await chamar("alertas", "GET")).json.despesasCampo).toBe(6);
      comoEscritorio(montarPermissoes({ financeiro: ["visualizar"] } as never));
      expect((await chamar("alertas", "GET")).json.despesasCampo).toBe(0);
      expect((await chamar("despesas-campo", "GET")).status).toBe(200);
      expect((await aprovar(await idDe("d3"))).status).toBe(403);
      expect((await recusar(await idDe("d3"), { motivo: "Sem permissão" })).status).toBe(403);
      comoEscritorio(permissoesTotais(), "uE2", "e2");
      expect((await chamar("despesas-campo", "GET")).json.despesas).toEqual([]);
      expect((await aprovar(await idDe("d3"))).status).toBe(404);
      expect((await chamar("despesas-campo/[id]/foto", "GET", { id: await idDe("d3") })).status).toBe(404);
    });
    it("paga pela empresa: aprovar só registra (nenhuma conta a pagar)", async () => {
      comoEscritorio();
      const contas = await prisma.contaPagar.count();
      const r = await aprovar(await idDe("d3"));
      expect(r).toMatchObject({ status: 200, json: { contaPagarId: null } });
      const d = await prisma.despesaCampo.findFirst({ where: { clientId: "d3" } });
      expect([d.status, d.decididoPorId, !!d.decididoEm, d.contaPagarId]).toEqual(["APROVADA", "uA", true, null]);
      expect(await prisma.contaPagar.count()).toBe(contas);
    });
    it("do bolso: pede o vencimento; gera UMA conta a pagar de reembolso ao colaborador (dois cliques não geram duas)", async () => {
      comoEscritorio();
      const id = await idDe("d1");
      expect((await aprovar(id)).status).toBe(400);
      expect((await prisma.despesaCampo.findFirst({ where: { clientId: "d1" } })).status).toBe("PENDENTE");
      const venc = chaveHojeBR(7);
      const rs = await Promise.all([aprovar(id, { vencimento: venc }), aprovar(id, { vencimento: venc }), aprovar(id, { vencimento: venc })]);
      expect(rs.map((r) => r.status).sort()).toEqual([200, 409, 409]);
      const contas = await prisma.contaPagar.findMany({ where: { tecnicoId: "t1" } });
      expect(contas).toHaveLength(1);
      const c = contas[0];
      expect([c.fornecedor, c.tecnicoId, Number(c.valorTotal), Number(c.saldoRestante), Number(c.valorPago), c.status, c.dataVencimento.toISOString().slice(0, 10)])
        .toEqual(["João Silva", "t1", 187.4, 187.4, 0, "PENDENTE", venc]);
      expect(c.descricao).toBe(`Reembolso de despesa de campo: Combustível · ${HOJE.split("-").reverse().join("/")} · Abastecimento da van`);
      expect(c.numero).toMatch(/\S/);
      // Nenhuma categoria ligada nem de mesmo nome: criou "Combustível"
      expect((await prisma.categoriaFinanceira.findUnique({ where: { id: c.categoriaId } })).nome).toBe("Combustível");
      expect((await prisma.despesaCampo.findFirst({ where: { clientId: "d1" } })).contaPagarId).toBe(c.id);
      expect(await prisma.categoriaFinanceira.count({ where: { empresaId: "e1", nome: "Combustível" } })).toBe(1);
    });
    it("categorias: a de mesmo nome já existente; a ligada pela empresa; a escolhida na hora", async () => {
      comoEscritorio();
      // Alimentação: ligada a "Veículos" pela empresa (o padrão que a empresa trocou)
      expect((await chamar("despesas-campo/categorias", "PUT", {}, { mapa: { ALIMENTACAO: "cfX" } })).status).toBe(400); // de outra empresa
      expect((await chamar("despesas-campo/categorias", "PUT", {}, { mapa: { ALIMENTACAO: "cfV" } })).status).toBe(200);
      const tela = (await chamar("despesas-campo/categorias", "GET")).json;
      expect(tela.efetivas).toMatchObject({ ALIMENTACAO: "cfV", ESTACIONAMENTO: "cfEst", PEDAGIO: null });
      await aprovar(await idDe("d4"), { vencimento: HOJE });
      expect((await prisma.contaPagar.findFirst({ where: { despesaCampo: { clientId: "d4" } } })).categoriaId).toBe("cfV");
      // Escolhida só nesta aprovação (o padrão continua)
      await aprovar(await idDe("d12"), { vencimento: HOJE, categoriaId: "cfEst" });
      expect((await prisma.contaPagar.findFirst({ where: { despesaCampo: { clientId: "d12" } } })).categoriaId).toBe("cfEst");
      expect((await chamar("despesas-campo/categorias", "GET")).json.efetivas.ALIMENTACAO).toBe("cfV");
      // A de mesmo nome (sem diferença de maiúsculas): ESTACIONAMENTO
      comoTecnico();
      await sync([despesa(SEM_OS, "d13", { categoria: "ESTACIONAMENTO", valor: 7 })]);
      comoEscritorio();
      await aprovar(await idDe("d13"), { vencimento: HOJE });
      expect((await prisma.contaPagar.findFirst({ where: { despesaCampo: { clientId: "d13" } } })).categoriaId).toBe("cfEst");
    });
    it("recusar pede motivo; o colaborador lê o motivo; decidida não muda mais", async () => {
      comoEscritorio();
      const id = await idDe("dM");
      expect((await recusar(id, { motivo: "  " })).status).toBe(400);
      expect((await recusar(id, {})).status).toBe(400);
      expect((await recusar(id, { motivo: "  Cupom ilegível: tire outra foto.  " })).status).toBe(200);
      expect((await recusar(id, { motivo: "De novo" })).status).toBe(409);
      expect((await aprovar(id, { vencimento: HOJE })).status).toBe(409);
      expect(await prisma.contaPagar.count({ where: { tecnicoId: "t2" } })).toBe(0);
      comoTecnico("t2", "uT2", "maria@clima.com");
      expect((await minhas()).despesas).toEqual([expect.objectContaining({ clientId: "dM", situacao: "RECUSADA", motivoRecusa: "Cupom ilegível: tire outra foto." })]);
    });
    it("o colaborador vê 'Aprovada' e, com a conta paga, 'Reembolsada'; a paga pela empresa fica 'Aprovada'", async () => {
      comoTecnico();
      const sit = async () => Object.fromEntries((await minhas()).despesas.map((d: any) => [d.clientId, d.situacao]));
      expect(await sit()).toMatchObject({ d1: "APROVADA", d3: "APROVADA", d2: "PENDENTE" });
      await prisma.contaPagar.updateMany({ where: { despesaCampo: { clientId: "d1" } }, data: { status: "PAGO_TOTAL" } });
      expect(await sit()).toMatchObject({ d1: "REEMBOLSADA", d3: "APROVADA" });
    });
    it("filtros e as despesas da OS (o custo na OS); outra empresa não encontra a OS", async () => {
      comoEscritorio();
      const st = async (s: string) => (await chamar("despesas-campo", "GET", {}, undefined, `?status=${s}`)).json.despesas.length;
      expect([await st("PENDENTE"), await st("APROVADA"), await st("RECUSADA"), await st("TODAS"), await st("lixo")]).toEqual([1, 5, 1, 7, 1]);
      const os = await chamar("ordens/[id]/despesas-campo", "GET", { id: "osA" });
      expect(os.json.despesas.map((d: any) => [d.categoria, d.status])).toEqual([["ESTACIONAMENTO", "APROVADA"]]);
      expect((await chamar("ordens/[id]/despesas-campo", "GET", { id: "osM" })).json.despesas.map((d: any) => d.status)).toEqual(["RECUSADA"]);
      expect((await chamar("alertas", "GET")).json.despesasCampo).toBe(1);
      comoEscritorio(permissoesTotais(), "uE2", "e2");
      expect((await chamar("ordens/[id]/despesas-campo", "GET", { id: "osA" })).status).toBe(404);
    });
  });
});
