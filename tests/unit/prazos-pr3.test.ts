/**
 * Prazos da OS — PR 3: o atraso justificado e o desempenho, as REGRAS (sem banco e sem tela).
 *  - o atraso de uma atividade: de quando era, quando saiu, quantos dias — no dia de Brasília;
 *  - atividade atrasada de OS justificada sai da métrica "no prazo" (nem acerto nem erro); só o
 *    atraso sai; o relatório e as outras métricas não mudam;
 *  - o texto da composição diz quantos atrasos ficaram fora da conta;
 *  - a linha do painel leva os atrasos (os que contam e os justificados); a TV não;
 *  - em que meses do desempenho a justificativa de uma OS pesa, e o aviso de mês fechado.
 */
import { describe, expect, it } from "vitest";
import {
  atrasoDaAtividade, calcularEscore, entradaDaGestao, entradaDoColaborador, textoAtrasosJustificados,
  type AtividadeMedida, type AtrasoDaAtividade, type EntradaEscore, type Regra,
} from "@/lib/desempenho/regras";
import { montarPainel, paraTv } from "@/lib/desempenho/painel";
import { avisoMesFechado, competenciasDosAtrasos } from "@/lib/os/prazo-execucao";

const br = (dia: string, hora = "10:00") => new Date(`${dia}T${hora}:00-03:00`);
const REGRA: Regra = {
  pesoPrazo: 50, pesoRelatorio: 0, pesoAvaliacao: 50, exigirFotoAntesDepois: false, penalidadeRetorno: 5, penalidadeReclamacao: 5, metaMinima: 70,
  faixas: [{ nome: "Bronze", minimo: 70, valor: 100 }, { nome: "Ouro", minimo: 90, valor: 350 }],
};
const OS = (motivo: string | null = null, numero = "OS-1") => ({ numero, atrasoJustificadoMotivo: motivo });

describe("o atraso de uma atividade", () => {
  it("concluída depois do dia de referência: prazo, dia da conclusão (Brasília) e quantos dias — com o motivo, se a OS foi justificada", () => {
    const a = { dataAgendada: br("2026-11-06", "09:00"), prazo: null, concluidaEm: br("2026-11-09", "16:00") };
    expect(atrasoDaAtividade(a, OS())).toEqual({ numeroOs: "OS-1", prazo: "2026-11-06", concluidaEm: "2026-11-09", dias: 3, justificado: null });
    expect(atrasoDaAtividade(a, OS("CLIENTE_AUSENTE", "CH-9"))).toEqual({ numeroOs: "CH-9", prazo: "2026-11-06", concluidaEm: "2026-11-09", dias: 3, justificado: "CLIENTE_AUSENTE" });
    // Motivo vazio não é justificativa
    expect(atrasoDaAtividade(a, OS(""))!.justificado).toBeNull();
  });

  it("o prazo próprio da atividade vence o dia agendado; o dia é o de Brasília (23h50 ainda é o mesmo dia; 0h10 já é o seguinte)", () => {
    const comPrazo = { dataAgendada: br("2026-11-01"), prazo: new Date("2026-11-10T00:00:00Z"), concluidaEm: br("2026-11-11", "08:00") };
    expect(atrasoDaAtividade(comPrazo, OS())).toMatchObject({ prazo: "2026-11-10", concluidaEm: "2026-11-11", dias: 1 });
    expect(atrasoDaAtividade({ dataAgendada: br("2026-11-10"), prazo: null, concluidaEm: br("2026-11-10", "23:50") }, OS())).toBeNull();
    expect(atrasoDaAtividade({ dataAgendada: br("2026-11-10"), prazo: null, concluidaEm: br("2026-11-11", "00:10") }, OS())).toMatchObject({ dias: 1, concluidaEm: "2026-11-11" });
    // 22h30 de Brasília já é o dia seguinte em UTC: vale o dia de Brasília (1 dia de atraso, não 2)
    expect(atrasoDaAtividade({ dataAgendada: br("2026-11-10"), prazo: null, concluidaEm: br("2026-11-11", "22:30") }, OS())).toMatchObject({ dias: 1, concluidaEm: "2026-11-11" });
    // Vira o mês e o ano
    expect(atrasoDaAtividade({ dataAgendada: br("2026-12-30"), prazo: null, concluidaEm: br("2027-01-02") }, OS())).toMatchObject({ prazo: "2026-12-30", concluidaEm: "2027-01-02", dias: 3 });
  });

  it("no prazo, antes do prazo ou sem como medir: não há atraso (mesmo com a OS justificada)", () => {
    const os = OS("CLIMA");
    expect(atrasoDaAtividade({ dataAgendada: br("2026-11-10"), prazo: null, concluidaEm: br("2026-11-10", "18:00") }, os)).toBeNull();
    expect(atrasoDaAtividade({ dataAgendada: br("2026-11-10"), prazo: null, concluidaEm: br("2026-11-08") }, os)).toBeNull();
    expect(atrasoDaAtividade({ dataAgendada: br("2026-11-10"), prazo: null, concluidaEm: null }, os)).toBeNull();
    expect(atrasoDaAtividade({ dataAgendada: null, prazo: null, concluidaEm: br("2026-11-10") }, os)).toBeNull();
  });
});

