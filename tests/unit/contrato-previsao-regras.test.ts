/**
 * Previsão do contrato — regras puras: vigência por competência (CO4, regra do aniversário), vencimento
 * da competência, o que mudou na cobrança e o plano de sincronização das previsões abertas ao editar.
 */
import { describe, expect, it } from "vitest";
import {
  competenciasDoContrato, contratoCobraNaCompetencia, detalheCancelamento, detalheReaberta, eventoDoContrato,
  motivoForaDaVigencia, motivoSemValor, mudancasDaCobranca, planoSincronizacao, vencimentoDaCompetencia, type CobrancaContrato,
} from "@/lib/financeiro/contrato-previsao";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const ymd = (x: Date) => x.toISOString().slice(0, 10);
const sp = (t: string) => t.replace(/\u00a0/g, " "); // a moeda usa espaço fino
const base: CobrancaContrato = {
  numero: "CT-9", dataInicio: d("2026-09-01"), dataFim: d("2027-04-30"), valorMensal: 1000,
  diaFaturamento: 10, diaFixoMes: null, diaVencimento: null, tipoVencimento: null, diasAposVencimento: null, ajusteFinsDeSemana: null,
};
const HOJE = { ano: 2026, mes: 11 };
const prev = (id: string, ano: number, mes: number, valor = 1000, venc?: string) =>
  ({ id, refAno: ano, refMes: mes, valor, dataVencimento: d(venc ?? `${ano}-${String(mes).padStart(2, "0")}-10`) });

describe("vigência por competência (CO4)", () => {
  it("o mês antes do início e o mês cujo aniversário chega no fim não contam; sem fim conta sempre", () => {
    expect(contratoCobraNaCompetencia(d("2026-11-15"), d("2027-11-15"), 2026, 10)).toBe(false);
    expect(contratoCobraNaCompetencia(d("2026-11-15"), d("2027-11-15"), 2026, 11)).toBe(true);
    expect(contratoCobraNaCompetencia(d("2026-11-15"), d("2027-11-15"), 2027, 10)).toBe(true);
    expect(contratoCobraNaCompetencia(d("2026-11-15"), d("2027-11-15"), 2027, 11)).toBe(false); // aniversário == fim
    expect(contratoCobraNaCompetencia(d("2026-11-15"), d("2027-11-16"), 2027, 11)).toBe(true);
    expect(contratoCobraNaCompetencia(d("2026-01-01"), d("2026-12-31"), 2026, 12)).toBe(true);
    expect(contratoCobraNaCompetencia(d("2026-01-01"), d("2026-12-31"), 2027, 1)).toBe(false);
    expect(contratoCobraNaCompetencia(d("2015-03-01"), null, 2031, 7)).toBe(true); // sem fim, sem limite de anos
    expect(contratoCobraNaCompetencia(d("2026-12-01"), null, 2026, 11)).toBe(false);
    // dia 31 num mês curto: o aniversário vai para o último dia do mês
    expect(contratoCobraNaCompetencia(d("2026-01-31"), d("2026-02-28"), 2026, 2)).toBe(false);
    expect(contratoCobraNaCompetencia(d("2026-01-31"), d("2026-03-01"), 2026, 2)).toBe(true);
  });
  it("é exatamente a mesma regra da lista de competências (que gera as previsões)", () => {
    const casos: [string, string | null][] = [
      ["2026-01-01", "2026-12-31"], ["2026-01-01", "2027-01-01"], ["2026-11-15", "2027-11-15"], ["2026-01-31", "2026-07-30"],
      ["2026-03-10", "2026-03-11"], ["2026-03-10", "2026-03-10"], ["2025-06-30", null],
    ];
    for (const [i, f] of casos) {
      const lista = competenciasDoContrato(d(i), f ? d(f) : null, d("2026-11-15"));
      const chaves = new Set(lista.map((c) => c.ano * 100 + c.mes));
      for (let a = 2025; a <= 2027; a++) for (let m = 1; m <= 12; m++) {
        const dentroDoHorizonte = f || a * 12 + m <= 2027 * 12 + 12 - 2; // sem fim: a lista só vai ~13 meses à frente
        if (!dentroDoHorizonte) continue;
        expect([i, f, a, m, contratoCobraNaCompetencia(d(i), f ? d(f) : null, a, m)]).toEqual([i, f, a, m, chaves.has(a * 100 + m)]);
      }
    }
  });
});

