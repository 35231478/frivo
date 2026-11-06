/**
 * Ações em lote (lib/financeiro/acoes-lote) — regras PURAS: quem entra e quem fica de fora em cada
 * ação, com os MESMOS motivos da ação individual; o resumo (quantas, soma, motivos agrupados); o
 * vencimento novo (data única / empurrar dias, no calendário civil); a validação do pedido.
 */
import { describe, expect, it } from "vitest";
import {
  empurrarDiaCivil, motivoLotePagar, motivoLoteReceber, motivoNaoCancelarPagar, motivoNaoMudarVencimentoPagar, motivoNaoPagarPagar,
  motivoPedidoInvalido, novoVencimento, resumoLote, resumoPagar, resumoReceber,
} from "@/lib/financeiro/acoes-lote";
import { motivoNaoCancelar, motivoNaoReceber, travasDaConta } from "@/lib/financeiro/conta-receber-gestao";

const cr = (o: Record<string, unknown> = {}) => ({ id: "x", numero: "CR-1", status: "A_RECEBER", valor: 1000, dataVencimento: "2026-11-20T00:00:00.000Z", ...o });
const cp = (o: Record<string, unknown> = {}) => ({ id: "y", numero: "CP-1", status: "PENDENTE", valorPago: 0, saldoRestante: 1000, dataVencimento: "2026-11-20T00:00:00.000Z", ...o });

describe("Contas a Receber — elegibilidade = regras da ação individual (conta-receber-gestao)", () => {
  const casos = [
    cr(), cr({ status: "RECEBIDO" }), cr({ status: "CANCELADO" }), cr({ status: "PARCELADO" }), cr({ status: "PERDA" }), cr({ status: "RENEGOCIADO" }),
    cr({ renegociacao: true }), cr({ valorRecebido: 300 }), cr({ boletoStatus: "EMITIDO" }), cr({ status: "ATRASADO" }), cr({ status: "PREVISTO" }),
    cr({ notas: [{ status: "CONCLUIDO" }] }), cr({ excluidaEm: new Date() }),
  ];
  it("baixar = motivoNaoReceber; cancelar = motivoNaoCancelar; vencimento = trava do vencimento (recebida/cancelada/boleto/parcelada/perda/renegociada)", () => {
    for (const c of casos) {
      expect(motivoLoteReceber("baixar", c)).toBe(motivoNaoReceber(c));
      expect(motivoLoteReceber("cancelar", c)).toBe(motivoNaoCancelar(c));
      const esperado = c.status === "RECEBIDO" ? "Conta recebida." : c.status === "CANCELADO" ? "Conta cancelada." : travasDaConta(c).vencimento;
      expect(motivoLoteReceber("vencimento", c)).toBe(esperado);
    }
    // Aberta com recebimento parcial: baixa (quita o resto) e vencimento sim; cancelar não
    expect(motivoLoteReceber("baixar", cr({ valorRecebido: 300 }))).toBeNull();
    expect(motivoLoteReceber("vencimento", cr({ valorRecebido: 300 }))).toBeNull();
    expect(motivoLoteReceber("cancelar", cr({ valorRecebido: 300 }))).toBe("Já tem recebimento parcial: não pode ser cancelada.");
    // Boleto emitido: a baixa total pode; vencimento e cancelar não (o banco já tem o boleto)
    expect(motivoLoteReceber("baixar", cr({ boletoStatus: "EMITIDO" }))).toBeNull();
    expect(motivoLoteReceber("vencimento", cr({ boletoStatus: "EMITIDO" }))).toBe("Boleto emitido: cancele o boleto para mudar.");
    expect(motivoLoteReceber("cancelar", cr({ boletoStatus: "EMITIDO" }))).toBe("Cancele o boleto antes: o cliente ainda consegue pagá-lo.");
  });
  it("empurrar dias numa conta sem vencimento não dá (data única sim)", () => {
    expect(motivoLoteReceber("vencimento", cr({ dataVencimento: null }), { modo: "dias", dias: 30 })).toBe("Sem vencimento: escolha uma data única.");
    expect(motivoLoteReceber("vencimento", cr({ dataVencimento: null }), { modo: "data", data: "2026-12-01" })).toBeNull();
  });
});

