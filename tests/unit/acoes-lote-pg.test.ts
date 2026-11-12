/**
 * Ações em lote — rotas reais /api/contas-receber/lote e /api/contas-pagar/lote com o Prisma real num
 * PostgreSQL real (schema descartável via `prisma db push`):
 *  - marcar 5 com inelegíveis no meio: só as elegíveis recebem a ação; as outras voltam em `ignoradas`
 *    com o motivo da ação individual (recebida/paga, cancelada, boleto emitido, recebimento parcial…);
 *  - baixa pelo SALDO (a parcial quita o restante), com forma/conta bancária, recebimento + evento,
 *    status RECEBIDO/PAGO_TOTAL, e-mail de confirmação só das quitadas;
 *  - vencimento: data única ou empurrar N dias a partir do vencimento de cada uma (evento "Editada";
 *    em Contas a Pagar o status VENCIDO/PENDENTE acompanha a data nova);
 *  - cancelar: motivo obrigatório, evento "Cancelada (ação em lote)"; pagas/canceladas/com dinheiro ficam;
 *  - transação: se uma falhar no meio, NADA fica feito e a resposta avisa (500);
 *  - id de outra empresa = ignorada ("não encontrada"); sem a permissão da ação individual = 403;
 *  - pedido inválido = 400 sem tocar no banco.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/acoes-lote-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_acoes_lote_pg_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
const email = vi.hoisted(() => ({ enviarConfirmacaoPagamento: vi.fn(async (_id: string) => ({ ok: true })) }));
vi.mock("@/lib/email", () => ({ enviarConfirmacaoPagamento: email.enviarConfirmacaoPagamento, enviarBoleto: vi.fn(async () => {}) }));
// Para provar a transação: a baixa de uma conta marcada "explode" no meio do lote
const bomba = vi.hoisted(() => ({ ids: new Set<string>() }));
vi.mock("@/lib/financeiro/parcelas-server", async (original) => {
  const m = await original<typeof import("@/lib/financeiro/parcelas-server")>();
  return { ...m, registrarRecebimento: async (tx: any, p: any) => { if (bomba.ids.has(p.contaId)) throw new Error("boom"); return m.registrarRecebimento(tx, p); } };
});

const logar = (permissoes: Permissoes = permissoesTotais(), id = "u1", empresaId = "e1") => {
  sessao.atual = { user: { id, name: "Ana", email: `${id}@x.com`, empresaId, role: "OPERADOR", permissoes, tecnicoId: null } };
};
const sem = (acao: "contasReceber" | "fluxoCaixa") => { const p = permissoesTotais(); p.financeiro[acao] = false; return p; };

async function lote(lista: "receber" | "pagar", corpo: unknown) {
  const mod = await import(`@/app/api/contas-${lista}/lote/route`);
  const req = new NextRequest(`http://localhost/api/contas-${lista}/lote`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  const res = await mod.POST(req);
  return { status: res.status, json: await res.json() };
}
const dia = (s: string) => new Date(`${s}T00:00:00.000Z`);
vi.setConfig({ testTimeout: 60_000 });

describe.skipIf(!URL_PG)("Ações em lote (PostgreSQL real)", () => {
  let prisma: any;
  let n = 0;
  const cr = (dados: Record<string, unknown> = {}) => prisma.contaReceber.create({ data: {
    id: `cr${++n}`, empresaId: "e1", clienteId: "c1", numero: `CR-${n}`, descricao: "Serviço", valor: 1000, status: "A_RECEBER", dataVencimento: dia("2026-11-20"), ...dados,
  } });
  const cp = (dados: Record<string, unknown> = {}) => prisma.contaPagar.create({ data: {
    id: `cp${++n}`, empresaId: "e1", numero: `CP-${n}`, fornecedor: "Elétrica Central", descricao: "Peças", valorTotal: 1000, valorPago: 0, saldoRestante: 1000, status: "PENDENTE", dataVencimento: dia("2026-11-20"), ...dados,
  } });
  const eventos = async (id: string) => (await prisma.contaReceberEvento.findMany({ where: { contaReceberId: id }, orderBy: { criadoEm: "asc" } })).map((e: any) => [e.tipo, e.detalhe]);
  const venc = async (modelo: "contaReceber" | "contaPagar", id: string) => (await prisma[modelo].findUnique({ where: { id } })).dataVencimento?.toISOString().slice(0, 10) ?? null;

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all([import("@/app/api/contas-receber/lote/route"), import("@/app/api/contas-pagar/lote/route")]);
    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12345678000190", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "u1", empresaId: "e1", nome: "Ana", email: "a@x.com", senha: "x" },
    ] });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital Santa Luzia", cpfCnpj: "11222333000181" },
      { id: "cX", empresaId: "e2", nome: "Da outra", cpfCnpj: "11222333000343" },
    ] });
    await prisma.contaBancaria.createMany({ data: [
      { id: "cb1", empresaId: "e1", nome: "Inter PJ", banco: "Banco Inter (077)" },
      { id: "cbX", empresaId: "e2", nome: "Da outra" },
    ] });
    logar();
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  describe("Contas a Receber", () => {
    it("dar como recebido: 5 marcadas (1 já recebida) → 4 baixadas pelo saldo, com recebimento, evento, status e e-mail só das quitadas; a parcial quita o restante", async () => {
      const a = await cr(); const b = await cr({ valor: 500 }); const paga = await cr({ status: "RECEBIDO", valorRecebido: 1000, dataRecebimento: new Date() });
      const parcial = await cr({ valor: 800, valorRecebido: 300 }); const atrasada = await cr({ status: "ATRASADO", valor: 0.1, dataVencimento: dia("2026-10-01") });
      email.enviarConfirmacaoPagamento.mockClear();
      const r = await lote("receber", { acao: "baixar", ids: [a.id, b.id, paga.id, parcial.id, atrasada.id], data: "2026-11-05", formaPagamento: "PIX", contaBancariaId: "cb1" });
      expect(r.status).toBe(200);
      expect(r.json.resumo).toEqual({ pedidas: 5, feitas: 4, ignoradas: 1 });
      expect(r.json.ignoradas).toEqual([{ id: paga.id, numero: paga.numero, motivo: "Esta conta já foi recebida." }]);
      expect(r.json.feitas.map((f: any) => f.numero)).toEqual([a.numero, b.numero, parcial.numero, atrasada.numero]);
      expect(r.json.total).toBe(2000.1); // 1000 + 500 + 500 (o que faltava) + 0,10
      for (const c of [a, b, parcial, atrasada]) {
        const g = await prisma.contaReceber.findUnique({ where: { id: c.id }, include: { recebimentos: true } });
        expect(g.status).toBe("RECEBIDO");
        expect(Number(g.valorRecebido)).toBe(Number(c.valor));
        expect(g.dataRecebimento.toISOString().slice(0, 10)).toBe("2026-11-05");
        expect(g.formaPagamento).toBe("PIX");
        const rec = g.recebimentos.at(-1);
        expect(rec).toMatchObject({ contaBancariaId: "cb1", formaPagamento: "PIX", origem: "MANUAL", observacao: "Baixa em lote", usuarioId: "u1" });
        expect((await eventos(c.id)).at(-1)[0]).toBe("RECEBIDA");
      }
      expect(Number((await prisma.contaReceber.findUnique({ where: { id: parcial.id }, include: { recebimentos: true } })).recebimentos.at(-1).valor)).toBe(500);
      expect(email.enviarConfirmacaoPagamento.mock.calls.map((c) => c[0]).sort()).toEqual([a.id, b.id, parcial.id, atrasada.id].sort());
      // Repetir: todas já recebidas → 0 feitas, 4 ignoradas (+ a de antes), nada muda
      const r2 = await lote("receber", { acao: "baixar", ids: [a.id, b.id, paga.id], data: "2026-11-06" });
      expect(r2.json.resumo).toEqual({ pedidas: 3, feitas: 0, ignoradas: 3 });
    });

    it("conta bancária de outra empresa = 400 sem tocar em nada; id de outra empresa = ignorada", async () => {
      const a = await cr();
      const outra = await prisma.contaReceber.create({ data: { id: `crX${++n}`, empresaId: "e2", clienteId: "cX", numero: "CR-X", descricao: "x", valor: 10, status: "A_RECEBER" } });
      const r = await lote("receber", { acao: "baixar", ids: [a.id], data: "2026-11-05", contaBancariaId: "cbX" });
      expect(r.status).toBe(400);
      expect((await prisma.contaReceber.findUnique({ where: { id: a.id } })).status).toBe("A_RECEBER");
      const r2 = await lote("receber", { acao: "baixar", ids: [a.id, outra.id], data: "2026-11-05" });
      expect(r2.json.ignoradas).toEqual([{ id: outra.id, numero: outra.id, motivo: "Não encontrada (ou de outra empresa)." }]);
      expect(r2.json.feitas).toHaveLength(1);
      expect((await prisma.contaReceber.findUnique({ where: { id: outra.id } })).status).toBe("A_RECEBER");
    });

    it("alterar vencimento: data única para todas; empurrar 30 dias a partir de cada uma; recebida, cancelada e boleto emitido ficam; evento 'Editada' com antes → depois", async () => {
      const a = await cr(); const b = await cr({ dataVencimento: dia("2026-12-15") }); const paga = await cr({ status: "RECEBIDO", valorRecebido: 1000 });
      const cancelada = await cr({ status: "CANCELADO" }); const boleto = await cr({ boletoStatus: "EMITIDO" }); const semData = await cr({ dataVencimento: null });
      const ids = [a.id, b.id, paga.id, cancelada.id, boleto.id, semData.id];
      const r = await lote("receber", { acao: "vencimento", ids, vencimento: { modo: "dias", dias: 30 } });
      expect(r.status).toBe(200);
      expect(r.json.feitas.map((f: any) => [f.numero, f.detalhe])).toEqual([[a.numero, "Vencimento: 20/11/2026 → 20/12/2026"], [b.numero, "Vencimento: 15/12/2026 → 14/01/2027"]]);
      expect(r.json.ignoradas.map((i: any) => i.motivo)).toEqual(["Conta recebida.", "Conta cancelada.", "Boleto emitido: cancele o boleto para mudar.", "Sem vencimento: escolha uma data única."]);
      expect(await venc("contaReceber", a.id)).toBe("2026-12-20");
      expect(await venc("contaReceber", b.id)).toBe("2027-01-14");
      expect(await venc("contaReceber", boleto.id)).toBe("2026-11-20");
      expect((await eventos(a.id)).at(-1)).toEqual(["EDITADA", "Vencimento: 20/11/2026 → 20/12/2026 (ação em lote)"]);
      const r2 = await lote("receber", { acao: "vencimento", ids: [a.id, semData.id], vencimento: { modo: "data", data: "2027-02-10" } });
      expect(r2.json.resumo).toEqual({ pedidas: 2, feitas: 2, ignoradas: 0 });
      expect(await venc("contaReceber", a.id)).toBe("2027-02-10");
      expect(await venc("contaReceber", semData.id)).toBe("2027-02-10");
      expect((await eventos(semData.id)).at(-1)[1]).toBe("Vencimento: — → 10/02/2027 (ação em lote)");
    });

    it("cancelar: motivo obrigatório; as abertas viram CANCELADAS com evento; recebida, com recebimento parcial, com boleto e já cancelada ficam", async () => {
      const a = await cr(); const b = await cr({ status: "ATRASADO" }); const parcial = await cr({ valorRecebido: 100 });
      const paga = await cr({ status: "RECEBIDO", valorRecebido: 1000 }); const boleto = await cr({ boletoStatus: "EMITIDO" }); const jaCancelada = await cr({ status: "CANCELADO" });
      expect((await lote("receber", { acao: "cancelar", ids: [a.id], motivo: "ok" })).status).toBe(400);
      expect((await prisma.contaReceber.findUnique({ where: { id: a.id } })).status).toBe("A_RECEBER");
      const r = await lote("receber", { acao: "cancelar", ids: [a.id, b.id, parcial.id, paga.id, boleto.id, jaCancelada.id], motivo: "Cobrança em duplicidade" });
      expect(r.json.resumo).toEqual({ pedidas: 6, feitas: 2, ignoradas: 4 });
      expect(r.json.ignoradas.map((i: any) => i.motivo)).toEqual([
        "Já tem recebimento parcial: não pode ser cancelada.", "Conta recebida não pode ser cancelada.",
        "Cancele o boleto antes: o cliente ainda consegue pagá-lo.", "Esta conta já está cancelada.",
      ]);
      for (const c of [a, b]) {
        const g = await prisma.contaReceber.findUnique({ where: { id: c.id } });
        expect(g.status).toBe("CANCELADO");
        expect(g.motivoCancelamento).toBe("Cobrança em duplicidade");
        expect(g.canceladaEm).not.toBeNull();
        expect(g.excluidaEm).toBeNull(); // cancelamento, não exclusão
        expect((await eventos(c.id)).at(-1)).toEqual(["CANCELADA", "Cobrança em duplicidade (ação em lote)"]);
      }
      expect((await prisma.contaReceber.findUnique({ where: { id: parcial.id } })).status).toBe("A_RECEBER");
    });

    it("transação: se a baixa de uma conta falhar no meio, NADA fica feito (as anteriores voltam) e a resposta avisa", async () => {
      const a = await cr(); const b = await cr(); const c = await cr();
      bomba.ids.add(b.id);
      try {
        const r = await lote("receber", { acao: "baixar", ids: [a.id, b.id, c.id], data: "2026-11-05" });
        expect(r.status).toBe(500);
        expect(r.json.erro).toBe("Não foi possível concluir: nada foi alterado. Tente de novo.");
      } finally { bomba.ids.clear(); }
      for (const x of [a, b, c]) {
        const g = await prisma.contaReceber.findUnique({ where: { id: x.id }, include: { recebimentos: true } });
        expect(g.status).toBe("A_RECEBER");
        expect(g.recebimentos).toHaveLength(0);
        expect(await eventos(x.id)).toHaveLength(0);
      }
      // Sem a bomba o mesmo lote passa inteiro
      expect((await lote("receber", { acao: "baixar", ids: [a.id, b.id, c.id], data: "2026-11-05" })).json.resumo).toEqual({ pedidas: 3, feitas: 3, ignoradas: 0 });
    });

    it("RBAC: sem Financeiro › Contas a receber = 403 (nada muda); pedido inválido = 400; mais de 200 ids = 400", async () => {
      const a = await cr();
      logar(sem("contasReceber"));
      expect((await lote("receber", { acao: "baixar", ids: [a.id], data: "2026-11-05" })).status).toBe(403);
      logar();
      expect((await prisma.contaReceber.findUnique({ where: { id: a.id } })).status).toBe("A_RECEBER");
      expect((await lote("receber", { acao: "baixar", ids: [a.id] })).json.erro).toBe("Informe a data.");
      expect((await lote("receber", { acao: "vencimento", ids: [a.id], vencimento: { modo: "dias", dias: 0 } })).status).toBe(400);
      expect((await lote("receber", { acao: "explodir", ids: [a.id] })).status).toBe(400);
      expect((await lote("receber", { acao: "cancelar", ids: Array.from({ length: 201 }, (_, i) => `id${i}`), motivo: "muitas" })).status).toBe(400);
      expect((await lote("receber", { acao: "cancelar", ids: [], motivo: "nenhuma" })).status).toBe(400);
    });
  });

  describe("Contas a Pagar", () => {
    it("dar como pago: 5 marcadas (1 já paga) → 4 com pagamento pelo saldo, PAGO_TOTAL e saldo zero; a paga em parte quita o restante", async () => {
      const a = await cp(); const b = await cp({ valorTotal: 250.5, saldoRestante: 250.5, status: "VENCIDO", dataVencimento: dia("2026-10-01") });
      const paga = await cp({ status: "PAGO_TOTAL", valorPago: 1000, saldoRestante: 0 }); const parcial = await cp({ status: "PAGO_PARCIAL", valorPago: 400, saldoRestante: 600 });
      const cancelada = await cp({ status: "CANCELADO" });
      await prisma.pagamentoContaPagar.create({ data: { contaPagarId: parcial.id, valor: 400, dataPagamento: dia("2026-10-10") } });
      const r = await lote("pagar", { acao: "baixar", ids: [a.id, b.id, paga.id, parcial.id, cancelada.id], data: "2026-11-05", formaPagamento: "PIX", banco: "Itaú" });
      expect(r.status).toBe(200);
      expect(r.json.resumo).toEqual({ pedidas: 5, feitas: 3, ignoradas: 2 });
      expect(r.json.ignoradas.map((i: any) => [i.numero, i.motivo])).toEqual([[paga.numero, "Esta conta já foi paga."], [cancelada.numero, "Conta cancelada não recebe baixa."]]);
      expect(r.json.total).toBe(1850.5); // 1000 + 250,50 + 600
      for (const [c, valor] of [[a, 1000], [b, 250.5], [parcial, 600]] as const) {
        const g = await prisma.contaPagar.findUnique({ where: { id: c.id }, include: { pagamentos: { orderBy: { criadoEm: "asc" } } } });
        expect(g.status).toBe("PAGO_TOTAL");
        expect(Number(g.saldoRestante)).toBe(0);
        expect(Number(g.valorPago)).toBe(Number(c.valorTotal));
        expect(g.dataPagamento.toISOString().slice(0, 10)).toBe("2026-11-05");
        expect(g.pagamentos.at(-1)).toMatchObject({ formaPagamento: "PIX", banco: "Itaú", observacao: "Baixa em lote" });
        expect(Number(g.pagamentos.at(-1).valor)).toBe(valor);
      }
      expect((await prisma.contaPagar.findUnique({ where: { id: cancelada.id } })).status).toBe("CANCELADO");
    });

    it("alterar vencimento: empurrar e data única; VENCIDO ↔ PENDENTE acompanha a data nova; paga e cancelada ficam", async () => {
      const vencida = await cp({ status: "VENCIDO", dataVencimento: dia("2020-01-01") }); const b = await cp({ dataVencimento: dia("2099-12-31") });
      const paga = await cp({ status: "PAGO_TOTAL", valorPago: 1000, saldoRestante: 0 }); const cancelada = await cp({ status: "CANCELADO" });
      const r = await lote("pagar", { acao: "vencimento", ids: [vencida.id, b.id, paga.id, cancelada.id], vencimento: { modo: "dias", dias: 45 } });
      expect(r.json.resumo).toEqual({ pedidas: 4, feitas: 2, ignoradas: 2 });
      expect(r.json.ignoradas.map((i: any) => i.motivo)).toEqual(["Conta paga.", "Conta cancelada."]);
      expect(await venc("contaPagar", vencida.id)).toBe("2020-02-15");
      expect(await venc("contaPagar", b.id)).toBe("2100-02-14");
      expect((await prisma.contaPagar.findUnique({ where: { id: vencida.id } })).status).toBe("VENCIDO"); // continua no passado
      // Data única no futuro: deixa de ser VENCIDO; de volta ao passado: VENCIDO de novo
      const r2 = await lote("pagar", { acao: "vencimento", ids: [vencida.id], vencimento: { modo: "data", data: "2099-01-10" } });
      expect(r2.json.feitas[0].detalhe).toBe("Vencimento: 15/02/2020 → 10/01/2099");
      expect((await prisma.contaPagar.findUnique({ where: { id: vencida.id } })).status).toBe("PENDENTE");
      await lote("pagar", { acao: "vencimento", ids: [vencida.id], vencimento: { modo: "data", data: "2020-01-10" } });
      expect((await prisma.contaPagar.findUnique({ where: { id: vencida.id } })).status).toBe("VENCIDO");
      expect(await venc("contaPagar", paga.id)).toBe("2026-11-20");
    });

    it("cancelar: abertas viram CANCELADAS (o registro e os pagamentos ficam); paga, com pagamento lançado e já cancelada ficam de fora", async () => {
      const a = await cp(); const vencida = await cp({ status: "VENCIDO" }); const parcial = await cp({ status: "PAGO_PARCIAL", valorPago: 400, saldoRestante: 600 });
      const paga = await cp({ status: "PAGO_TOTAL", valorPago: 1000, saldoRestante: 0 }); const jaCancelada = await cp({ status: "CANCELADO" });
      expect((await lote("pagar", { acao: "cancelar", ids: [a.id] })).status).toBe(400); // sem motivo
      const r = await lote("pagar", { acao: "cancelar", ids: [a.id, vencida.id, parcial.id, paga.id, jaCancelada.id], motivo: "Pedido cancelado pelo fornecedor" });
      expect(r.json.resumo).toEqual({ pedidas: 5, feitas: 2, ignoradas: 3 });
      expect(r.json.ignoradas.map((i: any) => i.motivo)).toEqual([
        "Já tem pagamento lançado: cancele pela tela da conta, conferindo o histórico.", "Conta paga não pode ser cancelada.", "Esta conta já está cancelada.",
      ]);
      expect((await prisma.contaPagar.findUnique({ where: { id: a.id } })).status).toBe("CANCELADO");
      expect((await prisma.contaPagar.findUnique({ where: { id: vencida.id } })).status).toBe("CANCELADO");
      expect((await prisma.contaPagar.findUnique({ where: { id: parcial.id } })).status).toBe("PAGO_PARCIAL");
      expect(await prisma.contaPagar.count({ where: { id: { in: [a.id, vencida.id] } } })).toBe(2); // ninguém foi apagado
    });

    it("RBAC: sem Financeiro › Fluxo de caixa = 403 (nada muda); id de outra empresa = ignorada", async () => {
      const a = await cp();
      const outra = await prisma.contaPagar.create({ data: { id: `cpX${++n}`, empresaId: "e2", numero: "CP-X", fornecedor: "F", descricao: "x", valorTotal: 10, saldoRestante: 10 } });
      logar(sem("fluxoCaixa"));
      expect((await lote("pagar", { acao: "cancelar", ids: [a.id], motivo: "tentativa" })).status).toBe(403);
      logar();
      expect((await prisma.contaPagar.findUnique({ where: { id: a.id } })).status).toBe("PENDENTE");
      const r = await lote("pagar", { acao: "cancelar", ids: [outra.id, a.id], motivo: "limpeza" });
      expect(r.json.ignoradas).toEqual([{ id: outra.id, numero: outra.id, motivo: "Não encontrada (ou de outra empresa)." }]);
      expect((await prisma.contaPagar.findUnique({ where: { id: outra.id } })).status).toBe("PENDENTE");
      expect((await prisma.contaPagar.findUnique({ where: { id: a.id } })).status).toBe("CANCELADO");
    });
  });
});
