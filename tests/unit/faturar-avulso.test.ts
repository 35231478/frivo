/**
 * "Faturar" (avulso) — regras puras: rótulos "Fatura AAAA-NNNN" (D1), quem pode faturar, vencimento
 * que nunca nasce vencido, a fatura do orçamento (como o cliente aprovou, total = total geral) e da
 * OS (executados + adicionais), e a base das retenções (só os serviços da nota).
 */
import { describe, expect, it } from "vitest";
import {
  faturaDaOs, faturaDoOrcamento, motivoNaoFaturarOrcamento, motivoNaoFaturarOs, numeroFatura, referenciaNota, rotuloMedicao,
  rotuloStatusMedicao, vencimentoAvulso,
} from "@/lib/faturamento/fatura";
import { baseRetencoes } from "@/lib/financeiro/retencoes";
import { calcularOrcamento } from "@/lib/orcamentos/calculo";
import { discriminacaoPadrao } from "@/lib/nfse/nota";
import { LABELS_STATUS_MEDICAO } from "@/lib/utils";

describe("rótulos (D1: o número interno MED não muda; na tela vira \"Fatura\")", () => {
  it("avulsa → \"Fatura 2026-0012\" / \"Fatura nº 2026-0012\"; comum segue \"Medição MED-…\"", () => {
    expect(numeroFatura("MED-2026-0012")).toBe("2026-0012");
    expect(numeroFatura("2026-0012")).toBe("2026-0012");
    expect(rotuloMedicao({ numero: "MED-2026-0012", avulsa: true })).toBe("Fatura 2026-0012");
    expect(rotuloMedicao({ numero: "MED-2026-0012", avulsa: false })).toBe("Medição MED-2026-0012");
    expect(rotuloMedicao({ numero: "MED-2026-0012" })).toBe("Medição MED-2026-0012");
    expect(referenciaNota({ numero: "MED-2026-0012", avulsa: true })).toBe("Fatura nº 2026-0012");
    expect(referenciaNota({ numero: "MED-2026-0012", avulsa: null })).toBe("Medição MED-2026-0012");
  });
  it("status: a avulsa liberada (PC_RECEBIDO) aparece \"A emitir\"; o resto como sempre", () => {
    expect(rotuloStatusMedicao({ status: "PC_RECEBIDO", avulsa: true }, LABELS_STATUS_MEDICAO)).toBe("A emitir");
    expect(rotuloStatusMedicao({ status: "PC_RECEBIDO", avulsa: false }, LABELS_STATUS_MEDICAO)).toBe("PC recebido");
    expect(rotuloStatusMedicao({ status: "NF_EMITIDA", avulsa: true }, LABELS_STATUS_MEDICAO)).toBe("NF emitida");
    expect(rotuloStatusMedicao({ status: "XYZ" }, LABELS_STATUS_MEDICAO)).toBe("XYZ");
  });
  it("discriminação da NFS-e: \"Ref.: Fatura nº …\" no avulso", () => {
    const g = { itens: [{ item: { descricao: "Manutenção", quantidade: 1, valorTotal: 900, servico: null } }] } as any;
    expect(discriminacaoPadrao(g, { medicaoNumero: "MED-2026-0012", referencia: referenciaNota({ numero: "MED-2026-0012", avulsa: true }) }))
      .toBe("Manutenção — R$ 900,00 | Ref.: Fatura nº 2026-0012");
    expect(discriminacaoPadrao(g, { medicaoNumero: "MED-2026-0012" })).toBe("Manutenção — R$ 900,00 | Ref.: Medição MED-2026-0012");
  });
});

