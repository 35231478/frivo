/**
 * Totais do que está SELECIONADO (lib/listagem/totais-selecao): as mesmas regras dos cards do
 * período de cada tela, calculadas sobre as linhas marcadas — com o relógio fixo ("hoje" =
 * 15/11/2026 em Brasília) para a classificação vencido / vence hoje / a vencer não envelhecer.
 */
import { describe, expect, it } from "vitest";
import {
  CHAVES_NOTAS, CHAVES_ORCAMENTOS, CHAVES_PAGAR, CHAVES_RECEBER,
  totaisNotas, totaisOrcamentos, totaisPagar, totaisReceber,
} from "@/lib/listagem/totais-selecao";

const AGORA = new Date("2026-11-15T15:00:00.000Z"); // 15/11/2026 12:00 em Brasília
const D = (d: string) => `${d}T00:00:00.000Z`;
const so = (t: Record<string, { v: number; q: number }>) => Object.fromEntries(Object.entries(t).map(([k, s]) => [k, [s.v, s.q]]));

describe("contas a receber — Vencidos · Vencem hoje · A vencer · Recebidos · Perdas · Total", () => {
  it("abertas pelo SALDO (vencida/hoje/a vencer, previsão em 'a vencer'); recebidas pelo valor; perdas pelo valor perdido", () => {
    const t = totaisReceber([
      { status: "ATRASADO", dataVencimento: D("2026-11-02"), valor: 1000, valorRecebido: 250 },       // vencida: saldo 750
      { status: "A_RECEBER", dataVencimento: D("2026-11-15"), valor: 500 },                           // vence hoje
      { status: "A_RECEBER", dataVencimento: D("2026-11-20"), valor: 1234.56 },                       // a vencer
      { status: "PREVISTO", dataVencimento: D("2026-12-10"), valor: 300 },                            // previsão: entra em "a vencer"
      { status: "RECEBIDO", dataVencimento: D("2026-11-01"), valor: 800, valorRecebido: 800 },        // recebida pelo valor
      { status: "PERDA", dataVencimento: D("2026-09-01"), valor: 400, valorRecebido: 100, valorPerda: 300 }, // perda pelo valor perdido
    ], AGORA);
    expect(so(t)).toEqual({
      VENCIDO: [750, 1], VENCE_HOJE: [500, 1], A_VENCER: [1534.56, 2], RECEBIDO: [800, 1], PERDA: [300, 1], TOTAL: [4234.56, 6],
    });
    expect(Object.keys(t)).toEqual([...CHAVES_RECEBER]);
  });

  it("total = tudo menos canceladas, a renegociação (vale a original) e o lançamento parcelado; a renegociada original fica só no total", () => {
    const t = totaisReceber([
      { status: "CANCELADO", dataVencimento: D("2026-11-20"), valor: 999 },
      { status: "PARCELADO", dataVencimento: D("2026-11-20"), valor: 3000 },
      { status: "A_RECEBER", dataVencimento: D("2026-11-20"), valor: 1000, renegociacao: true },
      { status: "RENEGOCIADO", dataVencimento: D("2026-10-20"), valor: 1000 },
    ], AGORA);
    expect(so(t)).toEqual({ VENCIDO: [0, 0], VENCE_HOJE: [0, 0], A_VENCER: [1000, 1], RECEBIDO: [0, 0], PERDA: [0, 0], TOTAL: [1000, 1] });
  });

  it("soma em centavos sem erro de ponto flutuante e lista vazia zera tudo", () => {
    const t = totaisReceber([
      { status: "A_RECEBER", dataVencimento: D("2026-11-20"), valor: 0.1 }, { status: "A_RECEBER", dataVencimento: D("2026-11-20"), valor: 0.2 },
    ], AGORA);
    expect(t.A_VENCER).toEqual({ v: 0.3, q: 2 });
    expect(so(totaisReceber([], AGORA))).toEqual({ VENCIDO: [0, 0], VENCE_HOJE: [0, 0], A_VENCER: [0, 0], RECEBIDO: [0, 0], PERDA: [0, 0], TOTAL: [0, 0] });
  });
});

