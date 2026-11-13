/**
 * DESEMPENHO (manutenção) — as REGRAS, sem banco e sem tela (o servidor está em desempenho-pg):
 *  - competência: o mês é o de Brasília; soma de meses; período do mês;
 *  - a regra do perfil: pesos somam 100, faixas coerentes com a meta; TRAVADA no mês (a primeira vale
 *    já; mudança só no mês seguinte);
 *  - as métricas: no prazo (dia da conclusão × prazo ou dia agendado), relatório completo (regra do
 *    app + foto antes e depois), nota em percentual;
 *  - o escore: média ponderada do que TEM medição (sem dado não vira zero), menos as penalidades que
 *    contam; meta mínima; faixa; bônus projetado;
 *  - individual é a base: na atividade de equipe todos levam o resultado, uma vez cada; o encarregado
 *    é medido pelas equipes que lidera; equipe = média dos membros;
 *  - ranking por perfil com empate; retorno = só o último serviço antes da corretiva, dentro do prazo;
 *  - modo TV: a resposta não tem valor em reais;
 *  - a data de conclusão da atividade (o toque no aparelho, reabrir limpa).
 */
import { describe, expect, it } from "vitest";
import {
  MSG_FAIXA_ABAIXO_DA_META, MSG_FAIXA_MINIMO_REPETIDO, MSG_FAIXA_REPETIDA, MSG_MOTIVO, MSG_PESOS, PERFIS_INICIAIS, REGRA_SUGERIDA, SEM_MEDIDA,
  ajustesSchema, calcularEscore, competenciaAnterior, competenciaAtual, competenciaCurta, competenciaDe, competenciaSeguinte, concluidaNoPrazo, decisaoSchema,
  diaDeReferencia, ehCompetencia, ehRetorno, entradaDaGestao, entradaDoColaborador, faixaDoEscore, formatarEscore, lerFaixas, mediaDaEquipe, notaEmPercentual,
  origemDoRetorno, percentual, perfilSchema, periodoDaCompetencia, premiacaoSchema, ranquear, reclamacaoSchema, regraAgendada, regraSchema, regraVigente,
  relatorioCompleto, resumoDaPenalidade, rotuloCompetencia, somarMeses, temAntesEDepois, vigenciaDaMudanca,
  type AtividadeMedida, type EntradaEscore, type OsAvaliadaMedida, type Regra,
} from "@/lib/desempenho/regras";
import { lideradasPor, linhaDoColaborador, montarPainel, paraTv, type EquipeDoMes, type Medicao, type ParticipanteDoMes, type PerfilDoMes, type RegraDoMes } from "@/lib/desempenho/painel";
import { MAX_ATRASO_CONCLUSAO_MS, marcaDeConclusao, momentoDaConclusao } from "@/lib/os/conclusao-atividade";
import { MODULOS, PRESETS, moduloDaRota, permissoesTotais, pode, rotuloPermissao } from "@/lib/permissoes";

const REGRA: Regra = {
  pesoPrazo: 40, pesoRelatorio: 30, pesoAvaliacao: 30, exigirFotoAntesDepois: true, penalidadeRetorno: 5, penalidadeReclamacao: 3, metaMinima: 70,
  faixas: [{ nome: "Bronze", minimo: 70, valor: 100 }, { nome: "Prata", minimo: 80, valor: 200 }, { nome: "Ouro", minimo: 90, valor: 350 }],
};
const entrada = (x: Partial<EntradaEscore> = {}): EntradaEscore => ({
  prazo: { certos: 3, total: 4 }, relatorio: { certos: 4, total: 4 }, avaliacao: { media: 4.67, avaliacoes: 3 }, retornos: 0, reclamacoes: 0, ...x,
});

describe("competência: o mês é o de Brasília", () => {
  it("o instante vira o mês de Brasília — 01/12 às 02:00 UTC ainda é novembro lá", () => {
    expect(competenciaDe(new Date("2026-12-01T02:00:00Z"))).toBe("2026-11");
    expect(competenciaDe(new Date("2026-12-01T03:00:00Z"))).toBe("2026-12");
    expect(competenciaDe("2026-11-13T15:00:00Z")).toBe("2026-11");
    expect(competenciaAtual(new Date("2027-01-01T02:59:59Z"))).toBe("2026-12");
  });

  it("soma de meses atravessa o ano, para frente e para trás", () => {
    expect(competenciaSeguinte("2026-11")).toBe("2026-12");
    expect(competenciaSeguinte("2026-12")).toBe("2027-01");
    expect(competenciaAnterior("2027-01")).toBe("2026-12");
    expect(competenciaAnterior("2026-03")).toBe("2026-02");
    expect(somarMeses("2026-11", 14)).toBe("2028-01");
    expect(somarMeses("2026-01", -13)).toBe("2024-12");
    expect(somarMeses("2026-06", 0)).toBe("2026-06");
  });

  it("o período do mês começa e termina à meia-noite de Brasília (03:00 UTC); o fim é o início do mês seguinte", () => {
    expect(periodoDaCompetencia("2026-11")).toEqual({ de: new Date("2026-11-01T03:00:00Z"), ate: new Date("2026-12-01T03:00:00Z") });
    expect(periodoDaCompetencia("2026-12")).toEqual({ de: new Date("2026-12-01T03:00:00Z"), ate: new Date("2027-01-01T03:00:00Z") });
    // Fevereiro: o período segue o calendário, não 30 dias fixos
    expect(periodoDaCompetencia("2027-02").ate).toEqual(new Date("2027-03-01T03:00:00Z"));
  });

  it("formato: só 'AAAA-MM' com mês de 01 a 12; rótulos por extenso e curto", () => {
    for (const ok of ["2026-01", "2026-12", "1999-09"]) expect(ehCompetencia(ok), ok).toBe(true);
    for (const ruim of ["2026-13", "2026-00", "2026-1", "26-11", "2026-11-01", "", null, undefined, 202611]) expect(ehCompetencia(ruim), String(ruim)).toBe(false);
    expect(rotuloCompetencia("2026-11")).toBe("novembro de 2026");
    expect(rotuloCompetencia("2027-01")).toBe("janeiro de 2027");
    expect(rotuloCompetencia("2026-03")).toBe("março de 2026");
    expect(competenciaCurta("2026-11")).toBe("11/2026");
  });
});