describe("quem pode faturar", () => {
  it("orçamento: só COMUM aprovado", () => {
    expect(motivoNaoFaturarOrcamento({ status: "APROVADO", tipo: "COMUM" })).toBeNull();
    for (const status of ["RASCUNHO", "ENVIADO", "REPROVADO", "CANCELADO"]) {
      expect(motivoNaoFaturarOrcamento({ status, tipo: "COMUM" })).toBe("Só orçamento aprovado pode ser faturado.");
    }
    expect(motivoNaoFaturarOrcamento({ status: "APROVADO", tipo: "PROPOSTA_CONTRATO" })).toBe("Proposta de contrato é faturada pelo contrato.");
  });
  it("OS: concluída e sem contrato (a de contrato segue pela medição)", () => {
    expect(motivoNaoFaturarOs({ status: "CONCLUIDA", contratoId: null })).toBeNull();
    expect(motivoNaoFaturarOs({ status: "EM_ANDAMENTO" })).toBe("Conclua a OS antes de faturar.");
    expect(motivoNaoFaturarOs({ status: "CONCLUIDA", contratoId: "ct1" })).toBe("OS de contrato: fature pela medição do contrato.");
  });
});

describe("vencimentoAvulso (nunca nasce vencida)", () => {
  const d = (x: Date) => x.toISOString().slice(0, 10);
  it("dia do cliente ainda não passou no mês → este mês; hoje → hoje; já passou → mês seguinte", () => {
    expect(d(vencimentoAvulso(20, { ano: 2026, mes0: 9, dia: 30 }))).toBe("2026-11-20");
    expect(d(vencimentoAvulso(10, { ano: 2026, mes0: 10, dia: 5 }))).toBe("2026-11-10");
    expect(d(vencimentoAvulso(5, { ano: 2026, mes0: 10, dia: 5 }))).toBe("2026-11-05");
  });
  it("virada de ano; sem dia → dia 1; dia acima de 28 vira 28 (cabe em fevereiro)", () => {
    expect(d(vencimentoAvulso(10, { ano: 2026, mes0: 11, dia: 20 }))).toBe("2027-01-10");
    expect(d(vencimentoAvulso(null, { ano: 2026, mes0: 9, dia: 30 }))).toBe("2026-11-01");
    expect(d(vencimentoAvulso(31, { ano: 2027, mes0: 0, dia: 30 }))).toBe("2027-02-28");
    expect(d(vencimentoAvulso(0, { ano: 2026, mes0: 9, dia: 1 }))).toBe("2026-10-01");
  });
});

describe("faturaDoOrcamento (como o cliente aprovou)", () => {
  const dec = (v: number) => ({ toString: () => String(v), valueOf: () => v });
  const base = {
    id: "o1", descontoServicos: 10, tipoDescontoServicos: "PERCENTUAL" as const, descontoProdutos: 20, tipoDescontoProdutos: "VALOR" as const, issAliquota: 5,
    servicos: [
      { descricao: " Mão de obra ", quantidade: dec(1), valorUnitario: dec(600), valorTotal: dec(600), ordem: 2, servicoId: "sMO" },
      { descricao: "Diagnóstico", quantidade: dec(3), valorUnitario: dec(33.33), valorTotal: dec(99.99), ordem: 0, servicoId: null },
    ],
    produtos: [{ descricao: "Gás", quantidade: dec(1.5), valorUnitario: dec(100), valorTotal: dec(150), ordem: 0, produtoId: "pG" }],
  };
  it("serviços (na ordem) e depois produtos; ISS embutido nos serviços; total = total geral ao centavo", () => {
    const f = faturaDoOrcamento(base);
    expect(f.linhas.map((l) => [l.tipo, l.descricao, l.quantidade, l.servicoId ?? null, l.produtoId ?? null, l.orcamentoId])).toEqual([
      ["SERVICO", "Diagnóstico", 3, null, null, "o1"], ["SERVICO", "Mão de obra", 1, "sMO", null, "o1"], ["PRODUTO", "Gás", 1.5, null, "pG", "o1"],
    ]);
    const t = calcularOrcamento(base);
    expect(f.valorLiquido).toBe(t.totalGeral);
    const soma = Math.round(f.linhas.reduce((s, l) => s + l.valorTotal, 0) * 100);
    expect(soma).toBe(Math.round(f.valorTotal * 100));
    expect(Math.round(f.valorTotal * 100) - Math.round(f.descontoValor * 100)).toBe(Math.round(f.valorLiquido * 100));
    // Serviço com ISS embutido (5%): sai mais caro que o preço interno
    expect(f.linhas[1].valorTotal).toBeGreaterThan(600);
    expect(f.linhas[2].valorTotal).toBe(150);
  });
  it("sem ISS e sem desconto: os itens como estão; orçamento vazio → nada", () => {
    const f = faturaDoOrcamento({ ...base, issAliquota: 0, descontoServicos: 0, descontoProdutos: 0 });
    expect(f.linhas.map((l) => l.valorTotal)).toEqual([99.99, 600, 150]);
    expect([f.valorTotal, f.descontoValor, f.valorLiquido]).toEqual([849.99, 0, 849.99]);
    expect(faturaDoOrcamento({ ...base, servicos: [], produtos: [] })).toEqual({ linhas: [], valorTotal: 0, descontoValor: 0, valorLiquido: 0 });
  });
});

