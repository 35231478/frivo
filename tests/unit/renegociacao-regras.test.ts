/**
 * Contas a Receber — renegociar: as regras puras (as mesmas na tela e no servidor) e os leitores que
 * passam a conhecer o status RENEGOCIADO (saldo, travas, rótulos, filtro, OS).
 */
import { describe, expect, it } from "vitest";
import {
  composicaoDoRecebido, descricaoRenegociacao, motivoEncargosInvalidos, motivoNaoDesfazer, motivoNaoRenegociar, motivoPlanoRenegociacao,
  motivoSelecaoInvalida, motivoTextoDesfazer, totalRenegociacao,
} from "@/lib/financeiro/renegociacao";
import { motivoNaoParcelar, saldoDaConta } from "@/lib/financeiro/parcelas";
import {
  MSG_RENEGOCIACAO, MSG_RENEGOCIADA, ROTULO_EVENTO_CR, motivoNaoCancelar, motivoNaoExcluir, motivoNaoReceber, motivoNaoTrocarCliente, travasDaConta,
} from "@/lib/financeiro/conta-receber-gestao";
import { motivoNaoEstornar, motivoNaoMarcarPerda } from "@/lib/financeiro/perda-estorno";
import { statusVisualReceber } from "@/lib/financeiro-status";
import { condStatusVisualReceber } from "@/lib/listas/filtros";
import { situacaoPagamento } from "@/lib/os/central";

const aberta = { status: "A_RECEBER", valor: 1000, valorRecebido: 0, boletoStatus: null, excluidaEm: null };

describe("o que entra numa renegociação", () => {
  it("cobrança em aberto (a receber ou vencida), com saldo, sem boleto emitido — cada recusa com o seu porquê", () => {
    expect(motivoNaoRenegociar(aberta)).toBeNull();
    expect(motivoNaoRenegociar({ ...aberta, status: "ATRASADO", valorRecebido: 400 })).toBeNull();
    expect(motivoNaoRenegociar({ ...aberta, boletoStatus: "CANCELADO" })).toBeNull();
    const casos: [Record<string, unknown>, string][] = [
      [{ excluidaEm: new Date() }, "Esta conta foi excluída."],
      [{ status: "RENEGOCIADO" }, "Esta conta já foi renegociada."],
      [{ status: "PERDA" }, "Conta em perda: reverta a perda antes."],
      [{ status: "PARCELADO" }, "Conta parcelada: renegocie as parcelas."],
      [{ status: "PREVISTO" }, "Ainda é previsão: não é cobrança."],
      [{ status: "RECEBIDO" }, "Conta recebida não se renegocia."],
      [{ status: "CANCELADO" }, "Conta cancelada não se renegocia."],
      [{ boletoStatus: "EMITIDO" }, "Cancele o boleto antes: o cliente ainda consegue pagá-lo."],
      [{ valorRecebido: 1000 }, "Não há nada em aberto nesta conta."],
    ];
    for (const [m, msg] of casos) expect(motivoNaoRenegociar({ ...aberta, ...m } as any)).toBe(msg);
  });
  it("a escolha: pelo menos uma, do mesmo cliente, cada uma renegociável (diz qual não pode)", () => {
    const c = (numero: string, clienteId = "c1", extra = {}) => ({ ...aberta, numero, clienteId, ...extra });
    expect(motivoSelecaoInvalida([])).toBe("Escolha pelo menos uma cobrança.");
    expect(motivoSelecaoInvalida([c("CR-1"), c("CR-2", "c2")])).toBe("Escolha cobranças do mesmo cliente.");
    expect(motivoSelecaoInvalida([c("CR-1"), c("CR-2", "c1", { status: "PERDA" })])).toBe("CR-2: Conta em perda: reverta a perda antes.");
    expect(motivoSelecaoInvalida([c("CR-1"), c("CR-2")])).toBeNull();
  });
});