describe("a regra do perfil: pesos, meta e faixas", () => {
  const valida = { ...REGRA };
  const erro = (x: object) => { const r = regraSchema.safeParse({ ...valida, ...x }); return r.success ? null : r.error.issues[0].message; };

  it("aceita a regra completa e devolve as faixas em ordem de escore", () => {
    const r = regraSchema.parse({ ...valida, faixas: [valida.faixas[2], valida.faixas[0], valida.faixas[1]] });
    expect(r.faixas.map((f) => f.nome)).toEqual(["Bronze", "Prata", "Ouro"]);
    expect(r).toEqual(valida);
    expect(erro({})).toBeNull();
  });

  it("os pesos precisam somar exatamente 100 — peso zero é permitido (tira a métrica da conta)", () => {
    expect(erro({ pesoPrazo: 50 })).toBe(MSG_PESOS);
    expect(erro({ pesoPrazo: 30 })).toBe(MSG_PESOS);
    expect(erro({ pesoPrazo: 0, pesoRelatorio: 0, pesoAvaliacao: 0 })).toBe(MSG_PESOS);
    expect(erro({ pesoPrazo: 50, pesoRelatorio: 0, pesoAvaliacao: 50 })).toBeNull();
    expect(erro({ pesoPrazo: 100, pesoRelatorio: 0, pesoAvaliacao: 0 })).toBeNull();
    expect(erro({ pesoPrazo: -10, pesoRelatorio: 80 })).toMatch(/mínimo 0/);
    expect(erro({ pesoPrazo: 40.5, pesoRelatorio: 29.5 })).toMatch(/inteiro/);
    expect(erro({ pesoPrazo: "40" })).toMatch(/informe um número/);
  });

  it("faixas: pelo menos uma, no máximo seis, nomes e inícios diferentes, nenhuma abaixo da meta", () => {
    expect(erro({ faixas: [] })).toMatch(/pelo menos uma faixa/);
    expect(erro({ faixas: Array.from({ length: 7 }, (_, i) => ({ nome: `F${i}`, minimo: 70 + i, valor: 0 })) })).toMatch(/No máximo 6/);
    expect(erro({ faixas: Array.from({ length: 6 }, (_, i) => ({ nome: `F${i}`, minimo: 70 + i, valor: 0 })) })).toBeNull();
    expect(erro({ faixas: [{ nome: "Ouro", minimo: 70, valor: 1 }, { nome: " ouro ", minimo: 80, valor: 2 }] })).toBe(MSG_FAIXA_REPETIDA);
    expect(erro({ faixas: [{ nome: "A", minimo: 80, valor: 1 }, { nome: "B", minimo: 80, valor: 2 }] })).toBe(MSG_FAIXA_MINIMO_REPETIDO);
    expect(erro({ faixas: [{ nome: "A", minimo: 69, valor: 1 }] })).toBe(MSG_FAIXA_ABAIXO_DA_META);
    expect(erro({ faixas: [{ nome: "A", minimo: 70, valor: 1 }] })).toBeNull(); // começar NA meta pode
    expect(erro({ faixas: [{ nome: "", minimo: 70, valor: 1 }] })).toMatch(/nome à faixa/);
    expect(erro({ faixas: [{ nome: "A", minimo: 101, valor: 1 }] })).toMatch(/máximo 100/);
    expect(erro({ faixas: [{ nome: "A", minimo: 70, valor: -1 }] })).toMatch(/negativo/);
    expect(erro({ faixas: [{ nome: "A", minimo: 70, valor: Number.NaN }] })).toMatch(/informe um número/);
  });

  it("o valor do bônus guarda centavos (2 casas); zero é permitido (faixa sem bônus)", () => {
    const r = regraSchema.parse({ ...valida, faixas: [{ nome: "Bronze", minimo: 70, valor: 99.999 }, { nome: "Prata", minimo: 80, valor: 150.5 }, { nome: "Ouro", minimo: 90, valor: 0 }] });
    expect(r.faixas.map((f) => f.valor)).toEqual([100, 150.5, 0]);
  });

  it("meta e penalidades são de 0 a 100; campos fora da regra são recusados (objeto estrito)", () => {
    expect(erro({ metaMinima: 101 })).toMatch(/Meta mínima: máximo 100/);
    expect(erro({ metaMinima: 0, faixas: [{ nome: "A", minimo: 0, valor: 1 }] })).toBeNull();
    expect(erro({ penalidadeRetorno: -1 })).toMatch(/Pontos por retorno: mínimo 0/);
    expect(erro({ penalidadeReclamacao: 101 })).toMatch(/Pontos por reclamação: máximo 100/);
    expect(erro({ exigirFotoAntesDepois: "sim" })).not.toBeNull();
    expect(regraSchema.safeParse({ ...valida, vigenteDesde: "2020-01" }).success).toBe(false); // ninguém escolhe a vigência pela tela
  });

  it("a sugestão do formulário é uma regra válida, com os valores em branco (ninguém inventa o bônus)", () => {
    expect(regraSchema.safeParse(REGRA_SUGERIDA).success).toBe(true);
    expect(REGRA_SUGERIDA.faixas.map((f) => `${f.nome}:${f.minimo}:${f.valor}`)).toEqual(["Bronze:70:0", "Prata:80:0", "Ouro:90:0"]);
    expect(PERFIS_INICIAIS).toEqual([
      { nome: "Preventiva", tipo: "TECNICO" }, { nome: "Corretiva", tipo: "TECNICO" }, { nome: "Instalação", tipo: "TECNICO" }, { nome: "Encarregado", tipo: "GESTAO" },
    ]);
  });

  it("faixas gravadas (JSON): só o que tem a forma certa, em ordem; lixo vira lista vazia", () => {
    expect(lerFaixas([{ nome: "Ouro", minimo: 90, valor: 3 }, { nome: "Bronze", minimo: 70, valor: 1 }])).toEqual([{ nome: "Bronze", minimo: 70, valor: 1 }, { nome: "Ouro", minimo: 90, valor: 3 }]);
    expect(lerFaixas([{ nome: "A", minimo: 70, valor: 1, lixo: true }, { nome: 5, minimo: 1, valor: 1 }, null, "x", { nome: "B", minimo: "x", valor: 1 }])).toEqual([{ nome: "A", minimo: 70, valor: 1 }]);
    for (const lixo of [null, undefined, "texto", 5, {}]) expect(lerFaixas(lixo)).toEqual([]);
  });
});

describe("vigência: a regra é travada no mês", () => {
  const regras = [{ vigenteDesde: "2026-09", n: 1 }, { vigenteDesde: "2026-11", n: 2 }, { vigenteDesde: "2027-01", n: 3 }];

  it("a regra do mês é a mais recente que já começou — a de um mês futuro não vale antes", () => {
    expect(regraVigente(regras, "2026-08")).toBeNull();
    expect(regraVigente(regras, "2026-09")?.n).toBe(1);
    expect(regraVigente(regras, "2026-10")?.n).toBe(1);
    expect(regraVigente(regras, "2026-11")?.n).toBe(2);
    expect(regraVigente(regras, "2026-12")?.n).toBe(2);
    expect(regraVigente(regras, "2027-01")?.n).toBe(3);
    expect(regraVigente([...regras].reverse(), "2026-12")?.n).toBe(2); // a ordem em que vêm do banco não importa
    expect(regraVigente([], "2026-11")).toBeNull();
  });

  it("a mudança agendada é a mais próxima depois do mês corrente", () => {
    expect(regraAgendada(regras, "2026-11")?.n).toBe(3);
    expect(regraAgendada(regras, "2026-08")?.n).toBe(1);
    expect(regraAgendada(regras, "2027-01")).toBeNull();
    expect(regraAgendada([{ vigenteDesde: "2027-03", n: 9 }, ...regras], "2026-12")?.n).toBe(3);
  });

  it("a PRIMEIRA regra vale já no mês corrente; mudança depois só vale no mês seguinte (não retroage)", () => {
    expect(vigenciaDaMudanca([], "2026-11")).toBe("2026-11");
    expect(vigenciaDaMudanca([{ vigenteDesde: "2026-11" }], "2026-11")).toBe("2026-12");
    expect(vigenciaDaMudanca([{ vigenteDesde: "2026-09" }], "2026-12")).toBe("2027-01");
    // Só existe regra para o futuro (agendada): o mês corrente continua sem regra, então a que se salva agora vale já
    expect(vigenciaDaMudanca([{ vigenteDesde: "2027-01" }], "2026-11")).toBe("2026-11");
  });
});