describe("a métrica 'no prazo' com atraso justificado", () => {
  const ok = [{ completo: true, antesEDepois: true }];
  const atraso = (numeroOs: string, justificado: string | null, concluidaEm = "2026-11-09"): AtrasoDaAtividade => ({ numeroOs, prazo: "2026-11-06", concluidaEm, dias: 3, justificado });
  const A: AtividadeMedida[] = [
    { id: "a1", ordemServicoId: "o1", equipeId: null, executores: ["ana"], noPrazo: true, atraso: null, equipamentos: ok },
    { id: "a2", ordemServicoId: "o2", equipeId: null, executores: ["ana"], noPrazo: false, atraso: atraso("OS-2", null), equipamentos: ok },
    { id: "a3", ordemServicoId: "o3", equipeId: null, executores: ["ana"], noPrazo: false, atraso: atraso("OS-3", "PECA_FALTANDO", "2026-11-08"), equipamentos: [{ completo: false, antesEDepois: true }] },
    { id: "a4", ordemServicoId: "o4", equipeId: null, executores: ["ana"], noPrazo: null, atraso: null, equipamentos: [] },
    { id: "b1", ordemServicoId: "o5", equipeId: "alfa", executores: ["bia", "caio"], noPrazo: false, atraso: atraso("OS-5", "CLIENTE_AUSENTE"), equipamentos: ok },
    { id: "b2", ordemServicoId: "o6", equipeId: "alfa", executores: ["bia"], noPrazo: true, atraso: null, equipamentos: ok },
  ];

  it("o atraso justificado SAI da conta — nem acerto nem erro; o que conta continua contando; o relatório é medido igual", () => {
    const ana = entradaDoColaborador("ana", A, undefined, undefined, true);
    // a1 certo, a2 errado; a3 (justificado) fora; a4 sem medição
    expect(ana.prazo).toEqual({ certos: 1, total: 2 });
    expect(ana.atrasosJustificados).toBe(1);
    // O relatório de a3 (incompleto) continua contando: a justificativa é do atraso, não do relatório
    expect(ana.relatorio).toEqual({ certos: 2, total: 3 });
    // Sem a justificativa seria 1 de 3
    const sem = A.map((a) => (a.atraso ? { ...a, atraso: { ...a.atraso, justificado: null } } : a));
    expect(entradaDoColaborador("ana", sem, undefined, undefined, true)).toMatchObject({ prazo: { certos: 1, total: 3 }, atrasosJustificados: 0 });
  });

  it("a entrada leva os atrasos por trás da conta — os que contam e os justificados — por dia da conclusão", () => {
    const ana = entradaDoColaborador("ana", A, undefined, undefined, true);
    expect(ana.atrasos.map((x) => `${x.atividadeId}|${x.ordemServicoId}|${x.numeroOs}|${x.concluidaEm}|${x.justificado ?? "conta"}`)).toEqual([
      "a3|o3|OS-3|2026-11-08|PECA_FALTANDO", "a2|o2|OS-2|2026-11-09|conta",
    ]);
    expect(entradaDoColaborador("ninguem", A, undefined, undefined, true)).toMatchObject({ atrasos: [], atrasosJustificados: 0 });
  });

  it("no mesmo dia, a ordem é a do número da OS (OS-9 antes de OS-10)", () => {
    const mesmoDia: AtividadeMedida[] = ["OS-10", "OS-9", "OS-2"].map((numero, i) => ({
      id: `x${i}`, ordemServicoId: `o${i}`, equipeId: null, executores: ["ana"], noPrazo: false, atraso: atraso(numero, null), equipamentos: [],
    }));
    expect(entradaDoColaborador("ana", mesmoDia, undefined, undefined, true).atrasos.map((x) => x.numeroOs)).toEqual(["OS-2", "OS-9", "OS-10"]);
  });

  it("atividade de equipe: sai da conta de cada executor e do encarregado — uma vez cada", () => {
    for (const quem of ["bia", "caio"]) expect(entradaDoColaborador(quem, A, undefined, undefined, true).atrasosJustificados, quem).toBe(1);
    expect(entradaDoColaborador("bia", A, undefined, undefined, true).prazo).toEqual({ certos: 1, total: 1 });
    expect(entradaDoColaborador("caio", A, undefined, undefined, true).prazo).toEqual({ certos: 0, total: 0 });
    const lider = entradaDaGestao({ equipeIds: ["alfa"], membros: ["bia", "caio"] }, A, [], undefined, true);
    expect(lider).toMatchObject({ prazo: { certos: 1, total: 1 }, atrasosJustificados: 1 });
    expect(lider.atrasos.map((x) => x.numeroOs)).toEqual(["OS-5"]);
  });

  it("dado inconsistente não tira nada da conta: 'justificado' só vale em atividade ATRASADA", () => {
    const estranha: AtividadeMedida[] = [
      { id: "z1", ordemServicoId: "o1", equipeId: null, executores: ["ana"], noPrazo: true, atraso: atraso("OS-1", "CLIMA"), equipamentos: [] },
      { id: "z2", ordemServicoId: "o2", equipeId: null, executores: ["ana"], noPrazo: null, atraso: atraso("OS-2", "CLIMA"), equipamentos: [] },
      { id: "z3", ordemServicoId: "o3", equipeId: null, executores: ["ana"], noPrazo: false, equipamentos: [] }, // atrasada sem os números (medição antiga)
    ];
    const e = entradaDoColaborador("ana", estranha, undefined, undefined, true);
    expect(e).toMatchObject({ prazo: { certos: 1, total: 2 }, atrasosJustificados: 0, atrasos: [] });
  });
});