describe("valores e plano", () => {
  it("total = soma dos saldos + juros + multa − desconto (em centavos, sem erro de vírgula)", () => {
    expect(totalRenegociacao([600, 500], { juros: 50, multa: 20, desconto: 10 })).toEqual({ saldo: 1100, total: 1160 });
    expect(totalRenegociacao([0.1, 0.2], {})).toEqual({ saldo: 0.3, total: 0.3 });
    expect(totalRenegociacao([333.33, 333.33, 333.34], { juros: 0.01 })).toEqual({ saldo: 1000, total: 1000.01 });
  });
  it("encargos: nunca negativos; o desconto não zera nem passa o total", () => {
    expect(motivoEncargosInvalidos(100, { juros: 0, multa: 0, desconto: 0 })).toBeNull();
    expect(motivoEncargosInvalidos(100, { desconto: 99.99 })).toBeNull();
    expect(motivoEncargosInvalidos(100, { juros: 10, desconto: 109.99 })).toBeNull();
    for (const e of [{ juros: -1 }, { multa: -0.01 }, { desconto: -5 }]) expect(motivoEncargosInvalidos(100, e)).toBe("Juros, multa e desconto não podem ser negativos.");
    expect(motivoEncargosInvalidos(100, { desconto: 100 })).toBe("O desconto não pode zerar a renegociação.");
    expect(motivoEncargosInvalidos(100, { juros: 10, desconto: 110 })).toBe("O desconto não pode zerar a renegociação.");
    expect(motivoEncargosInvalidos(100, { juros: Number.NaN })).toBe("Juros, multa e desconto: informe valores em R$.");
  });
  it("plano: à vista (um vencimento, valor = total) ou as parcelas (regra do parcelamento)", () => {
    expect(motivoPlanoRenegociacao(310, [{ vencimento: "2026-12-20", valor: 310 }])).toBeNull();
    expect(motivoPlanoRenegociacao(310, [{ vencimento: "2026-12-20", valor: 300 }])).toMatch(/^O valor tem que ser o total da renegociação \(R\$\s?310,00\)\.$/);
    expect(motivoPlanoRenegociacao(310, [{ vencimento: "", valor: 310 }])).toBe("Informe o vencimento.");
    expect(motivoPlanoRenegociacao(310, [])).toBe("Informe o vencimento.");
    expect(motivoPlanoRenegociacao(300, [{ vencimento: "2026-12-10", valor: 150 }, { vencimento: "2027-01-10", valor: 150 }])).toBeNull();
    expect(motivoPlanoRenegociacao(300, [{ vencimento: "2026-12-10", valor: 150 }, { vencimento: "2027-01-10", valor: 149 }])).toMatch(/^A soma das parcelas/);
  });
  it("descrição: as cobranças renegociadas, curtas", () => {
    expect(descricaoRenegociacao(["CR-1"])).toBe("Renegociação de CR-1");
    expect(descricaoRenegociacao(["CR-1", "CR-2"])).toBe("Renegociação de CR-1 e CR-2");
    expect(descricaoRenegociacao(["CR-1", "CR-2", "CR-3", "CR-4"])).toBe("Renegociação de CR-1, CR-2, CR-3 e CR-4");
    expect(descricaoRenegociacao(["CR-1", "CR-2", "CR-3", "CR-4", "CR-5", "CR-6"])).toBe("Renegociação de CR-1, CR-2, CR-3 e mais 3");
  });
  it("D3: o recebido se divide em principal, receita financeira (juros + multa) e desconto concedido — fechando com o recebido", () => {
    const r = { saldo: 1100, juros: 50, multa: 20, desconto: 10 }; // total 1160
    expect(composicaoDoRecebido(r, 1160)).toEqual({ principal: 1100, encargos: 70, desconto: 10 });
    expect(composicaoDoRecebido(r, 580)).toEqual({ principal: 550, encargos: 35, desconto: 5 });
    const meio = composicaoDoRecebido(r, 386.68);
    expect(Math.round((meio.principal + meio.encargos - meio.desconto) * 100)).toBe(38668);
    expect(composicaoDoRecebido(r, 0)).toEqual({ principal: 0, encargos: 0, desconto: 0 });
    expect(composicaoDoRecebido({ saldo: 500, juros: 0, multa: 0, desconto: 0 }, 200)).toEqual({ principal: 200, encargos: 0, desconto: 0 });
  });
});

describe("desfazer", () => {
  const p = (numero: string, extra = {}) => ({ numero, status: "A_RECEBER", valorRecebido: 0, boletoStatus: null, ...extra });
  it("só enquanto nenhuma cobrança nova teve dinheiro, boleto, perda ou outra renegociação", () => {
    expect(motivoNaoDesfazer({ status: "PARCELADO" }, [p("R/1"), p("R/2")])).toBeNull();
    expect(motivoNaoDesfazer({ status: "CANCELADO" }, [p("R/1")])).toBe("Esta renegociação já foi desfeita.");
    expect(motivoNaoDesfazer({ status: "PARCELADO" }, [p("R/1"), p("R/2", { valorRecebido: 10 })])).toBe("Já entrou dinheiro em R/2: não dá para desfazer.");
    expect(motivoNaoDesfazer({ status: "PARCELADO" }, [p("R/1", { status: "RECEBIDO" })])).toBe("Já entrou dinheiro em R/1: não dá para desfazer.");
    expect(motivoNaoDesfazer({ status: "A_RECEBER" }, [p("R", { boletoStatus: "EMITIDO" })])).toBe("Boleto emitido em R: cancele o boleto antes.");
    expect(motivoNaoDesfazer({ status: "PARCELADO" }, [p("R/1", { status: "PERDA" })])).toBe("R/1 está em perda: reverta a perda antes.");
    expect(motivoNaoDesfazer({ status: "PARCELADO" }, [p("R/1", { status: "RENEGOCIADO" })])).toBe("R/1 foi renegociada de novo: desfaça aquela renegociação antes.");
    expect(motivoTextoDesfazer("ok")).toBe("Informe o motivo.");
    expect(motivoTextoDesfazer("  x  ")).toBe("Informe o motivo.");
    expect(motivoTextoDesfazer("Cliente desistiu")).toBeNull();
  });
});

