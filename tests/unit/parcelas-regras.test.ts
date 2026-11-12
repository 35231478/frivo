/**
 * Contas a Receber — regras puras de parcelas e baixa parcial (lib/financeiro/parcelas) e as travas da
 * gestão que mudaram com elas (lib/financeiro/conta-receber-gestao).
 */
import { describe, expect, it } from "vitest";
import {
  descricaoParcela, dividirEmParcelas, motivoNaoParcelar, motivoParcialComBoleto, motivoPlanoInvalido, motivoValorRecebimento,
  numeroParcela, quitaConta, reajustarValores, recebidaEmParte, recebidoDaConta, rotuloParcela, saldoDaConta, somaParcelas, somarMeses,
} from "@/lib/financeiro/parcelas";
import { motivoNaoCancelar, motivoNaoExcluir, motivoNaoReceber, motivoNaoTrocarCliente, travasDaConta } from "@/lib/financeiro/conta-receber-gestao";
import { condStatusVisualReceber, CAMPO_CARD_RECEBER, whereContasReceber } from "@/lib/listas/filtros";
import { statusVisualReceber } from "@/lib/financeiro-status";
import { situacaoPagamento } from "@/lib/os/central";

describe("dividir em parcelas", () => {
  it("parcelas mensais iguais; os centavos que sobram vão na 1ª; a soma bate sempre", () => {
    expect(dividirEmParcelas(1000, 3, "2026-11-10")).toEqual([
      { vencimento: "2026-11-10", valor: 333.34 }, { vencimento: "2026-12-10", valor: 333.33 }, { vencimento: "2027-01-10", valor: 333.33 },
    ]);
    expect(dividirEmParcelas(100, 4, "2026-11-10").map((p) => p.valor)).toEqual([25, 25, 25, 25]);
    expect(dividirEmParcelas(0.05, 2, "2026-11-10").map((p) => p.valor)).toEqual([0.03, 0.02]);
    for (const [t, n] of [[1234.56, 7], [999.99, 12], [0.1, 3]] as const) expect(somaParcelas(dividirEmParcelas(t, n, "2026-01-31"))).toBe(t);
  });

  it("mês seguinte no mesmo dia; dia 31 → último dia do mês curto (fevereiro bissexto também)", () => {
    expect(somarMeses("2027-01-31", 1)).toBe("2027-02-28");
    expect(somarMeses("2028-01-31", 1)).toBe("2028-02-29");
    expect(somarMeses("2026-12-15", 1)).toBe("2027-01-15");
    expect(dividirEmParcelas(300, 3, "2026-12-31").map((p) => p.vencimento)).toEqual(["2026-12-31", "2027-01-31", "2027-02-28"]);
  });

  it("plano inválido: menos de 2, mais de 48, data ruim, valor zero e soma diferente do total (com os valores no texto)", () => {
    const ok = dividirEmParcelas(1000, 3, "2026-11-10");
    expect(motivoPlanoInvalido(1000, ok)).toBeNull();
    expect(motivoPlanoInvalido(1000, ok.slice(0, 1))).toBe("Divida em pelo menos 2 parcelas.");
    expect(motivoPlanoInvalido(4900, dividirEmParcelas(4900, 49, "2026-11-10"))).toBe("No máximo 48 parcelas.");
    expect(motivoPlanoInvalido(4800, dividirEmParcelas(4800, 48, "2026-11-10"))).toBeNull();
    expect(motivoPlanoInvalido(1000, [ok[0], { ...ok[1], vencimento: "2026-02-30" }, ok[2]])).toBe("Informe o vencimento da parcela 2.");
    expect(motivoPlanoInvalido(1000, [ok[0], ok[1], { ...ok[2], vencimento: "" }])).toBe("Informe o vencimento da parcela 3.");
    expect(motivoPlanoInvalido(1000, [ok[0], { ...ok[1], valor: 0 }, ok[2]])).toBe("A parcela 2 precisa ter valor maior que zero.");
    expect(motivoPlanoInvalido(1000, [ok[0], ok[1], { ...ok[2], valor: 333.32 }])).toMatch(/^A soma das parcelas \(R\$\s?999,99\) tem que ser igual ao valor da conta \(R\$\s?1\.000,00\)\.$/);
  });

  it("número e descrição da parcela; rótulo n/N", () => {
    expect(numeroParcela("CR-2026-0042", 2)).toBe("CR-2026-0042/2");
    expect(descricaoParcela("Manutenção", 2, 3)).toBe("Manutenção — parcela 2/3");
    expect(rotuloParcela({ parcelaNumero: 2, parcelaTotal: 3 })).toBe("Parcela 2/3");
    expect(rotuloParcela({})).toBeNull();
  });

  it("reajuste mantém a proporção (centavos na 1ª) e a soma é o total novo", () => {
    expect(reajustarValores([333.34, 333.33, 333.33], 900)).toEqual([300.02, 299.99, 299.99]);
    expect(somaParcelas(reajustarValores([500, 300, 200], 777.77).map((valor) => ({ valor })))).toBe(777.77);
    expect(reajustarValores([500, 500], 1000)).toEqual([500, 500]);
  });
});

