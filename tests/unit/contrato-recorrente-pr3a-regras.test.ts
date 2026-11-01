/**
 * Contrato recorrente — PR3-A, regras puras: periodicidade de cobrança (D1), referência do período
 * (D5), dia de faturamento do contrato com o do cliente de reserva (D2), e a máquina da rotina
 * (competência devida, 3 tentativas — D7) e a trava de permissão das chaves automáticas.
 */
import { describe, expect, it } from "vitest";
import {
  competenciasDoContrato, contratoCobraNaCompetencia, descricaoDaCobranca, descricaoItemContrato, diaFaturamentoDe,
  motivoForaDoPeriodo, mudancasDaCobranca, passoCobranca, PERIODICIDADES_COBRANCA, planoSincronizacao, rotuloReferencia,
  somarMeses, textoFrequencia, vencimentoDaCompetencia, type CobrancaContrato,
} from "@/lib/financeiro/contrato-previsao";
import { aposFalha, competenciaDevida, diaDeFaturar, INTERVALO_TENTATIVA_MS, MAX_TENTATIVAS, medicaoJaAprovada, mensagemDeErro } from "@/lib/faturamento/rotina-contratos";
import { mudaAutomacao, podeAutomatizarFaturamento } from "@/lib/contratos/automacao";
import { montarPermissoes } from "@/lib/permissoes";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const ymd = (x: Date) => x.toISOString().slice(0, 10);
const base: CobrancaContrato = {
  numero: "CT-9", periodicidade: "MENSAL", dataInicio: d("2026-09-01"), dataFim: d("2027-08-31"), valorMensal: 900,
  diaFaturamento: 10, diaFixoMes: null, diaVencimento: null, tipoVencimento: null, diasAposVencimento: null, ajusteFinsDeSemana: null,
};

describe("D1: periodicidade de cobrança", () => {
  it("de quantos em quantos meses; semanal/quinzenal (de antes) cobram como mensal; o seletor só oferece as 5", () => {
    expect(["MENSAL", "BIMESTRAL", "TRIMESTRAL", "SEMESTRAL", "ANUAL", "SEMANAL", "QUINZENAL", null, undefined, "X"].map(passoCobranca))
      .toEqual([1, 2, 3, 6, 12, 1, 1, 1, 1, 1]);
    expect([...PERIODICIDADES_COBRANCA]).toEqual(["MENSAL", "BIMESTRAL", "TRIMESTRAL", "SEMESTRAL", "ANUAL"]);
    expect([1, 2, 3, 6, 12].map(textoFrequencia)).toEqual(["por mês", "a cada 2 meses", "a cada 3 meses", "a cada 6 meses", "por ano"]);
  });

  it("uma competência por período, contada do início da vigência (não do ano civil)", () => {
    const hoje = d("2026-11-15");
    const tri = competenciasDoContrato(d("2026-09-01"), d("2027-08-31"), hoje, 3).map((c) => `${c.mes}/${c.ano}`);
    expect(tri).toEqual(["9/2026", "12/2026", "3/2027", "6/2027"]);
    const sem = competenciasDoContrato(d("2026-02-15"), d("2028-02-15"), hoje, 6).map((c) => `${c.mes}/${c.ano}`);
    expect(sem).toEqual(["2/2026", "8/2026", "2/2027", "8/2027"]);
    // anual sem fim: o horizonte (~13 meses) sempre alcança a próxima cobrança
    expect(competenciasDoContrato(d("2026-03-01"), null, hoje, 12).map((c) => `${c.mes}/${c.ano}`)).toEqual(["3/2026", "3/2027"]);
    expect(competenciasDoContrato(d("2025-12-20"), null, d("2026-12-25"), 12).map((c) => `${c.mes}/${c.ano}`)).toEqual(["12/2025", "12/2026", "12/2027"]);
    // mensal: o mesmo de sempre (12 meses na vigência de um ano)
    expect(competenciasDoContrato(d("2026-01-01"), d("2027-01-01"), hoje)).toHaveLength(12);
    expect(competenciasDoContrato(d("2026-01-01"), d("2027-01-01"), hoje, 1)).toEqual(competenciasDoContrato(d("2026-01-01"), d("2027-01-01"), hoje));
  });

  it("cobra na competência ⇔ está na lista (mesma regra, com o passo)", () => {
    for (const passo of [1, 2, 3, 6, 12]) {
      for (const [i, f] of [["2026-01-31", "2027-12-31"], ["2026-09-01", "2027-08-31"], ["2025-06-30", "2028-01-01"]] as const) {
        const chaves = new Set(competenciasDoContrato(d(i), d(f), d("2026-11-15"), passo).map((c) => c.ano * 100 + c.mes));
        for (let a = 2025; a <= 2028; a++) for (let m = 1; m <= 12; m++) {
          expect([passo, i, a, m, contratoCobraNaCompetencia(d(i), d(f), a, m, passo)]).toEqual([passo, i, a, m, chaves.has(a * 100 + m)]);
        }
      }
    }
  });

  it("trocar a periodicidade conta como mudança de vigência; sem trocar, não", () => {
    expect(mudancasDaCobranca(base, { ...base, periodicidade: "TRIMESTRAL" }).vigencia).toBe(true);
    expect(mudancasDaCobranca(base, { ...base, periodicidade: "SEMANAL" }).vigencia).toBe(false); // semanal = mensal
    expect(mudancasDaCobranca(base, { ...base }).vigencia).toBe(false);
  });

  it("sincronização: a previsão fora do passo é cancelada com o motivo; a do passo fica", () => {
    const tri = { ...base, periodicidade: "TRIMESTRAL" };
    const prev = (id: string, mes: number, ano = 2026) => ({ id, refAno: ano, refMes: mes, valor: 900, dataVencimento: d(`${ano}-${String(mes).padStart(2, "0")}-10`) });
    const plano = planoSincronizacao([prev("nov", 11), prev("dez", 12), prev("jan", 1, 2027), prev("mar", 3, 2027)], tri, { valor: false, vencimento: false }, { ano: 2026, mes: 11 });
    expect(plano.cancelar).toEqual([
      { id: "nov", motivo: motivoForaDoPeriodo("CT-9", 3) },
      { id: "jan", motivo: motivoForaDoPeriodo("CT-9", 3) },
    ]);
    expect(motivoForaDoPeriodo("CT-9", 3)).toBe("Contrato CT-9 cobra a cada 3 meses: esta competência não tem cobrança");
    expect(plano.atualizar).toEqual([]);
  });
});