describe("os leitores conhecem a renegociação", () => {
  const renegociada = { ...aberta, status: "RENEGOCIADO", valorRecebido: 400, medicaoId: null, notas: [] };
  it("a renegociada: saldo zero; não recebe, não parcela, não cancela, não exclui, não troca cliente, não estorna, não vira perda", () => {
    expect(saldoDaConta(renegociada)).toBe(0);
    expect(motivoNaoReceber(renegociada as any)).toBe("Conta renegociada: receba pelas parcelas da renegociação.");
    expect(motivoNaoParcelar(renegociada as any)).toBe("Conta renegociada não se parcela.");
    for (const f of [motivoNaoCancelar, motivoNaoExcluir, motivoNaoTrocarCliente]) expect(f(renegociada as any)).toBe(MSG_RENEGOCIADA);
    expect(travasDaConta(renegociada as any)).toEqual({ valor: MSG_RENEGOCIADA, vencimento: MSG_RENEGOCIADA });
    expect(motivoNaoEstornar(renegociada, { origem: "MANUAL" })).toBe("Conta renegociada: desfaça a renegociação antes de estornar.");
    expect(motivoNaoMarcarPerda(renegociada)).toBe("Conta renegociada: marque a perda nas parcelas da renegociação.");
  });
  it("a conta nova (ou parcela dela): recebe normal, mas não cancela/exclui (desfaz-se), valor e cliente vêm das renegociadas", () => {
    const nova = { ...aberta, renegociacao: true, notas: [] };
    expect(motivoNaoReceber(nova as any)).toBeNull();
    expect(motivoNaoCancelar(nova as any)).toBe(MSG_RENEGOCIACAO);
    expect(motivoNaoExcluir(nova as any)).toBe(MSG_RENEGOCIACAO);
    expect(travasDaConta(nova as any)).toEqual({ valor: "Renegociação: o valor vem das cobranças renegociadas.", vencimento: null });
    expect(motivoNaoTrocarCliente(nova as any)).toBe("O cliente vem das cobranças renegociadas.");
    // A parcela da renegociação: o vencimento muda, o valor vem do parcelamento
    expect(travasDaConta({ ...nova, lancamentoId: "l1" } as any)).toEqual({ valor: "Parcela: o valor vem do parcelamento.", vencimento: null });
  });
  it("selo 'Renegociada' (não vermelho), filtro, eventos", () => {
    expect(statusVisualReceber("RENEGOCIADO", "2020-01-01T00:00:00Z")).toMatchObject({ chave: "RENEGOCIADO", label: "Renegociada", linhaVermelha: false });
    expect(condStatusVisualReceber("RENEGOCIADO")).toEqual({ status: "RENEGOCIADO" });
    expect([ROTULO_EVENTO_CR.RENEGOCIADA, ROTULO_EVENTO_CR.RENEGOCIACAO, ROTULO_EVENTO_CR.RENEGOCIACAO_DESFEITA]).toEqual(["Renegociada", "Renegociação", "Renegociação desfeita"]);
  });
  it("OS: a renegociada conta como a receber até a fatura ficar paga (renegociação quitada), aí Pago", () => {
    const os = (medStatus: string, contas: { status: string; dataVencimento: string | null }[]) => ({
      status: "CONCLUIDA", statusManual: false, previsaoConclusao: null, atividades: [], itensOrcamento: [], orcamentos: [],
      medicoes: [{ status: medStatus, valorTotal: 900, contasReceber: contas }],
    });
    expect(situacaoPagamento(os("NF_EMITIDA", [{ status: "RENEGOCIADO", dataVencimento: "2020-01-10T00:00:00Z" }]) as any, 900)).toBe("A_RECEBER");
    expect(situacaoPagamento(os("PAGO", [{ status: "RENEGOCIADO", dataVencimento: "2020-01-10T00:00:00Z" }]) as any, 900)).toBe("PAGO");
    expect(situacaoPagamento(os("NF_EMITIDA", [{ status: "RENEGOCIADO", dataVencimento: null }, { status: "ATRASADO", dataVencimento: "2020-01-10T00:00:00Z" }]) as any, 900)).toBe("VENCIDO");
  });
});
