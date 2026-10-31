/**
 * Contas a Receber — perda + estorno: as regras puras (as mesmas na tela e no servidor) e os leitores que
 * passam a conhecer o status PERDA (saldo, travas, rótulos, filtros, cards, situação de pagamento da OS).
 */
import { describe, expect, it } from "vitest";
import {
  ORIGEM_RECEBIMENTO, inicioJanelaPerdas, motivoNaoEstornar, motivoNaoMarcarPerda, motivoNaoReverterPerda, motivoTextoInvalido, temBaixaAntiga,
} from "@/lib/financeiro/perda-estorno";
import { motivoNaoParcelar, saldoDaConta } from "@/lib/financeiro/parcelas";
import {
  ROTULO_EVENTO_CR, motivoNaoCancelar, motivoNaoExcluir, motivoNaoReceber, motivoNaoTrocarCliente, travasDaConta,
} from "@/lib/financeiro/conta-receber-gestao";
import { statusVisualReceber } from "@/lib/financeiro-status";
import { CAMPO_CARD_RECEBER, CARDS_PERIODO_RECEBER, condCardPeriodoReceber, condStatusVisualReceber } from "@/lib/listas/filtros";
import { situacaoPagamento } from "@/lib/os/central";
import { ACOES_LABEL, MODULOS, PRESETS } from "@/lib/permissoes";

const aberta = { status: "A_RECEBER", valor: 1000, valorRecebido: 0, boletoStatus: null, excluidaEm: null };

describe("marcar como perda", () => {
  it("só a cobrança em aberto, com saldo e sem boleto emitido — cada recusa com o seu porquê", () => {
    expect(motivoNaoMarcarPerda(aberta)).toBeNull();
    expect(motivoNaoMarcarPerda({ ...aberta, status: "ATRASADO", valorRecebido: 400 })).toBeNull();
    expect(motivoNaoMarcarPerda({ ...aberta, boletoStatus: "CANCELADO" })).toBeNull();
    expect(motivoNaoMarcarPerda({ ...aberta, boletoStatus: "PAGO" })).toBeNull();
    const casos: [Record<string, unknown>, string][] = [
      [{ excluidaEm: new Date() }, "Esta conta foi excluída."],
      [{ status: "PERDA" }, "Esta conta já está marcada como perda."],
      [{ status: "PARCELADO" }, "Conta parcelada: marque a perda em cada parcela."],
      [{ status: "RECEBIDO" }, "Conta recebida não vira perda."],
      [{ status: "CANCELADO" }, "Conta cancelada não vira perda."],
      [{ status: "PREVISTO" }, "Ainda é previsão: não é cobrança."],
      [{ boletoStatus: "EMITIDO" }, "Cancele o boleto antes: o cliente ainda consegue pagá-lo."],
      [{ valorRecebido: 1000 }, "Não há nada em aberto nesta conta."],
    ];
    for (const [m, msg] of casos) expect(motivoNaoMarcarPerda({ ...aberta, ...m } as any)).toBe(msg);
  });
  it("reverter só o que está em perda", () => {
    expect(motivoNaoReverterPerda({ status: "PERDA" })).toBeNull();
    for (const s of ["A_RECEBER", "ATRASADO", "RECEBIDO", "CANCELADO"]) expect(motivoNaoReverterPerda({ status: s })).toBe("Esta conta não está marcada como perda.");
  });
  it("motivo: pelo menos 3 letras de verdade (espaços não contam)", () => {
    expect(motivoTextoInvalido("Faliu")).toBeNull();
    expect(motivoTextoInvalido("abc")).toBeNull();
    for (const m of ["", "ab", "   ", "  a ", null, undefined]) expect(motivoTextoInvalido(m as any, "o motivo da perda")).toBe("Informe o motivo da perda.");
  });
});

describe("estorno de recebimento", () => {
  it("um recebimento: não em perda, não duas vezes, não o que o banco confirmou (boleto) nem o LEGADO", () => {
    expect(motivoNaoEstornar(aberta, { origem: "MANUAL" })).toBeNull();
    expect(motivoNaoEstornar(aberta, { origem: "MEDICAO" })).toBeNull();
    expect(motivoNaoEstornar(aberta, { origem: "RECUPERACAO" })).toBeNull();
    expect(motivoNaoEstornar({ ...aberta, status: "RECEBIDO" }, { origem: "MANUAL" })).toBeNull();
    expect(motivoNaoEstornar(aberta, { origem: "MANUAL", estornadoEm: new Date() })).toBe("Este recebimento já foi estornado.");
    expect(motivoNaoEstornar(aberta, { origem: "LEGADO" })).toBe("Este recebimento já foi estornado.");
    expect(motivoNaoEstornar(aberta, { origem: "BOLETO" })).toBe("Pago pelo boleto no banco: o estorno é com o banco, não aqui.");
    expect(motivoNaoEstornar({ ...aberta, status: "PERDA" }, { origem: "MANUAL" })).toBe("Conta em perda: reverta a perda antes de estornar.");
    expect(motivoNaoEstornar({ ...aberta, excluidaEm: "2026-11-01" }, { origem: "MANUAL" })).toBe("Esta conta foi excluída.");
  });
  it("a baixa antiga (RECEBIDO sem valor recebido gravado): estornável sem escolher; paga no boleto, não", () => {
    const antiga = { ...aberta, status: "RECEBIDO", valorRecebido: 0 };
    expect(temBaixaAntiga(antiga)).toBe(true);
    expect(temBaixaAntiga({ ...antiga, valorRecebido: 1000 })).toBe(false);
    expect(temBaixaAntiga({ ...antiga, status: "A_RECEBER" })).toBe(false);
    expect(temBaixaAntiga({ status: "RECEBIDO" })).toBe(true);
    expect(motivoNaoEstornar(antiga)).toBeNull();
    expect(motivoNaoEstornar({ ...antiga, boletoStatus: "PAGO" })).toBe("Pago pelo boleto no banco: o estorno é com o banco, não aqui.");
    expect(motivoNaoEstornar({ ...antiga, valorRecebido: 1000 })).toBe("Escolha o recebimento a estornar.");
    expect(motivoNaoEstornar(aberta, null)).toBe("Escolha o recebimento a estornar.");
  });
  it("rótulos da origem do recebimento", () => {
    expect(ORIGEM_RECEBIMENTO).toEqual({
      MANUAL: "Informado à mão", BOLETO: "Boleto Banco Inter", MEDICAO: "Pagamento da fatura/medição",
      RECUPERACAO: "Recuperação de perda", LEGADO: "Baixa antiga (antes do histórico)",
    });
  });
});