describe("no prazo: o dia da conclusão × o prazo da atividade (ou o dia agendado)", () => {
  const dia = (d: string) => new Date(`${d}T00:00:00Z`);                 // prazo: dia civil, como o banco guarda
  const hora = (d: string, h: string) => new Date(`${d}T${h}:00-03:00`); // instante no relógio de Brasília

  it("concluída até o fim do dia do prazo = no prazo; no dia seguinte = fora", () => {
    expect(concluidaNoPrazo({ concluidaEm: hora("2026-11-10", "08:00"), prazo: dia("2026-11-10"), dataAgendada: null })).toBe(true);
    expect(concluidaNoPrazo({ concluidaEm: hora("2026-11-10", "23:59"), prazo: dia("2026-11-10"), dataAgendada: null })).toBe(true);
    expect(concluidaNoPrazo({ concluidaEm: hora("2026-11-11", "00:01"), prazo: dia("2026-11-10"), dataAgendada: null })).toBe(false);
    expect(concluidaNoPrazo({ concluidaEm: hora("2026-11-05", "10:00"), prazo: dia("2026-11-10"), dataAgendada: null })).toBe(true); // antes do prazo
  });

  it("o dia é o de Brasília: 23h de lá já é o dia seguinte em UTC, e continua no prazo", () => {
    const concluidaEm = new Date("2026-11-11T02:30:00Z"); // 10/11 às 23:30 em Brasília
    expect(concluidaNoPrazo({ concluidaEm, prazo: dia("2026-11-10"), dataAgendada: null })).toBe(true);
    expect(concluidaNoPrazo({ concluidaEm: new Date("2026-11-11T03:30:00Z"), prazo: dia("2026-11-10"), dataAgendada: null })).toBe(false);
  });

  it("sem prazo próprio vale o dia agendado; com os dois, vale o prazo", () => {
    const agendada = hora("2026-11-10", "09:00");
    expect(concluidaNoPrazo({ concluidaEm: hora("2026-11-10", "18:00"), prazo: null, dataAgendada: agendada })).toBe(true);
    expect(concluidaNoPrazo({ concluidaEm: hora("2026-11-11", "09:00"), prazo: null, dataAgendada: agendada })).toBe(false);
    expect(concluidaNoPrazo({ concluidaEm: hora("2026-11-12", "09:00"), prazo: dia("2026-11-12"), dataAgendada: agendada })).toBe(true);
    expect(diaDeReferencia({ prazo: dia("2026-11-12"), dataAgendada: agendada })).toBe("2026-11-12");
    expect(diaDeReferencia({ prazo: null, dataAgendada: new Date("2026-11-11T01:00:00Z") })).toBe("2026-11-10"); // agendada às 22h de Brasília do dia 10
    expect(diaDeReferencia({ prazo: null, dataAgendada: null })).toBeNull();
  });

  it("sem data de conclusão (concluída antes de o sistema guardar) ou sem prazo nem agenda: NÃO se mede — null, nunca falso", () => {
    expect(concluidaNoPrazo({ concluidaEm: null, prazo: dia("2026-11-10"), dataAgendada: null })).toBeNull();
    expect(concluidaNoPrazo({ concluidaEm: hora("2026-11-10", "10:00"), prazo: null, dataAgendada: null })).toBeNull();
  });
});

describe("relatório completo: a regra do app + foto antes e depois", () => {
  it("foto antes E depois: as duas, em qualquer ordem; foto sem momento não conta", () => {
    expect(temAntesEDepois([{ momento: "ANTES" }, { momento: "DEPOIS" }])).toBe(true);
    expect(temAntesEDepois([{ momento: "DEPOIS" }, { momento: null }, { momento: "ANTES" }])).toBe(true);
    expect(temAntesEDepois([{ momento: "ANTES" }, { momento: "ANTES" }])).toBe(false);
    expect(temAntesEDepois([{ momento: "DEPOIS" }])).toBe(false);
    expect(temAntesEDepois([{ momento: null }, { momento: null }])).toBe(false);
    expect(temAntesEDepois([])).toBe(false);
  });

  it("vale por equipamento atendido: basta um incompleto para o relatório da atividade não ser completo", () => {
    const ok = { completo: true, antesEDepois: true };
    expect(relatorioCompleto([ok, ok], true)).toBe(true);
    expect(relatorioCompleto([ok, { completo: false, antesEDepois: true }], true)).toBe(false);
    expect(relatorioCompleto([ok, { completo: true, antesEDepois: false }], true)).toBe(false);
  });

  it("o perfil que NÃO exige foto antes/depois aceita o checklist do app sozinho — mas o checklist continua valendo", () => {
    expect(relatorioCompleto([{ completo: true, antesEDepois: false }], false)).toBe(true);
    expect(relatorioCompleto([{ completo: false, antesEDepois: true }], false)).toBe(false);
  });

  it("sem equipamento atendido não há relatório para medir (null, não zero)", () => {
    expect(relatorioCompleto([], true)).toBeNull();
    expect(relatorioCompleto([], false)).toBeNull();
  });
});

