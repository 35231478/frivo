/**
 * DESPESA RECORRENTE (contas a pagar) — as regras PURAS do motor.
 *
 *  - a frequência é um passo em meses (mensal a anual, ou "a cada N"); o valor NÃO multiplica;
 *  - o início sugerido pula para o mês seguinte quando o dia já passou;
 *  - o término vale por data final, por número de ocorrências, ou nada (indefinido + horizonte);
 *  - o vencimento respeita o fim do mês (dia 31 em fevereiro) e o ajuste de fim de semana;
 *  - regra pausada ou encerrada não gera ocorrência nenhuma;
 *  - a edição com escopo nunca alcança conta paga, parcialmente paga ou cancelada.
 */
import { describe, expect, it } from "vitest";
import {
  ESCOPOS, FREQUENCIAS, MSG_FIM_ANTES_DO_INICIO, MSG_TERMINO_INVALIDO, PASSO_MAX,
  competenciasDaRegra, descricaoDaOcorrencia, frequenciaDoPasso, horizonteRolante, inicioSugerido,
  ocorrenciaEditavel, ocorrenciasDoEscopo, ocorrenciasRestantes, passoDaFrequencia, regraDoEscopo,
  resumoDaRegra, rotuloCompetencia, textoFrequencia, validarRegra, vencimentoDaOcorrencia,
  type OcorrenciaGerada, type RegraRecorrencia,
} from "@/lib/financeiro/conta-pagar-recorrencia";
import { formatarMoeda } from "@/lib/utils";

const regra = (x: Partial<RegraRecorrencia> = {}): RegraRecorrencia => ({
  passoMeses: 1, diaVencimento: 10, ajusteDiaNaoUtil: "MANTER", inicioAno: 2026, inicioMes: 11, ...x,
});
const dia = (d: Date) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
const comps = (l: { ano: number; mes: number }[]) => l.map((c) => rotuloCompetencia(c.ano, c.mes));

describe("frequência", () => {
  it("as nomeadas viram passo em meses, e o passo volta a ser a frequência", () => {
    expect(FREQUENCIAS.map((f) => `${f.id}:${f.passo}`)).toEqual([
      "MENSAL:1", "BIMESTRAL:2", "TRIMESTRAL:3", "QUADRIMESTRAL:4", "SEMESTRAL:6", "ANUAL:12",
    ]);
    expect(passoDaFrequencia("TRIMESTRAL")).toBe(3);
    expect(frequenciaDoPasso(6)).toBe("SEMESTRAL");
    // a cada N meses: o que não tem nome é CUSTOM
    expect(passoDaFrequencia("CUSTOM", 5)).toBe(5);
    expect(frequenciaDoPasso(5)).toBe("CUSTOM");
    expect(passoDaFrequencia("CUSTOM", 999)).toBe(PASSO_MAX);
    expect(passoDaFrequencia("CUSTOM", 0)).toBe(1);
  });

  it("o texto é o da casa", () => {
    expect([1, 3, 12].map(textoFrequencia)).toEqual(["Todo mês", "A cada 3 meses", "Todo ano"]);
  });
});

describe("quando a regra começa e termina", () => {
  it("o dia ainda não passou: começa neste mês; já passou: no mês que vem", () => {
    expect(inicioSugerido({ ano: 2026, mes: 11, dia: 5 }, 10)).toEqual({ ano: 2026, mes: 11 });
    expect(inicioSugerido({ ano: 2026, mes: 11, dia: 10 }, 10)).toEqual({ ano: 2026, mes: 11 }); // o próprio dia conta
    expect(inicioSugerido({ ano: 2026, mes: 11, dia: 11 }, 10)).toEqual({ ano: 2026, mes: 12 });
    expect(inicioSugerido({ ano: 2026, mes: 12, dia: 31 }, 5)).toEqual({ ano: 2027, mes: 1 }); // vira o ano
  });

  it("mensal indefinida: gera até o horizonte, e só até ele", () => {
    const ate = horizonteRolante({ ano: 2026, mes: 11 }, 12);
    expect(ate).toEqual({ ano: 2027, mes: 11 });
    expect(comps(competenciasDaRegra(regra(), ate))).toEqual([
      "nov/2026", "dez/2026", "jan/2027", "fev/2027", "mar/2027", "abr/2027", "mai/2027",
      "jun/2027", "jul/2027", "ago/2027", "set/2027", "out/2027", "nov/2027",
    ]);
  });

  it("trimestral: uma ocorrência a cada 3 meses (o valor não entra nisto)", () => {
    expect(comps(competenciasDaRegra(regra({ passoMeses: 3 }), { ano: 2027, mes: 11 }))).toEqual([
      "nov/2026", "fev/2027", "mai/2027", "ago/2027", "nov/2027",
    ]);
  });

  it("término por data final: para na competência final, inclusive", () => {
    expect(comps(competenciasDaRegra(regra({ fimAno: 2027, fimMes: 1 }), { ano: 2028, mes: 1 })))
      .toEqual(["nov/2026", "dez/2026", "jan/2027"]);
  });

  it("término por número de ocorrências: para na contagem", () => {
    expect(comps(competenciasDaRegra(regra({ passoMeses: 2, ocorrencias: 3 }), { ano: 2030, mes: 1 })))
      .toEqual(["nov/2026", "jan/2027", "mar/2027"]);
    expect(ocorrenciasRestantes(regra({ passoMeses: 2, ocorrencias: 3 }), { ano: 2026, mes: 11 })).toBe(2);
    expect(ocorrenciasRestantes(regra(), { ano: 2026, mes: 11 })).toBeNull(); // indefinida
  });

  it("pausada ou encerrada não gera nada", () => {
    for (const situacao of ["PAUSADA", "ENCERRADA"]) {
      expect(competenciasDaRegra(regra({ situacao }), { ano: 2027, mes: 11 }), situacao).toEqual([]);
    }
  });
});