describe("Contas a Pagar — elegibilidade", () => {
  it("baixar: cancelada e paga ficam de fora; pendente, vencida e paga em parte entram (pelo saldo)", () => {
    expect(motivoNaoPagarPagar(cp())).toBeNull();
    expect(motivoNaoPagarPagar(cp({ status: "VENCIDO" }))).toBeNull();
    expect(motivoNaoPagarPagar(cp({ status: "PAGO_PARCIAL", valorPago: 400, saldoRestante: 600 }))).toBeNull();
    expect(motivoNaoPagarPagar(cp({ status: "PAGO_TOTAL", valorPago: 1000, saldoRestante: 0 }))).toBe("Esta conta já foi paga.");
    expect(motivoNaoPagarPagar(cp({ saldoRestante: 0 }))).toBe("Esta conta já foi paga.");
    expect(motivoNaoPagarPagar(cp({ status: "CANCELADO" }))).toBe("Conta cancelada não recebe baixa.");
  });
  it("vencimento: paga e cancelada ficam como estão; sem vencimento só com data única", () => {
    expect(motivoNaoMudarVencimentoPagar(cp())).toBeNull();
    expect(motivoNaoMudarVencimentoPagar(cp({ status: "PAGO_PARCIAL", valorPago: 1 }))).toBeNull();
    expect(motivoNaoMudarVencimentoPagar(cp({ status: "PAGO_TOTAL" }))).toBe("Conta paga.");
    expect(motivoNaoMudarVencimentoPagar(cp({ status: "CANCELADO" }))).toBe("Conta cancelada.");
    expect(motivoNaoMudarVencimentoPagar(cp({ dataVencimento: null }), { modo: "dias", dias: 10 })).toBe("Sem vencimento: escolha uma data única.");
    expect(motivoNaoMudarVencimentoPagar(cp({ dataVencimento: null }), { modo: "data", data: "2026-12-01" })).toBeNull();
  });
  it("cancelar: já cancelada, paga e com pagamento lançado ficam de fora (essa, uma a uma pela tela da conta)", () => {
    expect(motivoNaoCancelarPagar(cp())).toBeNull();
    expect(motivoNaoCancelarPagar(cp({ status: "VENCIDO" }))).toBeNull();
    expect(motivoNaoCancelarPagar(cp({ status: "CANCELADO" }))).toBe("Esta conta já está cancelada.");
    expect(motivoNaoCancelarPagar(cp({ status: "PAGO_TOTAL", valorPago: 1000, saldoRestante: 0 }))).toBe("Conta paga não pode ser cancelada.");
    expect(motivoNaoCancelarPagar(cp({ status: "PAGO_PARCIAL", valorPago: 400, saldoRestante: 600 }))).toBe("Já tem pagamento lançado: cancele pela tela da conta, conferindo o histórico.");
    expect(motivoLotePagar("cancelar", cp({ valorPago: 400 }))).toBe(motivoNaoCancelarPagar(cp({ valorPago: 400 })));
  });
});

describe("resumo: quem entra, quem fica de fora e por quê; a soma é do saldo das elegíveis", () => {
  it("5 marcadas, 1 já recebida: 4 entram; o total é o SALDO (a parcial conta só o que falta)", () => {
    const r = resumoReceber("baixar", [
      cr({ id: "1", numero: "CR-1" }), cr({ id: "2", numero: "CR-2", valor: 500 }), cr({ id: "3", numero: "CR-3", status: "RECEBIDO", valorRecebido: 1000 }),
      cr({ id: "4", numero: "CR-4", valor: 800, valorRecebido: 300 }), cr({ id: "5", numero: "CR-5", status: "ATRASADO", valor: 0.1 }),
    ]);
    expect(r.elegiveis.map((i) => i.numero)).toEqual(["CR-1", "CR-2", "CR-4", "CR-5"]);
    expect(r.ignoradas.map((i) => [i.numero, i.motivo])).toEqual([["CR-3", "Esta conta já foi recebida."]]);
    expect(r.total).toBe(2000.1); // 1000 + 500 + 500 (falta) + 0,10
    expect(r.porMotivo).toEqual([{ motivo: "Esta conta já foi recebida.", n: 1 }]);
  });
  it("motivos agrupados e ordenados por quantidade; pagar soma o saldo restante", () => {
    const r = resumoPagar("cancelar", [
      cp({ id: "1", numero: "CP-1" }), cp({ id: "2", numero: "CP-2", status: "CANCELADO" }), cp({ id: "3", numero: "CP-3", status: "CANCELADO" }),
      cp({ id: "4", numero: "CP-4", status: "PAGO_PARCIAL", valorPago: 1, saldoRestante: 999 }), cp({ id: "5", numero: "CP-5", saldoRestante: 250.5 }),
    ]);
    expect(r.elegiveis.map((i) => i.numero)).toEqual(["CP-1", "CP-5"]);
    expect(r.total).toBe(1250.5);
    expect(r.porMotivo).toEqual([
      { motivo: "Esta conta já está cancelada.", n: 2 },
      { motivo: "Já tem pagamento lançado: cancele pela tela da conta, conferindo o histórico.", n: 1 },
    ]);
    expect(resumoLote([]).total).toBe(0);
  });
});