describe("o escore: índice de qualidade de 0 a 100", () => {
  it("percentuais: acertos sobre o medido, com 1 casa; nada medido = null; nota de 1 a 5 na escala de 100", () => {
    expect(percentual({ certos: 3, total: 4 })).toBe(75);
    expect(percentual({ certos: 2, total: 3 })).toBe(66.7);
    expect(percentual({ certos: 0, total: 5 })).toBe(0);
    expect(percentual(SEM_MEDIDA)).toBeNull();
    expect(notaEmPercentual(5)).toBe(100);
    expect(notaEmPercentual(4)).toBe(80);
    expect(notaEmPercentual(4.67)).toBe(93.4);
    expect(notaEmPercentual(1)).toBe(20);
  });

  it("média ponderada pelos pesos: 75% × 40 + 100% × 30 + 93,4% × 30 = 88,0 — com os números de cada métrica", () => {
    const e = calcularEscore(REGRA, entrada());
    expect(e.escore).toBe(88);
    expect(e.base).toBe(88);
    expect(e.desconto).toBe(0);
    expect(e.composicao).toEqual([
      { metrica: "prazo", peso: 40, valor: 75, pontos: 30, detalhe: "3 de 4 atividades" },
      { metrica: "relatorio", peso: 30, valor: 100, pontos: 30, detalhe: "4 de 4 relatórios" },
      { metrica: "avaliacao", peso: 30, valor: 93.4, pontos: 28, detalhe: "média 4,7 em 3 avaliações" },
    ]);
    expect(e.atingiuMeta).toBe(true);
    expect(e.faixa?.nome).toBe("Prata");
    expect(e.bonus).toBe(200);
  });

  it("NÃO é volume: 2 de 2 vale o mesmo que 40 de 40; quem fez muito e mal fica abaixo de quem fez pouco e bem", () => {
    const pouco = calcularEscore(REGRA, entrada({ prazo: { certos: 2, total: 2 }, relatorio: { certos: 2, total: 2 }, avaliacao: { media: 5, avaliacoes: 1 } }));
    const muito = calcularEscore(REGRA, entrada({ prazo: { certos: 40, total: 40 }, relatorio: { certos: 40, total: 40 }, avaliacao: { media: 5, avaliacoes: 30 } }));
    const muitoEMal = calcularEscore(REGRA, entrada({ prazo: { certos: 20, total: 40 }, relatorio: { certos: 20, total: 40 }, avaliacao: { media: 3, avaliacoes: 30 } }));
    expect(pouco.escore).toBe(100);
    expect(muito.escore).toBe(100);
    expect(muitoEMal.escore).toBe(53);
  });

  it("métrica SEM medição não vira zero: sai da conta e o peso é repartido entre as outras", () => {
    // Sem avaliação no mês: sobram prazo (40) e relatório (30) → 75×40/70 + 100×30/70 = 42,9 + 42,9 = 85,7
    const e = calcularEscore(REGRA, entrada({ avaliacao: { media: null, avaliacoes: 0 } }));
    expect(e.escore).toBe(85.7);
    expect(e.composicao.map((c) => `${c.metrica}:${c.valor}:${c.pontos}`)).toEqual(["prazo:75:42.9", "relatorio:100:42.9", "avaliacao:null:null"]);
    expect(e.composicao[2].detalhe).toBe("sem avaliação no mês");
    // Só a avaliação medida: ela sozinha é o escore
    const so = calcularEscore(REGRA, entrada({ prazo: SEM_MEDIDA, relatorio: SEM_MEDIDA, avaliacao: { media: 4, avaliacoes: 1 } }));
    expect(so.escore).toBe(80);
    expect(so.composicao[0].detalhe).toBe("sem medição no mês");
    expect(so.composicao[2].detalhe).toBe("média 4,0 em 1 avaliação");
  });

  it("nada medido = sem escore (null): não é zero, não tem faixa nem bônus — mesmo com penalidade", () => {
    const vazio = { prazo: SEM_MEDIDA, relatorio: SEM_MEDIDA, avaliacao: { media: null, avaliacoes: 0 } };
    const e = calcularEscore(REGRA, entrada({ ...vazio, retornos: 2 }));
    expect(e).toMatchObject({ escore: null, base: null, atingiuMeta: false, faixa: null, bonus: 0, desconto: 10 });
    expect(e.composicao.every((c) => c.pontos === null)).toBe(true);
  });

  it("peso zero tira a métrica da conta, mesmo com dado (perfil de gestão: só prazo e satisfação)", () => {
    const gestao: Regra = { ...REGRA, pesoPrazo: 50, pesoRelatorio: 0, pesoAvaliacao: 50 };
    const e = calcularEscore(gestao, entrada({ prazo: { certos: 3, total: 3 }, relatorio: { certos: 0, total: 3 }, avaliacao: { media: 4, avaliacoes: 2 } }));
    expect(e.escore).toBe(90);
    expect(e.composicao[1]).toMatchObject({ valor: 0, pontos: 0, peso: 0 });
    // Só a métrica de peso zero tem medição: não há o que ponderar
    expect(calcularEscore(gestao, entrada({ prazo: SEM_MEDIDA, avaliacao: { media: null, avaliacoes: 0 } })).escore).toBeNull();
  });

  it("penalidades que CONTAM descontam pontos: retorno e reclamação têm pesos próprios", () => {
    const e = calcularEscore(REGRA, entrada({ retornos: 2, reclamacoes: 1 }));
    expect(e.penalidades).toEqual({ retornos: 2, reclamacoes: 1, pontosRetorno: 10, pontosReclamacao: 3 });
    expect(e.desconto).toBe(13);
    expect(e.base).toBe(88);
    expect(e.escore).toBe(75);
    expect(e.faixa?.nome).toBe("Bronze");
    expect(e.bonus).toBe(100);
  });

  it("o escore nunca fica abaixo de zero nem acima de 100", () => {
    expect(calcularEscore(REGRA, entrada({ retornos: 50 })).escore).toBe(0);
    expect(calcularEscore({ ...REGRA, penalidadeRetorno: 0, penalidadeReclamacao: 0 }, entrada({ prazo: { certos: 9, total: 9 }, avaliacao: { media: 5, avaliacoes: 1 }, retornos: 9, reclamacoes: 9 })).escore).toBe(100);
  });

  it("META MÍNIMA é o portão: abaixo dela não há faixa nem bônus, mesmo que uma faixa comece mais baixo", () => {
    const frouxa: Regra = { ...REGRA, metaMinima: 70, faixas: [{ nome: "Bronze", minimo: 70, valor: 100 }] };
    const abaixo = calcularEscore(frouxa, entrada({ prazo: { certos: 1, total: 4 }, relatorio: { certos: 2, total: 4 }, avaliacao: { media: 3, avaliacoes: 2 } }));
    expect(abaixo.escore).toBe(43);
    expect(abaixo).toMatchObject({ atingiuMeta: false, faixa: null, bonus: 0 });
    expect(faixaDoEscore([{ nome: "Baixa", minimo: 50, valor: 10 }], 60, 70)).toBeNull();
    // Ficar EXATAMENTE na meta atinge a meta (7 de 10 no prazo e nos relatórios, nota 3,5 = 70,0)
    const naMeta = calcularEscore(frouxa, entrada({ prazo: { certos: 7, total: 10 }, relatorio: { certos: 7, total: 10 }, avaliacao: { media: 3.5, avaliacoes: 2 } }));
    expect(naMeta).toMatchObject({ escore: 70, atingiuMeta: true, bonus: 100 });
    expect(naMeta.faixa?.nome).toBe("Bronze");
    expect(faixaDoEscore([{ nome: "Baixa", minimo: 50, valor: 10 }], 70, 70)?.nome).toBe("Baixa");
  });

  it("faixa: a mais alta que o escore alcança; o limite é inclusivo; passou da meta sem alcançar faixa = sem faixa", () => {
    const f = REGRA.faixas;
    expect(faixaDoEscore(f, 69.9, 70)).toBeNull();
    expect(faixaDoEscore(f, 70, 70)?.nome).toBe("Bronze");
    expect(faixaDoEscore(f, 79.9, 70)?.nome).toBe("Bronze");
    expect(faixaDoEscore(f, 80, 70)?.nome).toBe("Prata");
    expect(faixaDoEscore(f, 90, 70)?.nome).toBe("Ouro");
    expect(faixaDoEscore(f, 100, 70)?.nome).toBe("Ouro");
    expect(faixaDoEscore([...f].reverse(), 85, 70)?.nome).toBe("Prata"); // a ordem das faixas não importa
    expect(faixaDoEscore([{ nome: "Ouro", minimo: 90, valor: 1 }], 75, 70)).toBeNull();
    expect(faixaDoEscore(f, null, 70)).toBeNull();
    const semFaixa = calcularEscore({ ...REGRA, faixas: [{ nome: "Ouro", minimo: 90, valor: 350 }] }, entrada());
    expect(semFaixa).toMatchObject({ escore: 88, atingiuMeta: true, faixa: null, bonus: 0 });
  });

  it("textos: o escore com vírgula e 1 casa; sem medição é um traço; singular e plural nos números", () => {
    expect(formatarEscore(88)).toBe("88,0%");
    expect(formatarEscore(66.7)).toBe("66,7%");
    expect(formatarEscore(0)).toBe("0,0%");
    expect(formatarEscore(null)).toBe("—");
    expect(formatarEscore(undefined)).toBe("—");
    const um = calcularEscore(REGRA, entrada({ prazo: { certos: 1, total: 1 }, relatorio: { certos: 0, total: 1 } }));
    expect(um.composicao.map((c) => c.detalhe).slice(0, 2)).toEqual(["1 de 1 atividade", "0 de 1 relatório"]);
  });

  it("retorno pesa pelos pontos de retorno; ressalva, nota baixa e reclamação pelos de reclamação", () => {
    expect(ehRetorno("RETORNO")).toBe(true);
    for (const t of ["RESSALVA", "NOTA_BAIXA", "RECLAMACAO", ""]) expect(ehRetorno(t), t).toBe(false);
  });
});