describe("o vencimento da ocorrência", () => {
  it("dia 31 em mês curto cai no último dia do mês", () => {
    expect(dia(vencimentoDaOcorrencia({ diaVencimento: 31, ajusteDiaNaoUtil: "MANTER" }, 2027, 2))).toBe("28/02/2027");
    expect(dia(vencimentoDaOcorrencia({ diaVencimento: 31, ajusteDiaNaoUtil: "MANTER" }, 2028, 2))).toBe("29/02/2028"); // bissexto
    expect(dia(vencimentoDaOcorrencia({ diaVencimento: 31, ajusteDiaNaoUtil: "MANTER" }, 2027, 4))).toBe("30/04/2027");
  });

  it("fim de semana: antecipa, posterga ou mantém — a mesma regra do contrato", () => {
    // 10/01/2027 é um domingo; 09/01 é sábado
    expect(dia(vencimentoDaOcorrencia({ diaVencimento: 10, ajusteDiaNaoUtil: "MANTER" }, 2027, 1))).toBe("10/01/2027");
    expect(dia(vencimentoDaOcorrencia({ diaVencimento: 10, ajusteDiaNaoUtil: "ADIANTAR" }, 2027, 1))).toBe("08/01/2027");
    expect(dia(vencimentoDaOcorrencia({ diaVencimento: 10, ajusteDiaNaoUtil: "POSTERGAR" }, 2027, 1))).toBe("11/01/2027");
    expect(dia(vencimentoDaOcorrencia({ diaVencimento: 9, ajusteDiaNaoUtil: "ADIANTAR" }, 2027, 1))).toBe("08/01/2027");
    expect(dia(vencimentoDaOcorrencia({ diaVencimento: 9, ajusteDiaNaoUtil: "POSTERGAR" }, 2027, 1))).toBe("11/01/2027");
    // dia útil não se mexe, qualquer que seja o ajuste
    for (const ajuste of ["MANTER", "ADIANTAR", "POSTERGAR"]) {
      expect(dia(vencimentoDaOcorrencia({ diaVencimento: 12, ajusteDiaNaoUtil: ajuste }, 2027, 1)), ajuste).toBe("12/01/2027");
    }
  });
});

describe("o que a tela mostra", () => {
  it("a descrição de cada conta leva a competência", () => {
    expect(descricaoDaOcorrencia("Aluguel do galpão", 2026, 1)).toBe("Aluguel do galpão — jan/2026");
    expect(descricaoDaOcorrencia("  Internet  ", 2026, 12)).toBe("Internet — dez/2026");
  });

  it("o resumo conta a frequência, o valor e o término", () => {
    expect(resumoDaRegra({ ...regra(), valor: 2500 }, formatarMoeda).replace(/ /g, " "))
      .toBe("Todo mês, dia 10 · R$ 2.500,00 · sem data para terminar");
    expect(resumoDaRegra({ ...regra({ passoMeses: 3, fimAno: 2027, fimMes: 12 }), valor: 900 }, formatarMoeda).replace(/ /g, " "))
      .toBe("A cada 3 meses, dia 10 · R$ 900,00 · até dez/2027");
    expect(resumoDaRegra({ ...regra({ ocorrencias: 1 }), valor: 100, valorEstimado: true }, formatarMoeda).replace(/ /g, " "))
      .toBe("Todo mês, dia 10 · R$ 100,00 (estimado) · 1 ocorrência");
  });
});