describe("contas a pagar — Vencidos · Vencem hoje · A vencer · Pagos · Total", () => {
  it("abertas pelo saldo restante (pago em parte conta o que falta; sem vencimento = a vencer); pagas pelo valor pago; total pelo valor da conta", () => {
    const t = totaisPagar([
      { status: "PENDENTE", dataVencimento: D("2026-11-02"), valorTotal: 1200, valorPago: 0, saldoRestante: 1200 },         // vencida
      { status: "PAGO_PARCIAL", dataVencimento: D("2026-11-02"), valorTotal: 98765.4, valorPago: 765.4, saldoRestante: 98000 }, // vencida, pelo saldo
      { status: "VENCIDO", dataVencimento: D("2026-11-15"), valorTotal: 500, valorPago: 0, saldoRestante: 500 },           // vence hoje (a data manda)
      { status: "PENDENTE", dataVencimento: D("2026-11-20"), valorTotal: 300, valorPago: 0, saldoRestante: 300 },          // a vencer
      { status: "PENDENTE", dataVencimento: null, valorTotal: 50, valorPago: 0, saldoRestante: 50 },                       // sem data: a vencer
      { status: "PAGO_TOTAL", dataVencimento: D("2026-11-01"), valorTotal: 80, valorPago: 80, saldoRestante: 0 },           // paga
      { status: "CANCELADO", dataVencimento: D("2026-11-01"), valorTotal: 9999, valorPago: 0, saldoRestante: 0 },           // fora de tudo
    ], AGORA);
    expect(so(t)).toEqual({ VENCIDO: [99200, 2], VENCE_HOJE: [500, 1], A_VENCER: [350, 2], PAGO: [80, 1], TOTAL: [100895.4, 6] });
    expect(Object.keys(t)).toEqual([...CHAVES_PAGAR]);
  });
});

describe("orçamentos — Em aberto · Aprovados · Recusados · Vencidos · Total", () => {
  it("enviado na validade = em aberto; enviado com a validade passada = vencido; aprovado inclui convertido; recusado; total sem cancelados", () => {
    const t = totaisOrcamentos([
      { status: "ENVIADO", validadeEm: D("2026-11-15"), totalGeral: 100 },   // vence hoje: ainda em aberto
      { status: "ENVIADO", validadeEm: D("2026-11-14"), totalGeral: 200 },   // venceu ontem
      { status: "ENVIADO", validadeEm: null, totalGeral: 50 },               // sem validade: em aberto
      { status: "APROVADO", validadeEm: D("2026-11-01"), totalGeral: 1000 },
      { status: "CONVERTIDA", validadeEm: D("2026-11-01"), totalGeral: 2000 },
      { status: "REPROVADO", validadeEm: D("2026-11-01"), totalGeral: 300 },
      { status: "RASCUNHO", validadeEm: D("2026-11-30"), totalGeral: 70 },   // só no total
      { status: "CANCELADO", validadeEm: D("2026-11-30"), totalGeral: 9999 },
    ], AGORA);
    expect(so(t)).toEqual({ EM_ABERTO: [150, 2], APROVADO: [3000, 2], RECUSADO: [300, 1], VENCIDO: [200, 1], TOTAL: [3720, 7] });
    expect(Object.keys(t)).toEqual([...CHAVES_ORCAMENTOS]);
  });
});

describe("NFS-e — Em transmissão · Emitidas · Com falha · Canceladas · Total emitido", () => {
  it("agrupa como os cards da central; o total é só o emitido (autorizadas)", () => {
    const t = totaisNotas([
      { status: "ENVIANDO", valorServicos: 10 }, { status: "PROCESSANDO", valorServicos: 70 },
      { status: "CONCLUIDO", valorServicos: 180 }, { status: "CONCLUIDO", valorServicos: 1450 },
      { status: "REJEITADO", valorServicos: 300 }, { status: "INTERROMPIDO", valorServicos: 5 },
      { status: "CANCELADO", valorServicos: 40 },
    ]);
    expect(so(t)).toEqual({ transmissao: [80, 2], emitidas: [1630, 2], falha: [305, 2], canceladas: [40, 1], total: [1630, 2] });
    expect(Object.keys(t)).toEqual([...CHAVES_NOTAS]);
  });
});

describe("seleção parcial: a soma é só das marcadas", () => {
  it("3 de 20 marcadas: o total bate com as três linhas, e nada das outras 17 entra", () => {
    const lista = Array.from({ length: 20 }, (_, i) => ({
      id: `c${i + 1}`, status: i % 4 === 0 ? "RECEBIDO" : "A_RECEBER", dataVencimento: D(i % 3 === 0 ? "2026-11-02" : "2026-11-20"), valor: (i + 1) * 100,
    }));
    const marcadas = new Set(["c2", "c5", "c7"]); // 200 (a vencer), 500 (recebida), 700 (vencida: 7-1=6, 6%3=0)
    const t = totaisReceber(lista.filter((c) => marcadas.has(c.id)), AGORA);
    expect(so(t)).toEqual({ VENCIDO: [700, 1], VENCE_HOJE: [0, 0], A_VENCER: [200, 1], RECEBIDO: [500, 1], PERDA: [0, 0], TOTAL: [1400, 3] });
    expect(totaisReceber(lista, AGORA).TOTAL.v).toBe(21000);
  });
});