describe("o texto da composição", () => {
  const entrada = (x: Partial<EntradaEscore> = {}): EntradaEscore => ({ prazo: { certos: 1, total: 2 }, relatorio: { certos: 0, total: 0 }, avaliacao: { media: null, avaliacoes: 0 }, retornos: 0, reclamacoes: 0, ...x });
  const detalhe = (x: Partial<EntradaEscore> = {}) => calcularEscore(REGRA, entrada(x)).composicao[0].detalhe;

  it("diz quantos atrasos ficaram fora da conta (singular e plural); sem nenhum, o texto é o de sempre", () => {
    expect(detalhe()).toBe("1 de 2 atividades");
    expect(detalhe({ atrasosJustificados: 0 })).toBe("1 de 2 atividades");
    expect(detalhe({ atrasosJustificados: 1 })).toBe("1 de 2 atividades · 1 atraso justificado fora da conta");
    expect(detalhe({ atrasosJustificados: 3 })).toBe("1 de 2 atividades · 3 atrasos justificados fora da conta");
    expect(textoAtrasosJustificados(0)).toBe("");
    expect(textoAtrasosJustificados(-1)).toBe("");
  });

  it("só atraso justificado: 'sem medição' (o peso vai para as outras métricas) — o número de justificados não entra em conta nenhuma", () => {
    const so = { prazo: { certos: 0, total: 0 }, atrasosJustificados: 2 };
    expect(detalhe(so)).toBe("sem medição no mês · 2 atrasos justificados fora da conta");
    expect(calcularEscore(REGRA, entrada(so))).toMatchObject({ escore: null, base: null });
    const comNota = calcularEscore(REGRA, entrada({ ...so, avaliacao: { media: 4, avaliacoes: 1 } }));
    expect(comNota).toMatchObject({ escore: 80, base: 80 });
    expect(comNota.composicao.map((c) => `${c.metrica}:${c.valor}:${c.pontos}`)).toEqual(["prazo:null:null", "relatorio:null:null", "avaliacao:80:80"]);
    // O mesmo escore com 0, 1 ou 50 justificados: é só texto
    const base = calcularEscore(REGRA, entrada({ avaliacao: { media: 4, avaliacoes: 1 } })).escore;
    for (const n of [1, 50]) expect(calcularEscore(REGRA, entrada({ avaliacao: { media: 4, avaliacoes: 1 }, atrasosJustificados: n })).escore).toBe(base);
  });
});

