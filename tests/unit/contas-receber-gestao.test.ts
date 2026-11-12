/**
 * Contas a Receber — gestão, regras puras: origem, documento fiscal, o que pode ser feito em cada
 * situação (receber, cancelar, excluir, recibo, trocar cliente), campos travados, o texto do evento
 * "Editada", os links da origem e o valor por extenso do recibo.
 */
import { describe, expect, it } from "vitest";
import {
  descreverAlteracoes, hrefContaReceber, MSG_EXCLUIR_NOTA, motivoNaoCancelar, motivoNaoExcluir, motivoNaoReceber, motivoNaoRecibo,
  motivoNaoTrocarCliente, origemComLink, origemDaConta, temDocumentoFiscal, travasDaConta, valorPorExtenso,
} from "@/lib/financeiro/conta-receber-gestao";

const aberta = { status: "A_RECEBER" };

describe("origem e documento fiscal", () => {
  it("medição > orçamento > contrato > manual", () => {
    expect(origemDaConta({})).toBe("MANUAL");
    expect(origemDaConta({ contratoId: "ct" })).toBe("CONTRATO");
    expect(origemDaConta({ orcamentoId: "o", contratoId: "ct" })).toBe("ORCAMENTO");
    expect(origemDaConta({ medicaoId: "m", orcamentoId: "o", contratoId: "ct" })).toBe("MEDICAO");
  });
  it("nota em emissão ou autorizada é documento fiscal; rejeitada/cancelada/interrompida não", () => {
    for (const s of ["ENVIANDO", "PROCESSANDO", "CONCLUIDO"]) expect(temDocumentoFiscal([{ status: s }])).toBe(true);
    for (const s of ["REJEITADO", "CANCELADO", "INTERROMPIDO"]) expect(temDocumentoFiscal([{ status: s }])).toBe(false);
    expect(temDocumentoFiscal([])).toBe(false);
    expect(temDocumentoFiscal()).toBe(false);
    expect(temDocumentoFiscal([{ status: "REJEITADO" }, { status: "CONCLUIDO" }])).toBe(true);
  });
  it("links da origem e da conta", () => {
    expect(origemComLink({})).toBeNull();
    expect(origemComLink({ medicaoId: "m1", medicaoNumero: "MED-1" })).toEqual({ rotulo: "Medição MED-1", href: "/financeiro/medicoes/m1" });
    expect(origemComLink({ orcamentoId: "o1", orcamentoCodigo: "ORC-1" })).toEqual({ rotulo: "Orçamento ORC-1", href: "/orcamentos/o1" });
    expect(origemComLink({ contratoId: "c1", contratoNumero: "CT-1" })).toEqual({ rotulo: "Contrato CT-1", href: "/contratos/c1" });
    expect(origemComLink({ orcamentoId: "o1" })).toEqual({ rotulo: "Orçamento", href: "/orcamentos/o1" });
    expect(hrefContaReceber("cr1")).toBe("/financeiro/contas-receber?conta=cr1");
  });
});

describe("excluir: só conta manual sem nota fiscal", () => {
  it("manual aberta, recebida ou cancelada: pode", () => {
    expect(motivoNaoExcluir(aberta)).toBeNull();
    expect(motivoNaoExcluir({ status: "RECEBIDO" })).toBeNull();
    expect(motivoNaoExcluir({ status: "CANCELADO" })).toBeNull();
    expect(motivoNaoExcluir({ ...aberta, boletoStatus: "CANCELADO", notas: [{ status: "REJEITADO" }] })).toBeNull();
  });
  it("cada impedimento com o seu motivo (nota fiscal vem primeiro)", () => {
    expect(motivoNaoExcluir({ ...aberta, excluidaEm: new Date() })).toBe("Esta conta já foi excluída.");
    expect(motivoNaoExcluir({ ...aberta, medicaoId: "m", notas: [{ status: "CONCLUIDO" }] })).toBe(MSG_EXCLUIR_NOTA);
    expect(MSG_EXCLUIR_NOTA).toBe("Conta com nota fiscal: use Cancelar.");
    expect(motivoNaoExcluir({ ...aberta, medicaoId: "m" })).toBe("Conta de medição: use Cancelar.");
    expect(motivoNaoExcluir({ ...aberta, orcamentoId: "o" })).toBe("Conta de orçamento aprovado: use Cancelar.");
    expect(motivoNaoExcluir({ ...aberta, contratoId: "c" })).toBe("Conta de contrato: use Cancelar.");
    expect(motivoNaoExcluir({ ...aberta, boletoStatus: "EMITIDO" })).toBe("Cancele o boleto antes de excluir.");
  });
});