describe("os leitores conhecem a PERDA", () => {
  const perda = { ...aberta, status: "PERDA", valorRecebido: 400, valorPerda: 600, medicaoId: null, notas: [] };
  it("saldo zero (nada a receber); nada de receber/parcelar/cancelar/excluir/trocar cliente/editar valor", () => {
    expect(saldoDaConta(perda)).toBe(0);
    expect(motivoNaoParcelar(perda as any)).toBe("Conta em perda não se parcela.");
    expect(motivoNaoReceber(perda as any)).toBe("Conta em perda: use \"Reverter perda\" para registrar o que o cliente pagou.");
    expect(motivoNaoCancelar(perda as any)).toBe("Conta em perda: reverta a perda antes.");
    expect(motivoNaoExcluir(perda as any)).toBe("Conta em perda: reverta a perda antes.");
    expect(motivoNaoTrocarCliente(perda as any)).toBe("Conta em perda: reverta a perda antes.");
    expect(travasDaConta(perda as any)).toEqual({ valor: "Conta em perda: reverta a perda antes.", vencimento: "Conta em perda: reverta a perda antes." });
  });
  it("selo 'Perda' (não vermelho), eventos da linha do tempo", () => {
    expect(statusVisualReceber("PERDA", "2026-01-01T00:00:00Z")).toMatchObject({ chave: "PERDA", label: "Perda", linhaVermelha: false });
    expect([ROTULO_EVENTO_CR.PERDA, ROTULO_EVENTO_CR.PERDA_REVERTIDA, ROTULO_EVENTO_CR.ESTORNADA]).toEqual(["Marcada como perda", "Perda revertida", "Recebimento estornado"]);
  });
  it("filtro e card Perdas (pelo valor perdido); o Total continua 'tudo menos cancelado' (inclui a perda)", () => {
    expect(condStatusVisualReceber("PERDA")).toEqual({ status: "PERDA" });
    expect(CARDS_PERIODO_RECEBER).toEqual(["VENCIDO", "VENCE_HOJE", "A_VENCER", "RECEBIDO", "PERDA", "TOTAL"]);
    expect(condCardPeriodoReceber("PERDA", new Date("2026-11-15T15:00:00Z"))).toEqual({ status: "PERDA" });
    expect(condCardPeriodoReceber("TOTAL", new Date("2026-11-15T15:00:00Z"))).toEqual({ status: { not: "CANCELADO" } });
    expect(CAMPO_CARD_RECEBER.PERDA).toBe("valorPerda");
  });
  it("OS: todas as cobranças pagas ou perdidas, com alguma perdida = 'Perda'; uma em aberto continua mandando", () => {
    const os = (contas: { status: string; dataVencimento: string }[]) => ({
      status: "CONCLUIDA", statusManual: false, previsaoConclusao: null, atividades: [], itensOrcamento: [], orcamentos: [],
      medicoes: [{ status: "NF_EMITIDA", valorTotal: 900, contasReceber: contas }],
    });
    expect(situacaoPagamento(os([{ status: "RECEBIDO", dataVencimento: "2026-01-10T00:00:00Z" }, { status: "PERDA", dataVencimento: "2026-01-10T00:00:00Z" }]) as any, 900)).toBe("PERDA");
    expect(situacaoPagamento(os([{ status: "PERDA", dataVencimento: "2026-01-10T00:00:00Z" }, { status: "A_RECEBER", dataVencimento: "2020-01-10T00:00:00Z" }]) as any, 900)).toBe("VENCIDO");
    expect(situacaoPagamento(os([{ status: "RECEBIDO", dataVencimento: "2026-01-10T00:00:00Z" }]) as any, 900)).toBe("PAGO");
  });
  it("janela do alerta: 12 meses para trás", () => {
    expect(inicioJanelaPerdas(new Date("2026-11-15T15:00:00Z")).toISOString()).toBe("2025-11-15T15:00:00.000Z");
  });
});

describe("permissão Financeiro › Perdas", () => {
  it("existe no módulo Financeiro com rótulo; o perfil Financeiro padrão NÃO ganha (gerente/administrador decidem)", () => {
    expect(MODULOS.find((m) => m.id === "financeiro")!.acoes).toContain("perdas");
    expect(ACOES_LABEL.perdas).toBe("Perdas (marcar/reverter)");
    expect(PRESETS.FINANCEIRO.financeiro.contasReceber).toBe(true);
    expect(PRESETS.FINANCEIRO.financeiro.perdas ?? false).toBe(false);
  });
});