describe("individual é a base; equipe e encarregado são resumos", () => {
  const ok = [{ completo: true, antesEDepois: true }];
  const A: AtividadeMedida[] = [
    { id: "a1", ordemServicoId: "o1", equipeId: null, executores: ["ana"], noPrazo: true, equipamentos: ok },
    { id: "a2", ordemServicoId: "o2", equipeId: "alfa", executores: ["bia", "caio"], noPrazo: false, equipamentos: [{ completo: true, antesEDepois: false }] }, // atividade de equipe
    { id: "a3", ordemServicoId: "o3", equipeId: null, executores: ["bia"], noPrazo: null, equipamentos: [] },                                        // sem prazo e sem equipamento
    { id: "a4", ordemServicoId: "o4", equipeId: "beta", executores: ["dani"], noPrazo: true, equipamentos: ok },
  ];
  const avaliadas: OsAvaliadaMedida[] = [
    { ordemServicoId: "o2", avaliacao: 3, executores: ["bia", "caio"], equipeIds: ["alfa"] },
    { ordemServicoId: "o4", avaliacao: 5, executores: ["dani"], equipeIds: ["beta"] },
    { ordemServicoId: "o1", avaliacao: 4, executores: ["ana"], equipeIds: [] },
  ];

  it("atividade de equipe: TODOS os executores levam o resultado — uma vez cada, sem dobrar", () => {
    const bia = entradaDoColaborador("bia", A, { media: 3, avaliacoes: 1 }, undefined, true);
    const caio = entradaDoColaborador("caio", A, { media: 3, avaliacoes: 1 }, undefined, true);
    expect(bia.prazo).toEqual({ certos: 0, total: 1 });      // a2 (atrasada); a3 não tem como medir
    expect(bia.relatorio).toEqual({ certos: 0, total: 1 });  // a2 sem foto depois; a3 sem equipamento
    expect(caio.prazo).toEqual(bia.prazo);
    expect(caio.relatorio).toEqual(bia.relatorio);
    expect(entradaDoColaborador("ana", A, undefined, undefined, true)).toEqual({
      prazo: { certos: 1, total: 1 }, relatorio: { certos: 1, total: 1 }, avaliacao: { media: null, avaliacoes: 0 }, retornos: 0, reclamacoes: 0,
    });
  });

  it("a exigência de foto antes/depois é do perfil: o mesmo relatório é completo num e incompleto no outro", () => {
    expect(entradaDoColaborador("bia", A, undefined, undefined, false).relatorio).toEqual({ certos: 1, total: 1 });
    expect(entradaDoColaborador("bia", A, undefined, undefined, true).relatorio).toEqual({ certos: 0, total: 1 });
  });

  it("as penalidades do colaborador entram como vieram (só as que contam chegam aqui)", () => {
    expect(entradaDoColaborador("ana", A, undefined, { retornos: 2, reclamacoes: 1 }, true)).toMatchObject({ retornos: 2, reclamacoes: 1 });
  });

  it("encarregado: as atividades da equipe (pela equipe OU por um membro) e a satisfação dessas OS, cada uma contada uma vez", () => {
    const alfa = entradaDaGestao({ equipeIds: ["alfa"], membros: ["bia", "caio"] }, A, avaliadas, undefined, true);
    expect(alfa.prazo).toEqual({ certos: 0, total: 1 });     // a2 (dois membros nela, conta UMA vez); a3 da Bia não tem prazo
    expect(alfa.relatorio).toEqual({ certos: 0, total: 1 });
    expect(alfa.avaliacao).toEqual({ media: 3, avaliacoes: 1 }); // a OS o2 conta uma vez, mesmo com dois membros
    // Lidera duas equipes: junta as duas
    const duas = entradaDaGestao({ equipeIds: ["alfa", "beta"], membros: ["bia", "caio", "dani"] }, A, avaliadas, { retornos: 0, reclamacoes: 1 }, true);
    expect(duas.prazo).toEqual({ certos: 1, total: 2 });
    expect(duas.avaliacao).toEqual({ media: 4, avaliacoes: 2 });
    expect(duas.reclamacoes).toBe(1);
  });

  it("encarregado: atividade marcada para a equipe conta mesmo se quem executou saiu dela; quem não lidera ninguém não tem medição", () => {
    const sozinha = entradaDaGestao({ equipeIds: ["beta"], membros: [] }, A, avaliadas, undefined, true);
    expect(sozinha.prazo).toEqual({ certos: 1, total: 1 });
    expect(sozinha.avaliacao).toEqual({ media: 5, avaliacoes: 1 });
    const ninguem = entradaDaGestao({ equipeIds: [], membros: [] }, A, avaliadas, undefined, true);
    expect(ninguem).toEqual({ prazo: SEM_MEDIDA, relatorio: SEM_MEDIDA, avaliacao: { media: null, avaliacoes: 0 }, retornos: 0, reclamacoes: 0 });
  });

  it("a média da satisfação da equipe tem 2 casas (4, 5 e 5 = 4,67)", () => {
    const tres: OsAvaliadaMedida[] = [4, 5, 5].map((avaliacao, i) => ({ ordemServicoId: `x${i}`, avaliacao, executores: ["bia"], equipeIds: [] }));
    expect(entradaDaGestao({ equipeIds: [], membros: ["bia"] }, [], tres, undefined, true).avaliacao).toEqual({ media: 4.67, avaliacoes: 3 });
  });

  it("equipe = média simples dos escores de quem tem medição; sem ninguém medido, sem escore", () => {
    expect(mediaDaEquipe([84, 90])).toBe(87);
    expect(mediaDaEquipe([84, null, 90])).toBe(87);
    expect(mediaDaEquipe([70, 75, 80.5])).toBe(75.2);
    expect(mediaDaEquipe([null, null])).toBeNull();
    expect(mediaDaEquipe([])).toBeNull();
    expect(mediaDaEquipe([0, 100])).toBe(50); // zero é escore, não ausência
  });
});

describe("ranking por perfil", () => {
  it("maior escore primeiro; empate divide a posição (1º, 1º, 3º); sem medição fica no fim, sem posição", () => {
    const r = ranquear([{ nome: "Edu", escore: 80 }, { nome: "Ana", escore: 90 }, { nome: "Zeca", escore: null }, { nome: "Bia", escore: 90 }, { nome: "Caio", escore: 0 }]);
    expect(r.map((x) => `${x.posicao ?? "-"}:${x.nome}`)).toEqual(["1:Ana", "1:Bia", "3:Edu", "4:Caio", "-:Zeca"]);
  });

  it("escore zero é posição de verdade (não é 'sem medição'); lista vazia e de um só", () => {
    expect(ranquear([{ nome: "A", escore: 0 }, { nome: "B", escore: null }]).map((x) => x.posicao)).toEqual([1, null]);
    expect(ranquear([])).toEqual([]);
    expect(ranquear([{ nome: "Só", escore: 71 }])).toEqual([{ nome: "Só", escore: 71, posicao: 1 }]);
  });

  it("não altera a lista recebida", () => {
    const lista = [{ nome: "B", escore: 1 }, { nome: "A", escore: 2 }];
    ranquear(lista);
    expect(lista.map((x) => x.nome)).toEqual(["B", "A"]);
  });
});