describe("receber, cancelar, recibo, trocar cliente", () => {
  it("receber: aberta/prevista sim; recebida, cancelada ou excluída não", () => {
    expect(motivoNaoReceber(aberta)).toBeNull();
    expect(motivoNaoReceber({ status: "PREVISTO" })).toBeNull();
    expect(motivoNaoReceber({ status: "ATRASADO" })).toBeNull();
    expect(motivoNaoReceber({ status: "RECEBIDO" })).toBe("Esta conta já foi recebida.");
    expect(motivoNaoReceber({ status: "CANCELADO" })).toBe("Conta cancelada não recebe baixa.");
    expect(motivoNaoReceber({ ...aberta, excluidaEm: "2026-11-01" })).toBe("Esta conta foi excluída.");
  });
  it("cancelar: aberta sim (mesmo com nota, de medição); recebida, cancelada, boleto ativo ou excluída não", () => {
    expect(motivoNaoCancelar({ ...aberta, medicaoId: "m", notas: [{ status: "CONCLUIDO" }] })).toBeNull();
    expect(motivoNaoCancelar({ ...aberta, boletoStatus: "CANCELADO" })).toBeNull();
    expect(motivoNaoCancelar({ status: "RECEBIDO" })).toBe("Conta recebida não pode ser cancelada.");
    expect(motivoNaoCancelar({ status: "CANCELADO" })).toBe("Esta conta já está cancelada.");
    expect(motivoNaoCancelar({ ...aberta, boletoStatus: "EMITIDO" })).toBe("Cancele o boleto antes: o cliente ainda consegue pagá-lo.");
    expect(motivoNaoCancelar({ ...aberta, excluidaEm: new Date() })).toBe("Esta conta foi excluída.");
  });
  it("recibo só para recebida", () => {
    expect(motivoNaoRecibo({ status: "RECEBIDO" })).toBeNull();
    for (const s of ["PREVISTO", "A_RECEBER", "ATRASADO", "CANCELADO"]) expect(motivoNaoRecibo({ status: s })).toBe("O recibo sai depois de informar o recebimento.");
  });
  it("trocar cliente: só manual, sem boleto/nota, em aberto", () => {
    expect(motivoNaoTrocarCliente(aberta)).toBeNull();
    expect(motivoNaoTrocarCliente({ ...aberta, orcamentoId: "o" })).toBe("O cliente vem da origem da conta.");
    expect(motivoNaoTrocarCliente({ ...aberta, boletoStatus: "EMITIDO" })).toContain("Boleto emitido");
    expect(motivoNaoTrocarCliente({ ...aberta, notas: [{ status: "PROCESSANDO" }] })).toBe("Nota fiscal emitida para este cliente.");
    expect(motivoNaoTrocarCliente({ status: "RECEBIDO" })).toBe("Conta recebida.");
    expect(motivoNaoTrocarCliente({ status: "CANCELADO" })).toBe("Conta cancelada.");
  });
});

