/**
 * Leva 8A — Financeiro (pagar e receber): as ROTAS num PostgreSQL real (schema descartável).
 *
 * A tela esconde o que a pessoa não pode fazer; aqui se prova o outro lado — e, por ser dinheiro,
 * se prova também que a leva NÃO mudou como o dinheiro se move:
 *  - registrar pagamento, editar, cancelar e criar conta exigem Financeiro › fluxo de caixa; criar
 *    cobrança exige Financeiro › contas a receber. Sem a permissão: 403 e o banco IGUAL ao que era;
 *  - pagamento parcial continua descontando do saldo e deixando a conta em aberto pelo que falta;
 *    o pagamento que fecha a conta a deixa paga. Conta cancelada não aceita pagamento;
 *  - cancelar NÃO apaga: a conta vira CANCELADO e os pagamentos já feitos continuam lá;
 *  - não existe rota para apagar conta nem pagamento;
 *  - nada atravessa de outra empresa.
 *
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/padronizacao-leva8a-pg
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_leva8a_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

const como = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1") => {
  sessao.atual = { user: { id: empresaId === "e1" ? "uA" : "uB", name: "Ana Souza", email: "ana@x.com", empresaId, role: "OPERADOR", permissoes, tecnicoId: null } };
};
const req = (corpo: unknown, metodo = "POST") =>
  new NextRequest("http://localhost/api/x", { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });

async function pagar(contaId: string, corpo: unknown) {
  const mod = await import("@/app/api/contas-pagar/[id]/pagamentos/route");
  const res: Response = await mod.POST(req(corpo), { params: Promise.resolve({ id: contaId }) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function editarConta(contaId: string, corpo: unknown) {
  const mod = await import("@/app/api/contas-pagar/[id]/route");
  const res: Response = await mod.PUT(req(corpo, "PUT"), { params: Promise.resolve({ id: contaId }) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function cancelarConta(contaId: string) {
  const mod = await import("@/app/api/contas-pagar/[id]/route");
  const res: Response = await mod.DELETE(req(undefined, "DELETE"), { params: Promise.resolve({ id: contaId }) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function criarConta(corpo: unknown) {
  const mod = await import("@/app/api/contas-pagar/route");
  const res: Response = await mod.POST(req(corpo));
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function criarCobranca(corpo: unknown) {
  const mod = await import("@/app/api/contas-receber/route");
  const res: Response = await mod.POST(req(corpo));
  return { status: res.status, json: await res.json().catch(() => null) };
}

describe.skipIf(!URL_PG)("Leva 8A — Financeiro (PostgreSQL real)", () => {
  let prisma: any;

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
      { id: "uA", empresaId: "e1", nome: "Ana Souza", email: "ana@x.com", senha: "x" },
      { id: "uB", empresaId: "e2", nome: "Beto", email: "beto@x.com", senha: "x" },
    ] });
    await prisma.cliente.create({ data: { id: "c1", empresaId: "e1", nome: "Hospital Santa Clara", cpfCnpj: "1" } });
    await prisma.fornecedor.createMany({ data: [
      { id: "f1", empresaId: "e1", nome: "Clima Peças", documento: "11222333000144" },
      { id: "fE2", empresaId: "e2", nome: "Fornecedor da outra", documento: "99888777000166" },
    ] });
  }, 240_000);

  afterAll(async () => {
    if (!URL_PG) return;
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.pagamentoContaPagar.deleteMany({});
    await prisma.contaPagar.deleteMany({});
    await prisma.contaReceber.deleteMany({});
    await prisma.contaPagar.create({
      data: {
        id: "cp1", empresaId: "e1", numero: "CP-1", fornecedorId: "f1", fornecedor: "Clima Peças",
        descricao: "Filtros G4", valorTotal: 1000, valorPago: 0, saldoRestante: 1000,
        status: "PENDENTE", dataVencimento: new Date("2026-12-10T12:00:00Z"),
      },
    });
    como();
  });

  const conta = (id = "cp1") => prisma.contaPagar.findUnique({ where: { id } });
  const pagamentos = (id = "cp1") => prisma.pagamentoContaPagar.findMany({ where: { contaPagarId: id }, orderBy: { criadoEm: "asc" } });
  /** O retrato do dinheiro: o que não pode mudar quando o servidor recusa. */
  const retrato = async () => {
    const c = await conta();
    return {
      status: c.status, total: Number(c.valorTotal), pago: Number(c.valorPago), saldo: Number(c.saldoRestante),
      descricao: c.descricao, pagamentos: (await pagamentos()).length,
      contas: await prisma.contaPagar.count(), receber: await prisma.contaReceber.count(),
    };
  };

  /* ───────── prioridade 1: 403 com o banco intacto ───────── */

  it("registrar pagamento sem Financeiro › fluxo de caixa é 403, e nada é pago", async () => {
    const antes = await retrato();
    como(montarPermissoes({ financeiro: ["visualizar", "contasReceber"] }));
    const r = await pagar("cp1", { valor: 400, dataPagamento: "2026-11-15" });
    expect([r.status, r.json.erro]).toEqual([403, "Sem permissão para esta ação"]);
    expect(await retrato()).toEqual(antes);
  });

  it("editar conta sem a permissão é 403, e a conta fica como estava", async () => {
    const antes = await retrato();
    como(montarPermissoes({ financeiro: ["visualizar"] }));
    const r = await editarConta("cp1", { descricao: "Mexido", valorTotal: 5000 });
    expect(r.status).toBe(403);
    expect(await retrato()).toEqual(antes);
  });

  it("cancelar conta sem a permissão é 403, e a conta continua em aberto", async () => {
    const antes = await retrato();
    como(montarPermissoes({ financeiro: ["visualizar"] }));
    const r = await cancelarConta("cp1");
    expect(r.status).toBe(403);
    expect((await conta()).status).toBe("PENDENTE");
    expect(await retrato()).toEqual(antes);
  });

  it("criar conta a pagar sem a permissão é 403, e nenhuma conta entra", async () => {
    const antes = await retrato();
    como(montarPermissoes({ financeiro: ["visualizar", "contasReceber"] }));
    const r = await criarConta({ fornecedorId: "f1", descricao: "Serviço", valorTotal: 300 });
    expect(r.status).toBe(403);
    expect(await retrato()).toEqual(antes);
  });

  it("criar cobrança sem Financeiro › contas a receber é 403, e nenhuma cobrança entra", async () => {
    const antes = await retrato();
    como(montarPermissoes({ financeiro: ["visualizar", "fluxoCaixa"] }));
    const r = await criarCobranca({ clienteId: "c1", descricao: "Serviço avulso", valor: 500, dataVencimento: "2026-12-20" });
    expect(r.status).toBe(403);
    expect(await retrato()).toEqual(antes);
  });

  it("sem sessão nenhuma das rotas de dinheiro responde (401)", async () => {
    sessao.atual = null;
    for (const r of [await pagar("cp1", { valor: 10, dataPagamento: "2026-11-15" }), await cancelarConta("cp1"), await criarConta({})]) {
      expect(r.status).toBe(401);
    }
    expect((await conta()).status).toBe("PENDENTE");
  });

  it("nada atravessa de outra empresa: a conta da e1 responde 404 para a e2", async () => {
    como(permissoesTotais(), "e2");
    expect((await pagar("cp1", { valor: 100, dataPagamento: "2026-11-15" })).status).toBe(404);
    expect((await cancelarConta("cp1")).status).toBe(404);
    expect((await conta()).status).toBe("PENDENTE");
    expect(await pagamentos()).toHaveLength(0);
  });

  /* ───────── a lógica do dinheiro continua a mesma ───────── */

  it("pagamento parcial desconta do saldo e a conta segue em aberto pelo que falta", async () => {
    const r = await pagar("cp1", { valor: 400, dataPagamento: "2026-11-15", formaPagamento: "PIX" });
    expect(r.status).toBe(201);
    const c = await conta();
    expect([Number(c.valorPago), Number(c.saldoRestante), c.status]).toEqual([400, 600, "PAGO_PARCIAL"]);
    expect(await pagamentos()).toHaveLength(1);
  });

  it("o pagamento que cobre o saldo quita a conta", async () => {
    await pagar("cp1", { valor: 400, dataPagamento: "2026-11-15" });
    await pagar("cp1", { valor: 600, dataPagamento: "2026-11-16" });
    const c = await conta();
    expect([Number(c.valorPago), Number(c.saldoRestante), c.status]).toEqual([1000, 0, "PAGO_TOTAL"]);
    expect(await pagamentos()).toHaveLength(2);
  });

  it("conta cancelada não aceita pagamento (400), e nada é lançado", async () => {
    await cancelarConta("cp1");
    const r = await pagar("cp1", { valor: 100, dataPagamento: "2026-11-15" });
    expect(r.status).toBe(400);
    expect(await pagamentos()).toHaveLength(0);
    expect(Number((await conta()).valorPago)).toBe(0);
  });

  /* ───────── conta é razão: cancelar não apaga ───────── */

  it("cancelar marca a conta e preserva o que já foi pago", async () => {
    await pagar("cp1", { valor: 400, dataPagamento: "2026-11-15" });
    const r = await cancelarConta("cp1");
    expect(r.status).toBe(200);
    const c = await conta();
    expect(c.status).toBe("CANCELADO");
    // a conta continua existindo, com o pagamento no histórico
    expect(Number(c.valorPago)).toBe(400);
    expect(await pagamentos()).toHaveLength(1);
    expect(await prisma.contaPagar.count()).toBe(1);
  });

  it("não existe rota para apagar conta nem pagamento", async () => {
    const pag: Record<string, unknown> = await import("@/app/api/contas-pagar/[id]/pagamentos/route");
    for (const verbo of ["DELETE", "PUT", "PATCH"]) expect(pag[verbo], verbo).toBeUndefined();
    const conta: Record<string, unknown> = await import("@/app/api/contas-pagar/[id]/route");
    expect(typeof conta.DELETE).toBe("function"); // é o CANCELAR, provado acima
    expect(conta.PATCH).toBeUndefined();
  });
});
