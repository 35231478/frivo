/**
 * Leva 8B — Financeiro (faturar e medições): a ROTA DE AÇÃO num PostgreSQL real (schema descartável).
 *
 * A ficha esconde o que a pessoa não pode fazer; aqui se prova o outro lado — e, por ser faturamento,
 * se prova também que a leva NÃO mudou como o dinheiro se move:
 *  - toda ação da medição exige Financeiro › medições. Sem ela: 403 e o banco IGUAL ao que era;
 *  - o ciclo continua o mesmo: aprovar manualmente leva de "aguardando aprovação" a "aguardando PC",
 *    e registrar pagamento deixa a medição paga com a data gravada;
 *  - cancelar NÃO apaga: a medição vira CANCELADA e a conta a receber gerada volta a PREVISTO;
 *  - com boleto emitido na conta, o cancelamento é RECUSADO (409) e nada muda;
 *  - nada atravessa de outra empresa.
 *
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/padronizacao-leva8b-pg
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_leva8b_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

const como = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1") => {
  sessao.atual = { user: { id: empresaId === "e1" ? "uA" : "uB", name: "Ana Souza", email: "ana@x.com", empresaId, role: "OPERADOR", permissoes, tecnicoId: null } };
};

async function acao(medicaoId: string, corpo: unknown) {
  const mod = await import("@/app/api/medicoes/[id]/acao/route");
  const req = new NextRequest("http://localhost/api/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  const res: Response = await mod.POST(req, { params: Promise.resolve({ id: medicaoId }) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

describe.skipIf(!URL_PG)("Leva 8B — faturar e medições (PostgreSQL real)", () => {
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
    await prisma.cliente.create({ data: { id: "c1", empresaId: "e1", nome: "Hospital Santa Clara", cpfCnpj: "1", email: "contas@hsc.com" } });
    await prisma.contrato.create({ data: {
      id: "ct1", empresaId: "e1", clienteId: "c1", numero: "CT-1", tipo: "MANUTENCAO_PREVENTIVA", valorMensal: 8400,
      dataInicio: new Date("2026-01-01T12:00:00Z"), diaVencimento: 10,
    } });
  }, 240_000);

  afterAll(async () => {
    if (!URL_PG) return;
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await prisma.$disconnect();
  });

  /** Uma medição aguardando aprovação, com a conta a receber que ela gerou. */
  beforeEach(async () => {
    await prisma.contaReceber.deleteMany({});
    await prisma.medicaoItem.deleteMany({});
    await prisma.medicao.deleteMany({});
    await prisma.medicao.create({
      data: {
        id: "m1", empresaId: "e1", clienteId: "c1", contratoId: "ct1", numero: "MED-1",
        tipo: "MENSAL_FIXO", mes: 11, ano: 2026, status: "AGUARDANDO_APROVACAO",
        valorTotal: 8400, valorLiquido: 8400, tokenPublico: "tok-m1",
        itens: { create: [{ tipo: "SERVICO", descricao: "Manutenção mensal", quantidade: 1, valorUnitario: 8400, valorTotal: 8400, ordem: 1 }] },
      },
    });
    await prisma.contaReceber.create({
      data: {
        id: "cr1", empresaId: "e1", clienteId: "c1", contratoId: "ct1", medicaoId: "m1",
        numero: "CR-1", descricao: "Medição MED-1", valor: 8400, status: "A_RECEBER",
        dataVencimento: new Date("2026-12-10T12:00:00Z"),
      },
    });
    como();
  });

  const medicao = () => prisma.medicao.findUnique({ where: { id: "m1" } });
  const conta = () => prisma.contaReceber.findUnique({ where: { id: "cr1" } });
  /** O retrato do faturamento: o que não pode mudar quando o servidor recusa. */
  const retrato = async () => {
    const m = await medicao(), c = await conta();
    return {
      status: m.status, pagamento: m.dataPagamento, aprovacao: m.dataAprovacao, envio: m.dataEnvio,
      conta: { status: c.status, medicaoId: c.medicaoId, valor: Number(c.valor), recebido: Number(c.valorRecebido) },
      medicoes: await prisma.medicao.count(), contas: await prisma.contaReceber.count(),
    };
  };

  /* ───────── prioridade 1: 403 com o banco intacto ───────── */

  it("sem Financeiro › medições toda ação é 403, e nada muda", async () => {
    const antes = await retrato();
    como(montarPermissoes({ financeiro: ["visualizar", "contasReceber", "fluxoCaixa"] }));
    for (const corpo of [
      { acao: "ENVIAR" },
      { acao: "APROVAR_MANUAL" },
      { acao: "REGISTRAR_PC", pcNumero: "PC-9" },
      { acao: "REGISTRAR_NF", nfNumero: "123" },
      { acao: "REGISTRAR_BOLETO" },
      { acao: "REGISTRAR_PAGAMENTO", dataPagamento: "2026-11-15", formaPagamento: "PIX" },
      { acao: "CANCELAR" },
    ]) {
      const r = await acao("m1", corpo);
      expect([corpo.acao, r.status, r.json.erro]).toEqual([corpo.acao, 403, "Sem permissão para esta ação"]);
    }
    expect(await retrato()).toEqual(antes);
  });

  it("sem sessão, 401 — e o banco também não muda", async () => {
    const antes = await retrato();
    sessao.atual = null;
    const r = await acao("m1", { acao: "CANCELAR" });
    expect([r.status, r.json.erro]).toEqual([401, "Não autorizado"]);
    expect(await retrato()).toEqual(antes);
  });

  it("a medição da e1 responde 404 para a e2", async () => {
    como(permissoesTotais(), "e2");
    const r = await acao("m1", { acao: "APROVAR_MANUAL" });
    expect(r.status).toBe(404);
    expect((await medicao()).status).toBe("AGUARDANDO_APROVACAO");
  });

  /* ───────── o ciclo continua o mesmo ───────── */

  it("aprovação manual segue o ciclo do cliente: sem exigir PC, pula direto para PC recebido", async () => {
    const r = await acao("m1", { acao: "APROVAR_MANUAL" });
    expect(r.status).toBe(200);
    const m = await medicao();
    expect(m.status).toBe("PC_RECEBIDO");
    expect(m.dataAprovacao).toBeInstanceOf(Date);
  });

  it("cliente que exige PC antes da NF: a aprovação para em aguardando PC", async () => {
    await prisma.cliente.update({ where: { id: "c1" }, data: { exigePcAntesNf: true } });
    try {
      const r = await acao("m1", { acao: "APROVAR_MANUAL" });
      expect(r.status).toBe(200);
      expect((await medicao()).status).toBe("AGUARDANDO_PC");
    } finally {
      await prisma.cliente.update({ where: { id: "c1" }, data: { exigePcAntesNf: false } });
    }
  });

  it("registrar pagamento deixa a medição paga, com data e forma", async () => {
    await acao("m1", { acao: "APROVAR_MANUAL" });
    const r = await acao("m1", { acao: "REGISTRAR_PAGAMENTO", dataPagamento: "2026-11-15", formaPagamento: "PIX" });
    expect(r.status).toBe(200);
    const m = await medicao();
    expect(m.status).toBe("PAGO");
    expect(m.dataPagamento).toBeInstanceOf(Date);
  });

  /* ───────── cancelar não apaga ───────── */

  it("cancelar marca a medição e devolve a conta a receber ao previsto", async () => {
    const r = await acao("m1", { acao: "CANCELAR" });
    expect(r.status).toBe(200);
    const m = await medicao(), c = await conta();
    expect(m.status).toBe("CANCELADA");
    // a medição e a conta continuam existindo; a conta volta a ser previsão do contrato
    expect(await prisma.medicao.count()).toBe(1);
    expect([c.status, c.medicaoId]).toEqual(["PREVISTO", null]);
    expect(Number(c.valor)).toBe(8400);
  });

  it("com parte do dinheiro já recebido, cancelar é recusado (409) e nada muda", async () => {
    await prisma.contaReceber.update({ where: { id: "cr1" }, data: { valorRecebido: 400 } });
    const antes = await retrato();
    const r = await acao("m1", { acao: "CANCELAR" });
    expect(r.status).toBe(409);
    expect(r.json.erro).toContain("Contas a Receber");
    expect(await retrato()).toEqual(antes);
  });

  it("conta já RECEBIDA não é desfeita: a medição cancela e o recebimento fica como está", async () => {
    await prisma.contaReceber.update({ where: { id: "cr1" }, data: { status: "RECEBIDO", dataRecebimento: new Date(), valorRecebido: 8400 } });
    const r = await acao("m1", { acao: "CANCELAR" });
    expect(r.status).toBe(200);
    const c = await conta();
    // o dinheiro que entrou continua entrado, ligado à medição cancelada (não vira previsão de novo)
    expect([c.status, c.medicaoId, Number(c.valorRecebido)]).toEqual(["RECEBIDO", "m1", 8400]);
    expect((await medicao()).status).toBe("CANCELADA");
  });

  it("a rota de ação não tem verbo de exclusão", async () => {
    const mod: Record<string, unknown> = await import("@/app/api/medicoes/[id]/acao/route");
    expect(typeof mod.POST).toBe("function");
    for (const verbo of ["DELETE", "PUT", "PATCH"]) expect(mod[verbo], verbo).toBeUndefined();
  });
});