describe("quem pode ser parcelado", () => {
  const aberta = { status: "A_RECEBER", valorRecebido: 0, boletoStatus: null, lancamentoId: null, medicaoId: null };
  it("cobrança em aberto e inteira pode; o resto diz por quê", () => {
    expect(motivoNaoParcelar(aberta)).toBeNull();
    expect(motivoNaoParcelar({ ...aberta, status: "ATRASADO" })).toBeNull();
    expect(motivoNaoParcelar({ ...aberta, excluidaEm: new Date() })).toBe("Esta conta foi excluída.");
    expect(motivoNaoParcelar({ ...aberta, status: "PARCELADO" })).toBe("Esta conta já está parcelada.");
    expect(motivoNaoParcelar({ ...aberta, lancamentoId: "l1" })).toBe("Esta já é uma parcela.");
    expect(motivoNaoParcelar({ ...aberta, status: "RECEBIDO" })).toBe("Conta recebida não se parcela.");
    expect(motivoNaoParcelar({ ...aberta, status: "CANCELADO" })).toBe("Conta cancelada não se parcela.");
    expect(motivoNaoParcelar({ ...aberta, valorRecebido: 0.01 })).toBe("Já tem recebimento: não dá mais para parcelar.");
    expect(motivoNaoParcelar({ ...aberta, boletoStatus: "EMITIDO" })).toBe("Cancele o boleto antes de parcelar (cada parcela terá o seu).");
    expect(motivoNaoParcelar({ ...aberta, boletoStatus: "CANCELADO" })).toBeNull();
    // previsão de contrato/orçamento não; fatura ainda prevista (antes da nota) sim
    expect(motivoNaoParcelar({ ...aberta, status: "PREVISTO" })).toBe("Ainda é previsão: fature antes de parcelar.");
    expect(motivoNaoParcelar({ ...aberta, status: "PREVISTO", medicaoId: "m1" })).toBeNull();
  });
});

describe("baixa parcial: recebido × em aberto", () => {
  it("saldo = valor − recebido nas abertas; 0 na recebida, cancelada e no lançamento parcelado", () => {
    expect(saldoDaConta({ valor: 1000, valorRecebido: 400, status: "A_RECEBER" })).toBe(600);
    expect(saldoDaConta({ valor: "1000.10", valorRecebido: "0.05", status: "ATRASADO" })).toBe(1000.05);
    expect(saldoDaConta({ valor: 1000, valorRecebido: 0, status: "RECEBIDO" })).toBe(0);
    expect(saldoDaConta({ valor: 1000, valorRecebido: 0, status: "CANCELADO" })).toBe(0);
    expect(saldoDaConta({ valor: 1000, valorRecebido: 0, status: "PARCELADO" })).toBe(0);
  });
  it("recebido: a parte que entrou; a RECEBIDA antiga (sem recebimento gravado) entrou inteira", () => {
    expect(recebidoDaConta({ valor: 1000, valorRecebido: 400, status: "A_RECEBER" })).toBe(400);
    expect(recebidoDaConta({ valor: 1000, valorRecebido: 0, status: "RECEBIDO" })).toBe(1000);
    expect(recebidoDaConta({ valor: 1000, valorRecebido: 1000, status: "RECEBIDO" })).toBe(1000);
    expect(recebidoDaConta({ valor: 1000, valorRecebido: 0, status: "A_RECEBER" })).toBe(0);
    expect(recebidaEmParte({ valor: 1000, valorRecebido: 400, status: "A_RECEBER" })).toBe(true);
    expect(recebidaEmParte({ valor: 1000, valorRecebido: 0, status: "A_RECEBER" })).toBe(false);
    expect(recebidaEmParte({ valor: 1000, valorRecebido: 1000, status: "RECEBIDO" })).toBe(false);
  });
  it("valor do recebimento: > 0 e até o saldo; o saldo inteiro quita; com boleto emitido só a baixa total", () => {
    const c = { valor: 1000, valorRecebido: 400, status: "A_RECEBER" };
    expect(motivoValorRecebimento(c, 0)).toBe("Informe um valor maior que zero.");
    expect(motivoValorRecebimento(c, 600.01)).toMatch(/^O valor passa do que falta receber \(R\$\s?600,00\)\.$/);
    expect(motivoValorRecebimento(c, 600)).toBeNull();
    expect(quitaConta(c, 600)).toBe(true);
    expect(quitaConta(c, 599.99)).toBe(false);
    expect(motivoParcialComBoleto({ ...c, boletoStatus: "EMITIDO" }, 100)).toBe("Boleto emitido: cancele o boleto para receber só uma parte.");
    expect(motivoParcialComBoleto({ ...c, boletoStatus: "EMITIDO" }, 600)).toBeNull();
    expect(motivoParcialComBoleto({ ...c, boletoStatus: "CANCELADO" }, 100)).toBeNull();
  });
});