describe("vencimento da competência", () => {
  it("dia de faturamento + dias depois; dia fixo; mês curto; fim de semana", () => {
    expect(ymd(vencimentoDaCompetencia(base, 2026, 12))).toBe("2026-12-10");
    expect(ymd(vencimentoDaCompetencia({ ...base, diasAposVencimento: 5 }, 2026, 12))).toBe("2026-12-15");
    expect(ymd(vencimentoDaCompetencia({ ...base, tipoVencimento: "DIA_FIXO_MES", diaFixoMes: 31 }, 2027, 2))).toBe("2027-02-28");
    expect(ymd(vencimentoDaCompetencia({ ...base, diaFaturamento: null, diaFixoMes: null, diaVencimento: 7 }, 2027, 1))).toBe("2027-01-07");
    expect(ymd(vencimentoDaCompetencia({ ...base, diaFaturamento: null }, 2027, 1))).toBe("2027-01-01");
    // 10/01/2027 é domingo
    expect(ymd(vencimentoDaCompetencia({ ...base, ajusteFinsDeSemana: "POSTERGAR" }, 2027, 1))).toBe("2027-01-11");
    expect(ymd(vencimentoDaCompetencia({ ...base, ajusteFinsDeSemana: "ADIANTAR" }, 2027, 1))).toBe("2027-01-08");
    expect(ymd(vencimentoDaCompetencia({ ...base, ajusteFinsDeSemana: "MANTER" }, 2027, 1))).toBe("2027-01-10");
  });
});

describe("o que mudou na cobrança", () => {
  it("valor, vencimento (cada campo) e vigência; o resto do contrato não conta", () => {
    expect(mudancasDaCobranca(base, { ...base })).toEqual({ valor: false, vencimento: false, vigencia: false });
    expect(mudancasDaCobranca(base, { ...base, valorMensal: "1000.00" })).toEqual({ valor: false, vencimento: false, vigencia: false });
    expect(mudancasDaCobranca(base, { ...base, valorMensal: 1200 }).valor).toBe(true);
    expect(mudancasDaCobranca(base, { ...base, valorMensal: null }).valor).toBe(true);
    for (const k of ["diaFaturamento", "diaFixoMes", "diaVencimento", "diasAposVencimento"] as const) {
      expect(mudancasDaCobranca(base, { ...base, [k]: 20 })).toEqual({ valor: false, vencimento: true, vigencia: false });
    }
    expect(mudancasDaCobranca(base, { ...base, tipoVencimento: "DIA_FIXO_MES" }).vencimento).toBe(true);
    expect(mudancasDaCobranca(base, { ...base, ajusteFinsDeSemana: "ADIANTAR" }).vencimento).toBe(true);
    expect(mudancasDaCobranca(base, { ...base, dataFim: null }).vigencia).toBe(true);
    expect(mudancasDaCobranca(base, { ...base, dataInicio: d("2026-10-01") }).vigencia).toBe(true);
    expect(mudancasDaCobranca(base, { ...base, dataFim: d("2027-04-30") }).vigencia).toBe(false);
  });
});