describe("o painel", () => {
  const ok = [{ completo: true, antesEDepois: true }];
  const atividades: AtividadeMedida[] = [
    { id: "a1", ordemServicoId: "o1", equipeId: null, executores: ["t1"], noPrazo: true, atraso: null, equipamentos: ok },
    { id: "a2", ordemServicoId: "o2", equipeId: null, executores: ["t1"], noPrazo: false, atraso: { numeroOs: "OS-2", prazo: "2026-11-06", concluidaEm: "2026-11-09", dias: 3, justificado: "ACESSO_NEGADO" }, equipamentos: ok },
    { id: "a3", ordemServicoId: "o3", equipeId: null, executores: ["t2"], noPrazo: false, atraso: { numeroOs: "OS-3", prazo: "2026-11-06", concluidaEm: "2026-11-07", dias: 1, justificado: null }, equipamentos: ok },
  ];
  const painel = montarPainel({
    competencia: "2026-11",
    perfis: [{ id: "p1", nome: "Preventiva", tipo: "TECNICO", ordem: 0, regra: { ...REGRA, vigenteDesde: "2026-11" } }, { id: "p2", nome: "Sem regra", tipo: "TECNICO", ordem: 1, regra: null }],
    participantes: [{ tecnicoId: "t1", nome: "Ana", perfilId: "p1" }, { tecnicoId: "t2", nome: "Bia", perfilId: "p1" }, { tecnicoId: "t3", nome: "Caio", perfilId: "p2" }],
    equipes: [], medicao: { atividades, avaliacoes: new Map(), avaliadas: [], penalidades: new Map() },
  }, true);
  const linha = (nome: string) => painel.grupos.flatMap((g) => g.linhas).find((l) => l.nome === nome)!;

  it("a linha leva os atrasos de cada um; o justificado tira o atraso da conta e o escore reflete", () => {
    expect(linha("Ana")).toMatchObject({ escore: 100, posicao: 1 });
    expect(linha("Ana").composicao[0].detalhe).toBe("1 de 1 atividade · 1 atraso justificado fora da conta");
    expect(linha("Ana").atrasos).toEqual([{ atividadeId: "a2", ordemServicoId: "o2", numeroOs: "OS-2", prazo: "2026-11-06", concluidaEm: "2026-11-09", dias: 3, justificado: "ACESSO_NEGADO" }]);
    expect(linha("Bia")).toMatchObject({ escore: 0, posicao: 2 });
    expect(linha("Bia").atrasos!.map((a) => a.justificado)).toEqual([null]);
    // Atraso justificado não é acerto: não ajuda no desempate da premiação
    expect(linha("Ana").desempate.noPrazo).toBe(1);
    // Perfil sem regra no mês: não há medição nem lista
    expect(linha("Caio").atrasos).toBeUndefined();
  });

  it("a TV não recebe atrasos (a resposta é montada campo a campo)", () => {
    const tv = paraTv(painel, { empresa: "Clima Total", premiacoes: [], agora: new Date("2026-11-20T15:00:00Z") });
    expect(JSON.stringify(tv)).not.toMatch(/atrasos|OS-2|ACESSO_NEGADO|justificad/);
    expect(tv.grupos[0].linhas.map((l) => Object.keys(l).sort().join(","))).toEqual(["escore,faixa,nome,posicao", "escore,faixa,nome,posicao"]);
  });
});