describe("retorno: de qual serviço a OS corretiva 'volta'", () => {
  const d = (dia: number, h = 12) => new Date(Date.UTC(2026, 10, dia, h));
  const servico = (atividadeId: string, ordemServicoId: string, dia: number) => ({ atividadeId, ordemServicoId, feitoEm: d(dia) });
  const corretiva = { ordemServicoId: "osC", abertaEm: d(20) };

  it("o ÚLTIMO serviço antes da abertura, dentro do prazo de N dias", () => {
    const servicos = [servico("a1", "os1", 2), servico("a2", "os2", 15), servico("a3", "os3", 10)];
    expect(origemDoRetorno(servicos, corretiva, 30)?.atividadeId).toBe("a2");
    expect(origemDoRetorno([...servicos].reverse(), corretiva, 30)?.atividadeId).toBe("a2");
  });

  it("só o último conta: se ele está fora do prazo, não é retorno — um mais antigo não assume o lugar", () => {
    expect(origemDoRetorno([servico("a1", "os1", 2)], corretiva, 10)).toBeNull();           // 18 dias antes, prazo de 10
    expect(origemDoRetorno([servico("a1", "os1", 2)], corretiva, 18)?.atividadeId).toBe("a1"); // exatamente no limite: conta
    expect(origemDoRetorno([servico("a1", "os1", 2)], corretiva, 17)).toBeNull();
  });

  it("serviço da PRÓPRIA OS corretiva e serviço feito depois (ou na hora) da abertura não são origem", () => {
    expect(origemDoRetorno([servico("x", "osC", 19)], corretiva, 30)).toBeNull();
    expect(origemDoRetorno([servico("x", "os9", 21)], corretiva, 30)).toBeNull();
    expect(origemDoRetorno([{ atividadeId: "x", ordemServicoId: "os9", feitoEm: d(20) }], corretiva, 30)).toBeNull();
    expect(origemDoRetorno([servico("a1", "os1", 5), servico("x", "osC", 19), servico("y", "os9", 25)], corretiva, 30)?.atividadeId).toBe("a1");
    expect(origemDoRetorno([], corretiva, 30)).toBeNull();
  });
});

describe("o que a tela manda", () => {
  it("perfil: nome de 2 a 40 caracteres (aparado) e tipo de campo ou de gestão", () => {
    expect(perfilSchema.parse({ nome: "  Preventiva  ", tipo: "TECNICO" })).toEqual({ nome: "Preventiva", tipo: "TECNICO" });
    expect(perfilSchema.safeParse({ nome: "A", tipo: "TECNICO" }).success).toBe(false);
    expect(perfilSchema.safeParse({ nome: "x".repeat(41), tipo: "GESTAO" }).success).toBe(false);
    expect(perfilSchema.safeParse({ nome: "x".repeat(40), tipo: "GESTAO" }).success).toBe(true);
    const tipo = perfilSchema.safeParse({ nome: "Ok", tipo: "CHEFE" });
    expect(tipo.success ? "" : tipo.error.issues[0].message).toBe("Escolha o tipo do perfil.");
    expect(perfilSchema.safeParse({ nome: "Ok", tipo: "TECNICO", empresaId: "outra" }).success).toBe(false);
  });

  it("ajustes: prazo do retorno de 1 a 365 dias; nota baixa de 1 a 4 (5 estrelas nunca é nota baixa)", () => {
    const ok = { retornoDias: 30, notaBaixaAte: 2, tiposRetorno: ["t1"] };
    expect(ajustesSchema.safeParse(ok).success).toBe(true);
    for (const retornoDias of [0, 366, 1.5, -1]) expect(ajustesSchema.safeParse({ ...ok, retornoDias }).success, String(retornoDias)).toBe(false);
    for (const retornoDias of [1, 365]) expect(ajustesSchema.safeParse({ ...ok, retornoDias }).success).toBe(true);
    for (const notaBaixaAte of [0, 5]) expect(ajustesSchema.safeParse({ ...ok, notaBaixaAte }).success, String(notaBaixaAte)).toBe(false);
    for (const notaBaixaAte of [1, 4]) expect(ajustesSchema.safeParse({ ...ok, notaBaixaAte }).success).toBe(true);
    expect(ajustesSchema.safeParse({ ...ok, tiposRetorno: [] }).success).toBe(true); // nenhum tipo marcado: nenhum retorno é detectado
  });

  it("decisão: 'conta' e 'não conta' EXIGEM motivo (mín. 5); voltar para 'a revisar' limpa o motivo", () => {
    const erro = (x: object) => { const r = decisaoSchema.safeParse(x); return r.success ? null : r.error.issues[0].message; };
    expect(decisaoSchema.parse({ situacao: "CONTA", motivo: "  Defeito do serviço anterior  " })).toEqual({ situacao: "CONTA", motivo: "Defeito do serviço anterior" });
    expect(decisaoSchema.parse({ situacao: "NAO_CONTA", motivo: "Queda de energia" })).toEqual({ situacao: "NAO_CONTA", motivo: "Queda de energia" });
    for (const situacao of ["CONTA", "NAO_CONTA"]) {
      expect(erro({ situacao }), situacao).toBe(MSG_MOTIVO);
      expect(erro({ situacao, motivo: "    " }), situacao).toBe(MSG_MOTIVO);
      expect(erro({ situacao, motivo: "abcd" }), situacao).toBe(MSG_MOTIVO);
      expect(erro({ situacao, motivo: "abcde" }), situacao).toBeNull();
    }
    expect(decisaoSchema.parse({ situacao: "A_REVISAR", motivo: "qualquer coisa" })).toEqual({ situacao: "A_REVISAR", motivo: null });
    expect(decisaoSchema.parse({ situacao: "A_REVISAR" })).toEqual({ situacao: "A_REVISAR", motivo: null });
    expect(erro({ situacao: "APROVADA", motivo: "abcde" })).not.toBeNull();
    expect(erro({ situacao: "CONTA", motivo: "x".repeat(501) })).toMatch(/no máximo 500/);
  });

  it("reclamação à mão: colaborador, data, descrição (mín. 10) e, se houver, o número da OS", () => {
    const ok = { tecnicoId: "t1", data: "2026-11-10", descricao: "Cliente ligou reclamando do barulho" };
    expect(reclamacaoSchema.parse(ok)).toEqual({ ...ok, osNumero: null });
    expect(reclamacaoSchema.parse({ ...ok, osNumero: "  OS-123 " }).osNumero).toBe("OS-123");
    expect(reclamacaoSchema.parse({ ...ok, osNumero: "   " }).osNumero).toBeNull();
    const erro = (x: object) => { const r = reclamacaoSchema.safeParse({ ...ok, ...x }); return r.success ? null : r.error.issues[0].message; };
    expect(erro({ tecnicoId: "" })).toBe("Escolha o colaborador.");
    expect(erro({ data: "10/11/2026" })).toBe("Informe a data da reclamação.");
    expect(erro({ descricao: "curta" })).toMatch(/mínimo 10/);
    expect(erro({ descricao: "x".repeat(1001) })).toMatch(/no máximo 1000/);
    expect(erro({ situacao: "CONTA" })).not.toBeNull(); // ninguém registra já decidindo
  });

  it("premiação: mês, título e, opcionais, descrição, perfil e imagem (só JPG, PNG ou WebP em data URL)", () => {
    const ok = { competencia: "2026-11", titulo: "Kit de ferramentas" };
    expect(premiacaoSchema.parse(ok)).toEqual({ ...ok, descricao: null, perfilId: null });
    expect(premiacaoSchema.parse({ ...ok, descricao: "  ", perfilId: "" })).toMatchObject({ descricao: null, perfilId: null });
    const img = (tipo: string) => `data:image/${tipo};base64,QUJD`;
    for (const tipo of ["jpeg", "png", "webp"]) expect(premiacaoSchema.safeParse({ ...ok, imagem: img(tipo) }).success, tipo).toBe(true);
    expect(premiacaoSchema.parse({ ...ok, imagem: null }).imagem).toBeNull();           // tirar a imagem
    expect("imagem" in premiacaoSchema.parse(ok)).toBe(false);                             // não mexer na imagem
    const erro = (x: object) => { const r = premiacaoSchema.safeParse({ ...ok, ...x }); return r.success ? null : r.error.issues[0].message; };
    expect(erro({ imagem: img("svg+xml") })).toMatch(/JPG, PNG ou WebP/);
    expect(erro({ imagem: "https://exemplo.com/brinde.png" })).toMatch(/JPG, PNG ou WebP/);
    expect(erro({ imagem: `data:image/png;base64,${"A".repeat(600_001)}` })).toMatch(/grande demais/);
    expect(erro({ competencia: "11/2026" })).toMatch(/mês da premiação/);
    expect(erro({ titulo: "K" })).toMatch(/título/);
    expect(erro({ titulo: "x".repeat(81) })).toMatch(/no máximo 80/);
  });

  it("resumo do item na lista: a descrição ou, sem ela, o nome do tipo", () => {
    expect(resumoDaPenalidade({ tipo: "RETORNO", descricao: " OS-2 aberta 5 dias depois " })).toBe("OS-2 aberta 5 dias depois");
    expect(resumoDaPenalidade({ tipo: "NOTA_BAIXA", descricao: null })).toBe("Nota baixa");
    expect(resumoDaPenalidade({ tipo: "RECLAMACAO", descricao: "  " })).toBe("Reclamação");
    expect(resumoDaPenalidade({ tipo: "OUTRO", descricao: null })).toBe("OUTRO");
  });
});