describe("D5: referência do período (nota e previsão)", () => {
  it("mensal MM/AAAA; a cada N meses jan–mar; virando o ano; período anterior", () => {
    expect(somarMeses(2026, 11, 3)).toEqual({ ano: 2027, mes: 2 });
    expect(somarMeses(2026, 1, -1)).toEqual({ ano: 2025, mes: 12 });
    expect(rotuloReferencia(2026, 11)).toBe("11/2026");
    expect(rotuloReferencia(2026, 1, 3)).toBe("jan–mar/2026");
    expect(rotuloReferencia(2026, 11, 3)).toBe("nov/2026–jan/2027");
    expect(rotuloReferencia(2026, 1, 12)).toBe("jan–dez/2026");
    expect(rotuloReferencia(2026, 11, 1, "ANTERIOR")).toBe("10/2026");
    expect(rotuloReferencia(2026, 1, 1, "ANTERIOR")).toBe("12/2025");
    expect(rotuloReferencia(2026, 4, 3, "ANTERIOR")).toBe("jan–mar/2026");
  });

  it("item da medição: o mensal corrente não muda; a cada N meses e a referência anterior levam o período", () => {
    expect(descricaoItemContrato({ numero: "CT-9", periodicidade: "MENSAL" }, 2026, 11)).toBe("Contrato CT-9 — mensalidade");
    expect(descricaoItemContrato({ numero: "CT-9", periodicidade: "MENSAL", nfseReferencia: "CORRENTE" }, 2026, 11)).toBe("Contrato CT-9 — mensalidade");
    expect(descricaoItemContrato({ numero: "CT-9", periodicidade: "MENSAL", nfseReferencia: "ANTERIOR" }, 2026, 11)).toBe("Contrato CT-9 — mensalidade Ref. 10/2026");
    expect(descricaoItemContrato({ numero: "CT-9", periodicidade: "TRIMESTRAL" }, 2026, 1)).toBe("Contrato CT-9 — cobrança Ref. jan–mar/2026");
    expect(descricaoItemContrato({ numero: "CT-9", periodicidade: "TRIMESTRAL", nfseReferencia: "ANTERIOR" }, 2026, 4)).toBe("Contrato CT-9 — cobrança Ref. jan–mar/2026");
  });

  it("descrição da previsão: a da NFS-e (ou o contrato) + o período", () => {
    expect(descricaoDaCobranca({ numero: "CT-9" }, 2026, 11)).toBe("Contrato CT-9 — Ref. 11/2026");
    expect(descricaoDaCobranca({ numero: "CT-9", descricaoNFSe: " Manutenção " }, 2026, 11)).toBe("Manutenção — Ref. 11/2026");
    expect(descricaoDaCobranca({ numero: "CT-9", periodicidade: "SEMESTRAL" }, 2026, 9)).toBe("Contrato CT-9 — Ref. set/2026–fev/2027");
  });
});