describe("a justificativa da OS e o mês do desempenho", () => {
  const concluida = (agendada: string, feita: string, hora = "16:00") => ({ status: "CONCLUIDA", dataAgendada: br(agendada, "09:00"), prazo: null, concluidaEm: br(feita, hora) });

  it("pesa nos meses das atividades CONCLUÍDAS com atraso (o mês da conclusão, em Brasília) — sem repetir, em ordem", () => {
    const os = { status: "CONCLUIDA", atividades: [
      concluida("2026-11-28", "2026-12-02"),            // atrasou: conta em dezembro (o mês da conclusão)
      concluida("2026-10-10", "2026-10-12"),            // outubro
      concluida("2026-10-20", "2026-10-25"),            // outubro de novo
      concluida("2026-11-05", "2026-11-05"),            // no prazo: não entra
      { status: "EM_ANDAMENTO", dataAgendada: br("2026-09-01"), prazo: null, concluidaEm: null },   // aberta e atrasada: ainda não tem mês
      { status: "CANCELADA", dataAgendada: br("2026-08-01"), prazo: null, concluidaEm: br("2026-08-20") },
    ] };
    expect(competenciasDosAtrasos(os)).toEqual(["2026-10", "2026-12"]);
    // 30/11 às 23h de Brasília ainda é novembro (em UTC já é dezembro)
    expect(competenciasDosAtrasos({ status: "CONCLUIDA", atividades: [concluida("2026-11-20", "2026-11-30", "23:00")] })).toEqual(["2026-11"]);
    expect(competenciasDosAtrasos({ status: "CONCLUIDA", atividades: [concluida("2026-11-20", "2026-12-01", "00:30")] })).toEqual(["2026-12"]);
  });

  it("OS cancelada, sem atividade ou sem atraso: nenhum mês", () => {
    expect(competenciasDosAtrasos({ status: "CANCELADA", atividades: [concluida("2026-11-01", "2026-11-09")] })).toEqual([]);
    expect(competenciasDosAtrasos({ status: "ABERTA" })).toEqual([]);
    expect(competenciasDosAtrasos({ status: "CONCLUIDA", atividades: [concluida("2026-11-05", "2026-11-05")] })).toEqual([]);
  });

  it("o aviso de mês fechado: um mês, vários meses — e nada quando não há mês fechado", () => {
    expect(avisoMesFechado([])).toBe("");
    expect(avisoMesFechado(null)).toBe("");
    expect(avisoMesFechado(undefined)).toBe("");
    expect(avisoMesFechado(["2026-10"])).toBe("O desempenho de 10/2026 já está fechado: a justificativa não muda o escore desse mês. Para ela valer, reabra o mês em Desempenho › Fechamento.");
    expect(avisoMesFechado(["2026-10", "2026-11"])).toBe("O desempenho de 10/2026 e 11/2026 já está fechado: a justificativa não muda o escore desses meses. Para ela valer, reabra cada mês em Desempenho › Fechamento.");
    expect(avisoMesFechado(["2026-09", "2026-10", "2026-11"])).toContain("O desempenho de 09/2026, 10/2026 e 11/2026 já está fechado");
  });
});