describe("painel: ranking por perfil, ficha e resumo por equipe", () => {
  const regra = (x: Partial<RegraDoMes> = {}): RegraDoMes => ({ ...REGRA, vigenteDesde: "2026-11", ...x });
  const perfis: PerfilDoMes[] = [
    { id: "pEnc", nome: "Encarregado", tipo: "GESTAO", ordem: 3, regra: regra({ pesoPrazo: 50, pesoRelatorio: 0, pesoAvaliacao: 50, faixas: [{ nome: "Ouro", minimo: 90, valor: 500 }] }) },
    { id: "pPrev", nome: "Preventiva", tipo: "TECNICO", ordem: 0, regra: regra() },
    { id: "pInst", nome: "Instalação", tipo: "TECNICO", ordem: 2, regra: null },
  ];
  const participantes: ParticipanteDoMes[] = [
    { tecnicoId: "bia", nome: "Bia", perfilId: "pPrev" }, { tecnicoId: "ana", nome: "Ana", perfilId: "pPrev" },
    { tecnicoId: "caio", nome: "Caio", perfilId: "pEnc" }, { tecnicoId: "ivo", nome: "Ivo", perfilId: "pInst" }, { tecnicoId: "novo", nome: "Novato", perfilId: "pPrev" },
  ];
  const equipes: EquipeDoMes[] = [
    { id: "alfa", nome: "Alfa", cor: "#111", liderId: "caio", lider: "Caio", membros: ["caio", "bia", "fora"] },
    { id: "vazia", nome: "Vazia", cor: "#222", liderId: null, lider: null, membros: ["fora"] },
  ];
  const ok = [{ completo: true, antesEDepois: true }];
  const medicao: Medicao = {
    atividades: [
      { id: "a1", ordemServicoId: "o1", equipeId: null, executores: ["ana"], noPrazo: true, equipamentos: ok },
      { id: "a2", ordemServicoId: "o2", equipeId: "alfa", executores: ["bia"], noPrazo: true, equipamentos: ok },
      { id: "a3", ordemServicoId: "o3", equipeId: "alfa", executores: ["bia"], noPrazo: false, equipamentos: ok },
    ],
    avaliacoes: new Map([["ana", { media: 5, avaliacoes: 1 }], ["bia", { media: 4, avaliacoes: 1 }]]),
    avaliadas: [{ ordemServicoId: "o2", avaliacao: 4, executores: ["bia"], equipeIds: ["alfa"] }],
    penalidades: new Map([["bia", { retornos: 1, reclamacoes: 0 }]]),
  };
  const montar = (comValores: boolean) => montarPainel({ competencia: "2026-11", perfis, participantes, equipes, medicao }, comValores);

  it("um ranking por perfil, na ordem dos perfis; cada um com a regra do mês e as posições", () => {
    const p = montar(true);
    expect(p.grupos.map((g) => g.perfil.nome)).toEqual(["Preventiva", "Instalação", "Encarregado"]);
    const prev = p.grupos[0].linhas.map((l) => `${l.posicao ?? "-"}:${l.nome}:${l.escore}:${l.faixa}:${l.bonus}`);
    // Ana: 100/100/100 = 100 (Ouro). Bia: prazo 50, relatório 100, nota 4 = 20+30+24 = 74 − 5 (retorno) = 69 → abaixo da meta
    expect(prev).toEqual(["1:Ana:100:Ouro:350", "2:Bia:69:null:0", "-:Novato:null:null:0"]);
    expect(p.grupos[0].linhas[1]).toMatchObject({ base: 74, desconto: 5, atingiuMeta: false });
  });

  it("encarregado é medido pela equipe que lidera: 1 de 2 no prazo (50%) e satisfação 4,0 (80%) = 65", () => {
    const caio = montar(true).grupos[2].linhas[0];
    expect(caio).toMatchObject({ nome: "Caio", escore: 65, posicao: 1, faixa: null, atingiuMeta: false });
    expect(caio.composicao.map((c) => c.detalhe)).toEqual(["1 de 2 atividades", "2 de 2 relatórios", "média 4,0 em 1 avaliação"]);
    expect(lideradasPor("caio", equipes)).toEqual({ equipeIds: ["alfa"], membros: ["caio", "bia", "fora"] });
    expect(lideradasPor("bia", equipes)).toEqual({ equipeIds: [], membros: [] });
  });

  it("perfil SEM regra no mês: os colaboradores aparecem, sem escore e sem posição — ninguém é medido", () => {
    const inst = montar(true).grupos[1];
    expect(inst.regra).toBeNull();
    expect(inst.linhas).toEqual([expect.objectContaining({ nome: "Ivo", escore: null, posicao: null, faixa: null, bonus: null, composicao: [] })]);
  });

  it("VALORES EM REAIS só saem com permissão: sem ela, bônus e valor das faixas vêm vazios (o resto é igual)", () => {
    const com = montar(true), sem = montar(false);
    expect(com.grupos[0].regra?.faixas.map((f) => f.valor)).toEqual([100, 200, 350]);
    expect(sem.grupos[0].regra?.faixas).toEqual([{ nome: "Bronze", minimo: 70, valor: null }, { nome: "Prata", minimo: 80, valor: null }, { nome: "Ouro", minimo: 90, valor: null }]);
    expect(sem.grupos.flatMap((g) => g.linhas.map((l) => l.bonus))).toEqual([null, null, null, null, null]);
    expect(JSON.stringify(sem)).not.toMatch(/"bonus":\s*\d/);
    expect(JSON.stringify(sem.grupos.map((g) => g.regra?.faixas))).not.toMatch(/"valor":\s*\d/);
    const limpar = (p: ReturnType<typeof montar>) => p.grupos.map((g) => g.linhas.map((l) => ({ ...l, bonus: 0 })));
    expect(limpar(sem)).toEqual(limpar(com));
  });

  it("por equipe: a média dos escores dos membros que participam; quem não está no Desempenho não entra na conta", () => {
    const e = montar(true).equipes;
    // Alfa: Caio (65) e Bia (69) → 67; "fora" não participa
    expect(e).toEqual([
      { id: "alfa", nome: "Alfa", cor: "#111", lider: "Caio", escore: 67, participantes: 2, medidos: 2 },
      { id: "vazia", nome: "Vazia", cor: "#222", lider: null, escore: null, participantes: 0, medidos: 0 },
    ]);
  });

  it("a linha de um colaborador: o perfil dele, a regra e quantos disputam; quem não participa não tem linha", () => {
    const p = montar(true);
    expect(linhaDoColaborador(p, "bia")).toMatchObject({ grupo: { perfil: { nome: "Preventiva" } }, linha: { nome: "Bia", posicao: 2 }, participantes: 3 });
    expect(linhaDoColaborador(p, "caio")?.participantes).toBe(1);
    expect(linhaDoColaborador(p, "fora")).toBeNull();
  });

  it("MODO TV: posição, nome, escore e faixa — e NADA de valor em reais, composição, penalidade ou id de colaborador", () => {
    const premiacoes = [{ id: "pr1", titulo: "Kit de ferramentas", descricao: "Para o 1º lugar", perfil: "Preventiva", temImagem: true }];
    const tv = paraTv(montar(true), { empresa: "Clima Total", premiacoes, agora: new Date("2026-11-13T14:00:00Z") });
    expect(tv.empresa).toBe("Clima Total");
    expect(tv.competencia).toBe("2026-11");
    expect(tv.atualizadoEm).toBe("2026-11-13T14:00:00.000Z");
    expect(tv.grupos.map((g) => g.perfil)).toEqual(["Preventiva", "Instalação", "Encarregado"]);
    expect(tv.grupos[0].linhas).toEqual([
      { posicao: 1, nome: "Ana", escore: 100, faixa: "Ouro" }, { posicao: 2, nome: "Bia", escore: 69, faixa: null }, { posicao: null, nome: "Novato", escore: null, faixa: null },
    ]);
    expect(tv.premiacoes).toEqual(premiacoes);
    const texto = JSON.stringify(tv);
    for (const proibido of ["bonus", "valor", "composicao", "penalidades", "desconto", "metaMinima", "tecnicoId", "350", "500"]) expect(texto, proibido).not.toContain(proibido);
  });

  it("modo TV: perfil sem ninguém não ocupa a tela; o que vier a mais na premiação não passa", () => {
    const vazio: PerfilDoMes = { id: "pVazio", nome: "Vazio", tipo: "TECNICO", ordem: 9, regra: regra() };
    const p = montarPainel({ competencia: "2026-11", perfis: [...perfis, vazio], participantes, equipes, medicao }, true);
    const tv = paraTv(p, { empresa: "X", premiacoes: [{ id: "1", titulo: "T", descricao: null, perfil: null, temImagem: false, imagem: "data:segredo", valor: 999 } as never], agora: new Date() });
    expect(tv.grupos.map((g) => g.perfil)).not.toContain("Vazio");
    expect(tv.premiacoes).toEqual([{ id: "1", titulo: "T", descricao: null, perfil: null, temImagem: false }]);
  });
});