describe("faturaDaOs (executados + adicionais \"Cobrar\")", () => {
  it("itens com o serviço do orçamento de origem; adicional como serviço; sem desconto", () => {
    const f = faturaDaOs("os1",
      [{ descricao: " Limpeza ", quantidade: "2", valorUnitario: "150", valorTotal: "300", servicoId: "sL" }, { descricao: "Extra", quantidade: 1, valorUnitario: 50.5, valorTotal: 50.5 }],
      [{ descricao: " Troca de capacitor ", valor: "120.10" }]);
    expect(f.linhas).toEqual([
      { tipo: "SERVICO", descricao: "Limpeza", quantidade: 2, valorUnitario: 150, valorTotal: 300, servicoId: "sL", ordemServicoId: "os1" },
      { tipo: "SERVICO", descricao: "Extra", quantidade: 1, valorUnitario: 50.5, valorTotal: 50.5, servicoId: null, ordemServicoId: "os1" },
      { tipo: "SERVICO", descricao: "Serviço adicional — Troca de capacitor", quantidade: 1, valorUnitario: 120.1, valorTotal: 120.1, ordemServicoId: "os1" },
    ]);
    expect([f.valorTotal, f.descontoValor, f.valorLiquido]).toEqual([470.6, 0, 470.6]);
  });
});

describe("baseRetencoes (= o valor da nota: só os serviços)", () => {
  it("sem produto: o valor líquido da medição, como sempre", () => {
    expect(baseRetencoes({ valorTotal: 1000, valorLiquido: 900, itens: [{ tipo: "SERVICO", valorTotal: 1000 }] })).toBe(900);
    expect(baseRetencoes({ valorTotal: "500", valorLiquido: "500", itens: [] })).toBe(500);
  });
  it("com produto: os serviços menos a parte deles no desconto (rateado como na nota)", () => {
    expect(baseRetencoes({ valorTotal: 3300, valorLiquido: 3300, itens: [{ tipo: "SERVICO", valorTotal: 2000 }, { tipo: "SERVICO", valorTotal: 800 }, { tipo: "PRODUTO", valorTotal: 500 }] })).toBe(2800);
    // desconto 100 rateado: serviço 750/1000 → 75; produto 25
    expect(baseRetencoes({ valorTotal: 1000, valorLiquido: 900, itens: [{ tipo: "SERVICO", valorTotal: 750 }, { tipo: "PRODUTO", valorTotal: 250 }] })).toBe(675);
    expect(baseRetencoes({ valorTotal: 300, valorLiquido: 300, itens: [{ tipo: "PRODUTO", valorTotal: 300 }] })).toBe(0);
  });
});