describe("travas de valor e vencimento", () => {
  it("livre na conta aberta comum", () => expect(travasDaConta(aberta)).toEqual({ valor: null, vencimento: null }));
  it("recebida/cancelada travam os dois", () => {
    expect(travasDaConta({ status: "RECEBIDO" })).toEqual({ valor: "Conta recebida.", vencimento: "Conta recebida." });
    expect(travasDaConta({ status: "CANCELADO" })).toEqual({ valor: "Conta cancelada.", vencimento: "Conta cancelada." });
  });
  it("boleto emitido trava os dois; nota fiscal só o valor", () => {
    const m = "Boleto emitido: cancele o boleto para mudar.";
    expect(travasDaConta({ ...aberta, boletoStatus: "EMITIDO" })).toEqual({ valor: m, vencimento: m });
    expect(travasDaConta({ ...aberta, boletoStatus: "CANCELADO" })).toEqual({ valor: null, vencimento: null });
    expect(travasDaConta({ ...aberta, notas: [{ status: "CONCLUIDO" }] })).toEqual({ valor: "Valor da nota fiscal emitida.", vencimento: null });
    expect(travasDaConta({ ...aberta, notas: [{ status: "REJEITADO" }] })).toEqual({ valor: null, vencimento: null });
  });
});

describe("evento 'Editada': só o que mudou", () => {
  it("formata valor, vencimento e vazio; textos longos só dizem 'alterada'", () => {
    const antes = { cliente: "A", descricao: "x", valor: 100, dataVencimento: "2026-11-20", formaPagamento: null, categoria: "Velha", centroCusto: null, contaBancaria: "Itaú", observacao: null };
    const depois = { cliente: "A", descricao: "y", valor: 150.5, dataVencimento: "2026-12-01", formaPagamento: "PIX", categoria: "Velha", centroCusto: "Obra", contaBancaria: null, observacao: "nova" };
    const t = descreverAlteracoes(antes, depois);
    expect(t.split("; ")).toEqual([
      "Descrição alterada",
      expect.stringMatching(/^Valor: R\$\s?100,00 → R\$\s?150,50$/),
      "Vencimento: 20/11/2026 → 01/12/2026",
      "Forma de pagamento: — → PIX",
      "Centro de custo: — → Obra",
      "Conta bancária: Itaú → —",
      "Observações alterada",
    ]);
  });
  it("nada mudou (mesmo dia com hora diferente, mesmo valor em texto) = vazio", () => {
    expect(descreverAlteracoes({ valor: 100, dataVencimento: "2026-11-20T03:00:00.000Z", observacao: "" }, { valor: 100.0, dataVencimento: "2026-11-20", observacao: null })).toBe("");
    expect(descreverAlteracoes({ cliente: "A" }, { cliente: "B" })).toBe("Cliente: A → B");
    // Campo que não veio no "depois" não entra
    expect(descreverAlteracoes({ categoria: "X" }, {})).toBe("");
  });
});

describe("valor por extenso (recibo)", () => {
  it.each([
    [0, "zero real"],
    [0.01, "um centavo"],
    [0.5, "cinquenta centavos"],
    [1, "um real"],
    [2, "dois reais"],
    [15, "quinze reais"],
    [21, "vinte e um reais"],
    [100, "cem reais"],
    [101, "cento e um reais"],
    [999, "novecentos e noventa e nove reais"],
    [1000, "mil reais"],
    [1001, "mil e um reais"],
    [1100, "mil e cem reais"],
    [1234.56, "mil duzentos e trinta e quatro reais e cinquenta e seis centavos"],
    [1500, "mil e quinhentos reais"],
    [2000, "dois mil reais"],
    [21300.1, "vinte e um mil e trezentos reais e dez centavos"],
    [100000, "cem mil reais"],
    [1000000, "um milhão de reais"],
    [2500000, "dois milhões e quinhentos mil reais"],
    [1234567, "um milhão duzentos e trinta e quatro mil quinhentos e sessenta e sete reais"],
    [1000001.99, "um milhão e um reais e noventa e nove centavos"],
  ])("%s → %s", (v, esperado) => expect(valorPorExtenso(v)).toBe(esperado));
});
