/**
 * Leva 7A — Estoque: as ROTAS num PostgreSQL real (schema descartável).
 *
 * A tela esconde o que a pessoa não pode fazer; aqui se prova o outro lado — com a requisição na
 * mão, o servidor RECUSA e o banco não muda — e o cuidado do razão:
 *
 *  - POST /api/estoque/[id]/movimentacoes exige Estoque › gerenciar (403 sem ela) e nada é lançado;
 *  - o razão não tem DELETE nem PUT: a correção é um movimento NOVO (ajuste/inventário), e o
 *    movimento anterior continua lá, intacto, com o saldo resultante de cada um;
 *  - POST .../separacao e .../devolucao exigem Estoque › separar — sem ela, 403, e material e saldo
 *    ficam exatamente como estavam;
 *  - nada atravessa de outra empresa.
 *
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/padronizacao-leva7a-pg
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_leva7a_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

const como = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1") => {
  sessao.atual = { user: { id: empresaId === "e1" ? "uA" : "uB", name: "Ana Souza", email: "ana@x.com", empresaId, role: "OPERADOR", permissoes, tecnicoId: null } };
};

const req = (corpo: unknown, metodo = "POST") =>
  new NextRequest("http://localhost/api/x", { method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });

async function lancar(produtoId: string, corpo: unknown) {
  const mod = await import("@/app/api/estoque/[produtoId]/movimentacoes/route");
  const res: Response = await mod.POST(req(corpo), { params: Promise.resolve({ produtoId }) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function separar(osId: string, materiais: { id: string; quantidade: number }[]) {
  const mod = await import("@/app/api/ordens/[id]/separacao/route");
  const res: Response = await mod.POST(req({ materiais }), { params: Promise.resolve({ id: osId }) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function devolver(osId: string, materiais: { id: string; quantidade: number }[]) {
  const mod = await import("@/app/api/ordens/[id]/devolucao/route");
  const res: Response = await mod.POST(req({ materiais }), { params: Promise.resolve({ id: osId }) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

describe.skipIf(!URL_PG)("Leva 7A — Estoque (PostgreSQL real)", () => {
  let prisma: any;

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    process.env.NEXTAUTH_SECRET ||= "segredo-de-teste-0123456789abcdef";
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    for (const m of [
      () => import("@/app/api/estoque/[produtoId]/movimentacoes/route"),
      () => import("@/app/api/ordens/[id]/separacao/route"),
      () => import("@/app/api/ordens/[id]/devolucao/route"),
    ]) await m();

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana Souza", email: "ana@x.com", senha: "x" },
      { id: "uB", empresaId: "e2", nome: "Beto", email: "beto@x.com", senha: "x" },
    ] });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital Santa Clara", cpfCnpj: "1" },
      { id: "cE2", empresaId: "e2", nome: "Outro cliente", cpfCnpj: "2" },
    ] });
  }, 240_000);

  afterAll(async () => {
    if (!URL_PG) return;
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.movimentacaoEstoque.deleteMany({});
    await prisma.osMaterial.deleteMany({});
    await prisma.osItemOrcamento.deleteMany({});
    await prisma.ordemServico.deleteMany({});
    await prisma.produto.deleteMany({});
    await prisma.produto.createMany({ data: [
      { id: "p1", empresaId: "e1", nome: "Filtro G4", unidade: "un", controlaEstoque: true, saldo: 0, estoqueMinimo: 4 },
      { id: "pE2", empresaId: "e2", nome: "Produto da outra", unidade: "un", controlaEstoque: true, saldo: 0 },
    ] });
    como();
  });

  const saldo = async (id = "p1") => Number((await prisma.produto.findUnique({ where: { id }, select: { saldo: true } })).saldo);
  const movimentos = (produtoId = "p1") => prisma.movimentacaoEstoque.findMany({ where: { produtoId }, orderBy: { criadoEm: "asc" } });

  /* ───── lançar movimento ───── */
  it("sem Estoque › gerenciar é 403 e nada é lançado", async () => {
    como(montarPermissoes({ estoque: ["visualizar", "separar"] }));
    const r = await lancar("p1", { operacao: "ENTRADA", quantidade: 10 });
    expect(r.status).toBe(403);
    expect(r.json.erro).toBe("Sem permissão para esta ação");
    expect(await movimentos()).toHaveLength(0);
    expect(await saldo()).toBe(0);
  });

  it("com a permissão, a entrada entra no razão e o saldo é a soma", async () => {
    const r = await lancar("p1", { operacao: "ENTRADA", quantidade: 10, custoUnitario: 38.5, observacao: "NF 10.482" });
    expect(r.status).toBe(201);
    const [mv] = await movimentos();
    expect([mv.tipo, Number(mv.quantidade), Number(mv.saldoApos)]).toEqual(["ENTRADA", 10, 10]);
    expect(mv.usuarioId).toBe("uA");
    expect(await saldo()).toBe(10);
  });

  /* ───── o cuidado do razão ───── */
  it("a rota não expõe apagar nem editar movimento", async () => {
    const mod: Record<string, unknown> = await import("@/app/api/estoque/[produtoId]/movimentacoes/route");
    expect(typeof mod.POST).toBe("function");
    for (const verbo of ["DELETE", "PUT", "PATCH"]) expect(mod[verbo], verbo).toBeUndefined();
  });

  it("corrigir é lançar AJUSTE: o movimento anterior fica intacto e o extrato guarda os dois", async () => {
    await lancar("p1", { operacao: "ENTRADA", quantidade: 10 });
    const [antes] = await movimentos();

    const r = await lancar("p1", { operacao: "AJUSTE", novoSaldo: 7, observacao: "contagem: 3 danificados" });
    expect(r.status).toBe(201);

    const todos = await movimentos();
    expect(todos).toHaveLength(2);
    // o primeiro não foi tocado
    expect([todos[0].id, Number(todos[0].quantidade), Number(todos[0].saldoApos)]).toEqual([antes.id, 10, 10]);
    // o segundo é a diferença para chegar ao saldo certo, com o motivo
    expect([todos[1].tipo, Number(todos[1].quantidade), Number(todos[1].saldoApos)]).toEqual(["AJUSTE", -3, 7]);
    expect(todos[1].observacao).toContain("danificados");
    expect(await saldo()).toBe(7);
  });

  it("inventário também é movimento novo (a contagem vira a diferença)", async () => {
    await lancar("p1", { operacao: "ENTRADA", quantidade: 5 });
    await lancar("p1", { operacao: "INVENTARIO", contagem: 8 });
    const todos = await movimentos();
    expect(todos).toHaveLength(2);
    expect([todos[1].tipo, Number(todos[1].quantidade), Number(todos[1].saldoApos)]).toEqual(["AJUSTE", 3, 8]);
    expect(todos[1].origem).toBe("INVENTARIO");
    expect(await saldo()).toBe(8);
  });

  it("produto de outra empresa não é movimentado (404) e o saldo dela não muda", async () => {
    const r = await lancar("pE2", { operacao: "ENTRADA", quantidade: 10 });
    expect(r.status).toBe(404);
    expect(await saldo("pE2")).toBe(0);
    expect(await movimentos("pE2")).toHaveLength(0);
  });

  /* ───── separação e devolução ───── */
  async function osComMaterial(estado: "a-separar" | "separado") {
    await prisma.ordemServico.create({ data: {
      id: "os1", empresaId: "e1", clienteId: "c1", numero: "OS-700", status: "AGENDADA",
      descricao: "Troca de filtros", criadoPorId: "uA",
      itensOrcamento: { create: [{ id: "it1", descricao: "Troca de filtros", quantidade: 1, valorUnitario: 0, valorTotal: 0, ordem: 0 }] },
    } });
    await prisma.osMaterial.create({ data: {
      id: "m1", ordemServicoId: "os1", osItemId: "it1", produtoId: "p1", descricao: "Filtro G4",
      unidade: "un", comportamento: "VENDA_A_PARTE", quantidade: 4, quantidadePadrao: 0,
      valorVendaUnit: 0, origem: "SOLTO", ordem: 0,
      ...(estado === "separado"
        ? { quantidadeSeparada: 4, estadoSeparacao: "SEPARADO", separadoEm: new Date(), separadoPorId: "uA" }
        : {}),
    } });
    await lancar("p1", { operacao: "ENTRADA", quantidade: 10 });
    if (estado === "separado") {
      await prisma.movimentacaoEstoque.create({ data: {
        empresaId: "e1", produtoId: "p1", tipo: "RESERVA", origem: "OS", quantidade: -4, saldoApos: 6, usuarioId: "uA",
      } });
      await prisma.produto.update({ where: { id: "p1" }, data: { saldo: 6 } });
    }
  }

  it("separar sem Estoque › separar é 403 — material e saldo ficam como estavam", async () => {
    await osComMaterial("a-separar");
    como(montarPermissoes({ estoque: ["visualizar", "gerenciar"], ordens: ["visualizar"] }));
    const antes = await saldo();
    const r = await separar("os1", [{ id: "m1", quantidade: 4 }]);
    expect(r.status).toBe(403);
    expect(r.json.erro).toBe("Sem permissão para esta ação");
    const m = await prisma.osMaterial.findUnique({ where: { id: "m1" } });
    expect(Number(m.quantidadeSeparada)).toBe(0);
    expect(m.estadoSeparacao).toBeNull();
    expect(await saldo()).toBe(antes);
  });

  it("com Estoque › separar, a reserva entra no razão e o saldo cai", async () => {
    await osComMaterial("a-separar");
    como(montarPermissoes({ estoque: ["separar"], ordens: ["visualizar"] }));
    const r = await separar("os1", [{ id: "m1", quantidade: 4 }]);
    expect(r.status).toBe(200);
    const m = await prisma.osMaterial.findUnique({ where: { id: "m1" } });
    expect(Number(m.quantidadeSeparada)).toBe(4);
    expect(await saldo()).toBe(6);
    const mv = await movimentos();
    expect(mv.at(-1).tipo).toBe("RESERVA");
    expect(Number(mv.at(-1).quantidade)).toBe(-4);
  });

  it("devolver sem Estoque › separar é 403 — nada volta ao estoque", async () => {
    await osComMaterial("separado");
    como(montarPermissoes({ estoque: ["visualizar", "gerenciar"], ordens: ["visualizar"] }));
    const antes = await saldo();
    const r = await devolver("os1", [{ id: "m1", quantidade: 4 }]);
    expect(r.status).toBe(403);
    expect(await saldo()).toBe(antes);
    const m = await prisma.osMaterial.findUnique({ where: { id: "m1" } });
    expect(Number(m.quantidadeDevolvida)).toBe(0);
  });

  it("a OS de outra empresa não é separada por quem não é dela", async () => {
    await osComMaterial("a-separar");
    como(permissoesTotais(), "e2");
    const r = await separar("os1", [{ id: "m1", quantidade: 4 }]);
    expect([403, 404]).toContain(r.status);
    const m = await prisma.osMaterial.findUnique({ where: { id: "m1" } });
    expect(Number(m.quantidadeSeparada)).toBe(0);
  });
});