describe("vencimento novo", () => {
  it("empurrar no calendário civil (vira o mês/ano, bissexto, negativo adianta)", () => {
    expect(empurrarDiaCivil("2026-11-20", 30)).toBe("2026-12-20");
    expect(empurrarDiaCivil("2026-12-15", 30)).toBe("2027-01-14");
    expect(empurrarDiaCivil("2028-02-28", 1)).toBe("2028-02-29");
    expect(empurrarDiaCivil("2026-11-20", -5)).toBe("2026-11-15");
    expect(() => empurrarDiaCivil("ontem", 1)).toThrow();
  });
  it("novoVencimento: data única vale para todas; dias parte do vencimento de cada uma (sem vencimento = null)", () => {
    expect(novoVencimento("2026-11-20T00:00:00.000Z", { modo: "data", data: "2026-12-01" })).toBe("2026-12-01");
    expect(novoVencimento(null, { modo: "data", data: "2026-12-01" })).toBe("2026-12-01");
    expect(novoVencimento("2026-11-20T00:00:00.000Z", { modo: "dias", dias: 30 })).toBe("2026-12-20");
    expect(novoVencimento(new Date("2026-01-31T00:00:00.000Z"), { modo: "dias", dias: 30 })).toBe("2026-03-02");
    expect(novoVencimento(null, { modo: "dias", dias: 30 })).toBeNull();
  });
});

describe("validação do pedido (antes de tocar em qualquer conta)", () => {
  it("baixar exige a data; vencimento exige data válida ou dias ≠ 0 até ±730; cancelar exige motivo (3+)", () => {
    expect(motivoPedidoInvalido("baixar", {})).toBe("Informe a data.");
    expect(motivoPedidoInvalido("baixar", { data: "2026-13-40" })).toBe("Data inválida.");
    expect(motivoPedidoInvalido("baixar", { data: "2026-11-05" })).toBeNull();
    expect(motivoPedidoInvalido("vencimento", {})).toBe("Escolha como alterar o vencimento.");
    expect(motivoPedidoInvalido("vencimento", { vencimento: { modo: "data", data: "" } })).toBe("Informe a nova data de vencimento.");
    expect(motivoPedidoInvalido("vencimento", { vencimento: { modo: "data", data: "2026-12-01" } })).toBeNull();
    expect(motivoPedidoInvalido("vencimento", { vencimento: { modo: "dias", dias: 0 } })).toContain("Informe quantos dias");
    expect(motivoPedidoInvalido("vencimento", { vencimento: { modo: "dias", dias: 731 } })).toContain("Informe quantos dias");
    expect(motivoPedidoInvalido("vencimento", { vencimento: { modo: "dias", dias: 1.5 } })).toContain("Informe quantos dias");
    expect(motivoPedidoInvalido("vencimento", { vencimento: { modo: "dias", dias: -30 } })).toBeNull();
    expect(motivoPedidoInvalido("cancelar", { motivo: "ok" })).toBe("Informe o motivo do cancelamento.");
    expect(motivoPedidoInvalido("cancelar", { motivo: "Duplicada" })).toBeNull();
  });
});