describe("travas da gestão com parcelas e baixa parcial", () => {
  const conta = { status: "A_RECEBER", boletoStatus: null, notas: [] as { status: string }[] };
  it("lançamento parcelado: nada se faz nele (as ações ficam nas parcelas)", () => {
    const l = { ...conta, status: "PARCELADO" };
    const msg = "Conta parcelada: as ações ficam em cada parcela.";
    expect(motivoNaoExcluir(l)).toBe(msg);
    expect(motivoNaoCancelar(l)).toBe(msg);
    expect(motivoNaoReceber(l)).toBe("Conta parcelada: informe o recebimento em cada parcela.");
    expect(travasDaConta(l)).toEqual({ valor: msg, vencimento: msg });
    expect(motivoNaoTrocarCliente(l)).toBe("O cliente vem do lançamento parcelado.");
  });
  it("parcela: cancela (não exclui), valor travado (vem do parcelamento), vencimento livre; cliente do lançamento", () => {
    const p = { ...conta, lancamentoId: "l1" };
    expect(motivoNaoExcluir(p)).toBe("Parcela: use Cancelar.");
    expect(motivoNaoCancelar(p)).toBeNull();
    expect(travasDaConta(p)).toEqual({ valor: "Parcela: o valor vem do parcelamento.", vencimento: null });
    expect(motivoNaoTrocarCliente(p)).toBe("O cliente vem do lançamento parcelado.");
  });
  it("com recebimento parcial: não cancela nem exclui; valor travado; recebe o resto", () => {
    const r = { ...conta, valorRecebido: 400 };
    expect(motivoNaoCancelar(r)).toBe("Já tem recebimento parcial: não pode ser cancelada.");
    expect(motivoNaoExcluir(r)).toBe("Já tem recebimento: não pode ser excluída.");
    expect(travasDaConta(r)).toEqual({ valor: "Já tem recebimento: o valor não muda.", vencimento: null });
    expect(motivoNaoReceber(r)).toBeNull();
  });
});

describe("lista, filtros e situação", () => {
  it("o lançamento parcelado nunca entra na lista; chip 'Recebido em parte'; cards abertos pelo saldo", () => {
    expect(whereContasReceber("e1", {}).AND).toContainEqual({ status: { not: "PARCELADO" } });
    expect(condStatusVisualReceber("PARCIAL")).toEqual({ status: { in: ["A_RECEBER", "ATRASADO"] }, valorRecebido: { gt: 0 } });
    expect(CAMPO_CARD_RECEBER).toEqual({ VENCIDO: "saldo", VENCE_HOJE: "saldo", A_VENCER: "saldo", RECEBIDO: "valor", PERDA: "valorPerda", TOTAL: "valor" });
    expect(statusVisualReceber("PARCELADO", null)).toMatchObject({ chave: "PARCELADO", label: "Parcelado", linhaVermelha: false });
  });
  it("OS: a conta parcelada conta pelas parcelas (uma vencida = Vencido; todas pagas = Pago)", () => {
    const os = (parcelas: { status: string; dataVencimento: string }[]) => ({
      status: "CONCLUIDA", statusManual: false, previsaoConclusao: null, atividades: [], itensOrcamento: [], orcamentos: [],
      medicoes: [{ status: "NF_EMITIDA", valorTotal: 900, contasReceber: [{ status: "PARCELADO", dataVencimento: null, parcelas }] }],
    });
    expect(situacaoPagamento(os([{ status: "RECEBIDO", dataVencimento: "2026-01-10T00:00:00Z" }, { status: "A_RECEBER", dataVencimento: "2020-01-10T00:00:00Z" }]), 900)).toBe("VENCIDO");
    expect(situacaoPagamento(os([{ status: "RECEBIDO", dataVencimento: "2026-01-10T00:00:00Z" }, { status: "RECEBIDO", dataVencimento: "2026-02-10T00:00:00Z" }]), 900)).toBe("PAGO");
  });
});