describe("editar com escopo", () => {
  const conta = (id: string, mes: number, x: Partial<OcorrenciaGerada> = {}): OcorrenciaGerada =>
    ({ id, refAno: 2026, refMes: mes, status: "PENDENTE", valorPago: 0, ...x });
  const contas = [
    conta("c9", 9, { status: "PAGO_TOTAL", valorPago: 2500 }),
    conta("c10", 10, { status: "PAGO_PARCIAL", valorPago: 500 }),
    conta("c11", 11),
    conta("c12", 12, { status: "VENCIDO" }),
    conta("c13", 13 - 12, { refAno: 2027 }), // jan/2027
    conta("c14", 2, { refAno: 2027, status: "CANCELADO" }),
  ];

  it("conta paga, parcialmente paga ou cancelada nunca é editável", () => {
    expect(contas.filter(ocorrenciaEditavel).map((c) => c.id)).toEqual(["c11", "c12", "c13"]);
  });

  it("'só esta' mexe em uma; 'esta e as próximas' pega as futuras ainda em aberto", () => {
    const alvo = contas.find((c) => c.id === "c11")!;
    expect(ocorrenciasDoEscopo(contas, alvo, "ESTA").map((c) => c.id)).toEqual(["c11"]);
    expect(ocorrenciasDoEscopo(contas, alvo, "ESTA_E_PROXIMAS").map((c) => c.id)).toEqual(["c11", "c12", "c13"]);
    expect(ESCOPOS).toEqual(["ESTA", "ESTA_E_PROXIMAS"]);
  });

  it("o passado nunca entra: editar a de dezembro não toca setembro, outubro nem novembro", () => {
    const alvo = contas.find((c) => c.id === "c12")!;
    expect(ocorrenciasDoEscopo(contas, alvo, "ESTA_E_PROXIMAS").map((c) => c.id)).toEqual(["c12", "c13"]);
  });

  it("editar uma conta JÁ PAGA não alcança nada, em nenhum escopo", () => {
    const paga = contas.find((c) => c.id === "c9")!;
    expect(ocorrenciasDoEscopo(contas, paga, "ESTA")).toEqual([]);
    expect(ocorrenciasDoEscopo(contas, paga, "ESTA_E_PROXIMAS").map((c) => c.id)).toEqual(["c11", "c12", "c13"]);
  });

  it("'esta e as próximas' empurra o início da regra para a competência editada", () => {
    const r = regra({ inicioAno: 2026, inicioMes: 9 });
    expect(regraDoEscopo(r, { ano: 2026, mes: 11 }, { valor: 3000 })).toEqual({ valor: 3000, inicioAno: 2026, inicioMes: 11 });
    // editar uma competência anterior ao início não puxa a regra para trás
    expect(regraDoEscopo(r, { ano: 2026, mes: 8 }, { valor: 3000 })).toEqual({ valor: 3000, inicioAno: 2026, inicioMes: 9 });
  });
});

describe("validação da regra", () => {
  const base = { descricao: "Aluguel", diaVencimento: 10, passoMeses: 1, valor: 2500, inicioAno: 2026, inicioMes: 11 };

  it("aceita a regra completa, com qualquer um dos três términos", () => {
    expect(validarRegra(base)).toBeNull();
    expect(validarRegra({ ...base, fimAno: 2027, fimMes: 12 })).toBeNull();
    expect(validarRegra({ ...base, ocorrencias: 12 })).toBeNull();
  });

  it("recusa o que não dá para gerar", () => {
    expect(validarRegra({ ...base, descricao: "  " })).toContain("Descreva");
    expect(validarRegra({ ...base, diaVencimento: 0 })).toContain("Dia de vencimento");
    expect(validarRegra({ ...base, diaVencimento: 32 })).toContain("Dia de vencimento");
    expect(validarRegra({ ...base, passoMeses: 0 })).toContain("Repetir a cada");
    expect(validarRegra({ ...base, passoMeses: PASSO_MAX + 1 })).toContain("Repetir a cada");
    expect(validarRegra({ ...base, valor: 0 })).toContain("valor");
    expect(validarRegra({ ...base, valor: "abc" })).toContain("valor");
  });

  it("término: metade de uma data, ou dois términos ao mesmo tempo, não vale", () => {
    expect(validarRegra({ ...base, fimAno: 2027 })).toBe(MSG_TERMINO_INVALIDO);
    expect(validarRegra({ ...base, fimMes: 12 })).toBe(MSG_TERMINO_INVALIDO);
    expect(validarRegra({ ...base, fimAno: 2027, fimMes: 12, ocorrencias: 3 })).toBe(MSG_TERMINO_INVALIDO);
    expect(validarRegra({ ...base, ocorrencias: 0 })).toBe(MSG_TERMINO_INVALIDO);
    expect(validarRegra({ ...base, fimAno: 2026, fimMes: 10 })).toBe(MSG_FIM_ANTES_DO_INICIO);
  });
});