describe("a data de conclusão da atividade", () => {
  const agora = new Date("2026-11-13T15:00:00Z");

  it("concluir grava o momento; reabrir limpa; o resto não mexe na data", () => {
    expect(marcaDeConclusao("EM_ANDAMENTO", "CONCLUIDA", agora)).toEqual({ concluidaEm: agora });
    expect(marcaDeConclusao("AGENDADA", "CONCLUIDA", agora)).toEqual({ concluidaEm: agora });
    expect(marcaDeConclusao("CONCLUIDA", "EM_ANDAMENTO", agora)).toEqual({ concluidaEm: null });
    expect(marcaDeConclusao("CONCLUIDA", "CANCELADA", agora)).toEqual({ concluidaEm: null });
    expect(marcaDeConclusao("CONCLUIDA", "CONCLUIDA", agora)).toEqual({}); // repetir a conclusão não troca a data
    expect(marcaDeConclusao("AGENDADA", "EM_ANDAMENTO", agora)).toEqual({});
    expect(marcaDeConclusao("AGENDADA", "CANCELADA", agora)).toEqual({});
  });

  it("no app, vale a hora do TOQUE no aparelho — mesmo que a fila só chegue horas depois", () => {
    // Tocou às 17:30 (aparelho), a fila subiu às 21:00 (aparelho): 3h30 de atraso em relação ao servidor
    const quando = momentoDaConclusao({ em: "2026-11-12T17:30:00-03:00", agoraAparelho: "2026-11-12T21:00:00-03:00" }, agora);
    expect(quando).toEqual(new Date("2026-11-13T11:30:00Z"));
    // Relógio do aparelho errado em 1 dia: o que vale é a DIFERENÇA entre o toque e o envio
    expect(momentoDaConclusao({ em: "2026-11-14T10:00:00Z", agoraAparelho: "2026-11-14T10:20:00Z" }, agora)).toEqual(new Date("2026-11-13T14:40:00Z"));
  });

  it("sem hora do toque (tela do escritório), com hora inválida ou 'no futuro': vale agora", () => {
    expect(momentoDaConclusao(undefined, agora)).toBe(agora);
    expect(momentoDaConclusao(null, agora)).toBe(agora);
    expect(momentoDaConclusao({}, agora)).toBe(agora);
    expect(momentoDaConclusao({ em: "ontem" }, agora)).toEqual(agora);
    expect(momentoDaConclusao({ em: "2026-11-13T16:00:00Z" }, agora)).toEqual(agora); // toque depois do envio
  });

  it("toque guardado há mais de 7 dias não é levado em conta (vale a chegada); até 7 dias, vale o toque", () => {
    const seteDias = new Date(agora.getTime() - MAX_ATRASO_CONCLUSAO_MS);
    expect(momentoDaConclusao({ em: seteDias.toISOString() }, agora)).toEqual(seteDias);
    expect(momentoDaConclusao({ em: new Date(seteDias.getTime() - 1000).toISOString() }, agora)).toEqual(agora);
    expect(MAX_ATRASO_CONCLUSAO_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe("permissão nova: Desempenho", () => {
  it("módulo 'desempenho' com Visualizar, Revisar penalidades e Gerenciar — na seção Equipe", () => {
    const m = MODULOS.find((x) => x.id === "desempenho");
    expect(m).toEqual({ id: "desempenho", label: "Desempenho", icone: "Trophy", acoes: ["visualizar", "revisar", "gerenciar"] });
    expect(rotuloPermissao(["desempenho", "revisar"])).toBe("Desempenho › Revisar penalidades");
    expect(moduloDaRota("/desempenho")).toBe("desempenho");
    expect(moduloDaRota("/desempenho/configuracao")).toBe("desempenho");
    expect(moduloDaRota("/relatorio/desempenho/abc")).toBeNull(); // a TV é rota pública (o token é a chave)
  });

  it("quem ganha por padrão: administrador tudo; supervisor vê e revisa (não configura); técnico, auxiliar e financeiro nada", () => {
    expect(permissoesTotais().desempenho).toEqual({ visualizar: true, revisar: true, gerenciar: true });
    expect(PRESETS.ADMINISTRADOR.desempenho).toEqual({ visualizar: true, revisar: true, gerenciar: true });
    expect(PRESETS.SUPERVISOR.desempenho).toEqual({ visualizar: true, revisar: true, gerenciar: false });
    for (const tipo of ["TECNICO", "AUXILIAR", "FINANCEIRO", "PERSONALIZADO"]) expect(PRESETS[tipo].desempenho, tipo).toEqual({ visualizar: false, revisar: false, gerenciar: false });
  });

  it("perfil de acesso antigo (gravado antes de o módulo existir) não ganha nada sozinho; o papel ADMIN tem tudo", () => {
    const antigo = { ordens: { visualizar: true }, equipes: { visualizar: true, gerenciar: true } };
    for (const acao of ["visualizar", "revisar", "gerenciar"] as const) {
      expect(pode(antigo, "desempenho", acao, "OPERADOR"), acao).toBe(false);
      expect(pode(antigo, "desempenho", acao, "ADMIN"), acao).toBe(true);
    }
    expect(pode({ desempenho: { visualizar: true } }, "desempenho", "visualizar", "OPERADOR")).toBe(true);
    expect(pode({ desempenho: { visualizar: true } }, "desempenho", "gerenciar", "OPERADOR")).toBe(false);
  });
});