describe("plano de sincronização das previsões abertas", () => {
  const todas = [prev("out", 2026, 10), prev("nov", 2026, 11), prev("dez", 2026, 12), prev("jan", 2027, 1, 900), prev("abr", 2027, 4)];
  it("nada mudou → nada a fazer", () => {
    expect(planoSincronizacao(todas, base, { valor: false, vencimento: false }, HOJE)).toEqual({ atualizar: [], cancelar: [] });
  });
  it("valor novo: da competência corrente em diante, com o de → para; o mês passado aberto fica", () => {
    const p = planoSincronizacao(todas, { ...base, valorMensal: 1200 }, { valor: true, vencimento: false }, HOJE);
    expect(p.cancelar).toEqual([]);
    expect(p.atualizar.map((a) => [a.id, a.valor, a.dataVencimento])).toEqual([
      ["nov", 1200, undefined], ["dez", 1200, undefined], ["jan", 1200, undefined], ["abr", 1200, undefined],
    ]);
    expect(sp(p.atualizar[2].detalhe)).toBe("Pelo contrato: contrato CT-9 alterado — valor R$ 900,00 → R$ 1.200,00.");
    // o vencimento ajustado à mão numa previsão fica quando só o valor mudou
    const mao = planoSincronizacao([prev("m", 2027, 2, 1000, "2027-02-25")], { ...base, valorMensal: 1200 }, { valor: true, vencimento: false }, HOJE);
    expect(mao.atualizar.map((a) => [a.id, a.valor, a.dataVencimento])).toEqual([["m", 1200, undefined]]);
    // o valor igual ao novo não gera edição nem evento
    expect(planoSincronizacao([prev("x", 2026, 12, 1200)], { ...base, valorMensal: 1200 }, { valor: true, vencimento: false }, HOJE).atualizar).toEqual([]);
  });
  it("só o vencimento mudou: o valor (mesmo ajustado à mão) fica; o vencimento acompanha", () => {
    const p = planoSincronizacao(todas, { ...base, diaFaturamento: 20 }, { valor: false, vencimento: true }, HOJE);
    expect(p.atualizar.map((a) => [a.id, a.valor, ymd(a.dataVencimento!)])).toEqual([
      ["nov", undefined, "2026-11-20"], ["dez", undefined, "2026-12-20"], ["jan", undefined, "2027-01-20"], ["abr", undefined, "2027-04-20"],
    ]);
    expect(p.atualizar[0].detalhe).toBe("Pelo contrato: contrato CT-9 alterado — vencimento 10/11/2026 → 20/11/2026.");
    const ambos = planoSincronizacao([prev("dez", 2026, 12)], { ...base, diaFaturamento: 20, valorMensal: 1100 }, { valor: true, vencimento: true }, HOJE);
    expect(sp(ambos.atualizar[0].detalhe)).toBe("Pelo contrato: contrato CT-9 alterado — valor R$ 1.000,00 → R$ 1.100,00 · vencimento 10/12/2026 → 20/12/2026.");
  });
  it("fora da nova vigência → cancela (também mês passado); sem valor → cancela tudo; conta sem competência não é tocada", () => {
    const curto = { ...base, dataInicio: d("2026-11-01"), dataFim: d("2027-01-31") };
    const p = planoSincronizacao([...todas, { ...prev("velha", 2026, 12), refAno: null, refMes: null }], curto, { valor: false, vencimento: false }, HOJE);
    expect(p.cancelar).toEqual([
      { id: "out", motivo: "Fora da vigência do contrato CT-9 (01/11/2026 a 31/01/2027)" },
      { id: "abr", motivo: "Fora da vigência do contrato CT-9 (01/11/2026 a 31/01/2027)" },
    ]);
    expect(p.atualizar).toEqual([]);
    expect(motivoForaDaVigencia({ ...base, dataFim: null })).toBe("Fora da vigência do contrato CT-9 (01/09/2026 a sem fim)");
    for (const v of [0, null, ""]) {
      expect(planoSincronizacao(todas, { ...base, valorMensal: v }, { valor: true, vencimento: false }, HOJE).cancelar.map((c) => c.motivo))
        .toEqual(Array(5).fill(motivoSemValor("CT-9")));
    }
  });
  it("a marca do contrato nos eventos: é por ela que a reativação sabe o que pode voltar", () => {
    expect(detalheCancelamento("Contrato CT-9 suspenso")).toBe("Pelo contrato: Contrato CT-9 suspenso. A previsão sai do Contas a Receber.");
    expect(eventoDoContrato(detalheCancelamento("x"))).toBe(true);
    expect(eventoDoContrato(detalheReaberta("CT-9"))).toBe(true);
    for (const t of ["Cliente pediu desconto", "Contrato CT-9 suspenso", "", null, undefined]) expect(eventoDoContrato(t)).toBe(false);
  });
});