describe("D2: dia de faturamento do contrato, cliente de reserva", () => {
  it("contrato → dia fixo → dia de vencimento → cliente → 1", () => {
    const sem = { diaFaturamento: null, diaFixoMes: null, diaVencimento: null };
    expect(diaFaturamentoDe({ ...sem, diaFaturamento: 20 }, 10)).toBe(20);
    expect(diaFaturamentoDe({ ...sem, diaFixoMes: 5 }, 10)).toBe(5);
    expect(diaFaturamentoDe({ ...sem, diaVencimento: 7 }, 10)).toBe(7);
    expect(diaFaturamentoDe(sem, 15)).toBe(15);
    expect(diaFaturamentoDe(sem, null)).toBe(1);
    expect(ymd(vencimentoDaCompetencia({ ...base, diaFaturamento: null }, 2026, 12, 15))).toBe("2026-12-15");
    expect(ymd(vencimentoDaCompetencia({ ...base, diaFaturamento: 20 }, 2026, 12, 15))).toBe("2026-12-20");
    expect(ymd(vencimentoDaCompetencia({ ...base, diaFaturamento: null }, 2026, 12))).toBe("2026-12-01");
  });
});

describe("rotina: competência devida e tentativas (D7)", () => {
  const c = { dataInicio: d("2026-09-01"), dataFim: d("2027-08-31"), periodicidade: "MENSAL", diaFaturamento: 20, diaFixoMes: null, diaVencimento: null };
  it("só a do mês corrente, a partir do dia de faturamento; fora do passo ou da vigência, nada", () => {
    expect(competenciaDevida(c, { ano: 2026, mes: 11, dia: 19 })).toBeNull();
    expect(competenciaDevida(c, { ano: 2026, mes: 11, dia: 20 })).toEqual({ ano: 2026, mes: 11 });
    expect(competenciaDevida(c, { ano: 2026, mes: 11, dia: 30 })).toEqual({ ano: 2026, mes: 11 });
    expect(competenciaDevida({ ...c, periodicidade: "TRIMESTRAL" }, { ano: 2026, mes: 11, dia: 25 })).toBeNull();
    expect(competenciaDevida({ ...c, periodicidade: "TRIMESTRAL" }, { ano: 2026, mes: 12, dia: 25 })).toEqual({ ano: 2026, mes: 12 });
    expect(competenciaDevida(c, { ano: 2026, mes: 8, dia: 25 })).toBeNull(); // antes do início
    expect(competenciaDevida(c, { ano: 2027, mes: 9, dia: 25 })).toBeNull(); // depois do fim
    // sem dia no contrato: o do cliente
    expect(competenciaDevida({ ...c, diaFaturamento: null }, { ano: 2026, mes: 11, dia: 12 }, 15)).toBeNull();
    expect(competenciaDevida({ ...c, diaFaturamento: null }, { ano: 2026, mes: 11, dia: 15 }, 15)).toEqual({ ano: 2026, mes: 11 });
    // dia 31 em mês de 30: fatura no último dia
    expect(diaDeFaturar({ ...c, diaFaturamento: null, diaFixoMes: 31 }, 2026, 11)).toBe(30);
    expect(diaDeFaturar({ ...c, diaFaturamento: null, diaFixoMes: 31 }, 2027, 2)).toBe(28);
  });

  it("3 tentativas, uma por dia: 1ª e 2ª voltam para a fila amanhã; a 3ª vira FALHA", () => {
    const agora = new Date("2026-11-20T11:23:00Z");
    expect(MAX_TENTATIVAS).toBe(3);
    expect(aposFalha(0, agora)).toEqual({ tentativas: 1, situacao: "PENDENTE", proximaTentativa: new Date(agora.getTime() + INTERVALO_TENTATIVA_MS) });
    expect(aposFalha(1, agora).situacao).toBe("PENDENTE");
    expect(aposFalha(2, agora)).toEqual({ tentativas: 3, situacao: "FALHA", proximaTentativa: null });
    // a próxima rodada diária (24h depois) já pode tentar; a mesma manhã, não
    expect(aposFalha(0, agora).proximaTentativa!.getTime()).toBeLessThan(agora.getTime() + 24 * 3600_000);
    expect(aposFalha(0, agora).proximaTentativa!.getTime()).toBeGreaterThan(agora.getTime() + 12 * 3600_000);
  });

  it("o erro que aparece é curto: a mensagem do banco, não a consulta inteira", () => {
    const prisma = new Error("\nInvalid `tx.medicao.create()` invocation in\n/app/lib/x.ts:120:5\n\n  117 |\n→ 120 const m = await tx.medicao.create(\nError occurred during query execution:\nConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: \"P0001\", message: \"banco fora do ar\", severity: \"ERROR\" }) })\nRaw query failed. Code: `P0001`. Message: `banco fora do ar`");
    expect(mensagemDeErro(prisma)).toBe("banco fora do ar");
    const conector = new Error("Invalid `tx.medicao.updateMany()` invocation:\n\n\nError occurred during query execution:\nConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: \"P0001\", message: \"banco indisponível no momento\", severity: \"ERROR\", detail: None, column: None, hint: None }), transient: false })");
    expect(mensagemDeErro(conector)).toBe("banco indisponível no momento");
    expect(mensagemDeErro(new Error("Uma OS do contrato entrou em outra medição enquanto esta era montada."))).toBe("Uma OS do contrato entrou em outra medição enquanto esta era montada.");
    expect(mensagemDeErro(new Error("linha 1\n  linha final  "))).toBe("linha final");
    expect(mensagemDeErro(null)).toBe("Erro inesperado.");
    expect(mensagemDeErro(new Error("x".repeat(400)))).toHaveLength(300);
  });

  it("medição já aprovada", () => {
    expect(["RASCUNHO", "AGUARDANDO_APROVACAO", "CANCELADA"].map(medicaoJaAprovada)).toEqual([false, false, false]);
    expect(["APROVADA", "AGUARDANDO_PC", "PC_RECEBIDO", "NF_EMITIDA", "BOLETO_GERADO", "PAGO"].every(medicaoJaAprovada)).toBe(true);
  });
});

describe("chaves automáticas pedem Financeiro › Medições", () => {
  it("só conta como mudança o que veio no corpo e é diferente do gravado", () => {
    expect(mudaAutomacao({}, { faturamentoAutomatico: true })).toBe(false);
    expect(mudaAutomacao({ faturamentoAutomatico: true }, { faturamentoAutomatico: true })).toBe(false);
    expect(mudaAutomacao({ faturamentoAutomatico: false }, { faturamentoAutomatico: true })).toBe(true);
    expect(mudaAutomacao({ aprovacaoAutomatica: true }, {})).toBe(true);
    expect(mudaAutomacao({ faturamentoAutomatico: false, aprovacaoAutomatica: false }, {})).toBe(false);
  });
  it("permissão", () => {
    expect(podeAutomatizarFaturamento({ permissoes: montarPermissoes({ financeiro: ["medicoes"] }), role: "OPERADOR" })).toBe(true);
    expect(podeAutomatizarFaturamento({ permissoes: montarPermissoes({ contratos: ["editar"] }), role: "OPERADOR" })).toBe(false);
    expect(podeAutomatizarFaturamento({ permissoes: {}, role: "ADMIN" })).toBe(true);
  });
});
