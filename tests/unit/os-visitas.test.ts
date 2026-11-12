/**
 * OS EM CAMPANHA / MÚLTIPLAS VISITAS — as regras puras (lib/os/visitas):
 *  - os dias de trabalho (pular sábado e domingo, a mesma regra de dia útil dos contratos e do PMOC);
 *  - a divisão dos equipamentos em lotes por quantidade/dia, um por dia;
 *  - replanejar: só mexe na visita PENDENTE; é idempotente; nenhum equipamento em duas visitas;
 *  - incluir dia, tirar dia, mover visita, mover equipamento;
 *  - o progresso somado e a numeração "Visita N de M".
 */
import { describe, expect, it } from "vitest";
import {
  MSG_NAO_PENDENTE, POR_DIA_MAX, VISITAS_MAX, diaDaSemana, diaUtil, diaValido, filaDePendentes, fimDeSemana, incluirDia, moverEquipamentos, moverVisita, numerarVisitas,
  ordemDoEquipamento, pedidoVisitasSchema, planejarVisitas, progressoDasVisitas, resumoDoPlano, sequenciaDeDias, sobras, somarDias, tamanhosEquilibrados, tamanhosPorDia,
  tirarDia, visitaPendente,
  type PlanoDeVisitas, type Resultado, type VisitaAtual,
} from "@/lib/os/visitas";

/** Quinta-feira, 12/11/2026 (13 = sexta, 14 = sábado, 15 = domingo, 16 = segunda) */
const HOJE = "2026-11-12";
const eq = (n: number, feito = false) => ({ id: `q${String(n).padStart(3, "0")}`, feito, ordem: `Bloco A\u0001Sala ${String(n).padStart(3, "0")}` });
const faixa = (de: number, ate: number, feito = false) => Array.from({ length: ate - de + 1 }, (_, i) => eq(de + i, feito));
const visita = (id: string, dia: string | null, equipamentos: ReturnType<typeof eq>[], extra: Partial<VisitaAtual> = {}): VisitaAtual => ({ id, status: "AGENDADA", dia, executada: false, equipamentos, ...extra });
/** A atividade única com os 60 equipamentos (como a OS que o cronograma do PMOC gera) */
const origem = () => [visita("a1", "2026-11-12", faixa(1, 60))];
const plano = (r: Resultado): PlanoDeVisitas => { if (r.erro !== undefined) throw new Error(r.erro); return r.plano; };
const erro = (r: Resultado) => r.erro ?? null;
const forma = (p: PlanoDeVisitas) => p.visitas.map((v) => [v.id, v.dia, v.equipamentoIds.length]);
const ids = (de: number, ate: number) => faixa(de, ate).map((e) => e.id);
/** Aplica o resultado como o servidor faz: as pendentes viram o que o plano diz; o resto fica */
function aplicar(visitas: VisitaAtual[], p: PlanoDeVisitas): VisitaAtual[] {
  const porId = new Map(visitas.map((v) => [v.id, v]));
  const todos = new Map(visitas.flatMap((v) => v.equipamentos).map((e) => [e.id, e]));
  const mexidas = new Set([...p.remover, ...p.visitas.map((v) => v.id).filter(Boolean)]);
  let n = 0;
  return [
    ...visitas.filter((v) => !mexidas.has(v.id)),
    ...p.visitas.map((v) => visita(v.id ?? `nova${++n}-${v.dia}`, v.dia, v.equipamentoIds.map((id) => ({ ...todos.get(id)!, feito: false })), { status: porId.get(v.id ?? "")?.status ?? "AGENDADA" })),
  ];
}
/** Nenhum equipamento em duas visitas pendentes, e nenhum sumiu */
function semDuplicarNemPerder(antes: VisitaAtual[], depois: VisitaAtual[]) {
  const pend = (vs: VisitaAtual[]) => vs.filter(visitaPendente).flatMap((v) => v.equipamentos.map((e) => e.id));
  const d = pend(depois);
  expect(new Set(d).size).toBe(d.length);
  expect([...d].sort()).toEqual([...new Set(pend(antes))].sort());
}
const P25 = { inicio: HOJE, porDia: 25, pularFimSemana: true };

describe("visitas da OS: os dias de trabalho", () => {
  it("dia válido, soma de dias e dia da semana", () => {
    expect([diaValido("2026-11-12"), diaValido("2026-02-31"), diaValido("12/11/2026"), diaValido("")]).toEqual([true, false, false, false]);
    expect([somarDias("2026-11-30", 1), somarDias("2026-12-31", 1), somarDias("2026-11-12", -12)]).toEqual(["2026-12-01", "2027-01-01", "2026-10-31"]);
    expect([diaDaSemana("2026-11-12"), diaDaSemana("2026-11-14"), diaDaSemana("2026-11-15")]).toEqual([4, 6, 0]);
    expect([fimDeSemana("2026-11-13"), fimDeSemana("2026-11-14"), fimDeSemana("2026-11-15"), fimDeSemana("2026-11-16")]).toEqual([false, true, true, false]);
  });

  it("dia útil: sábado e domingo viram a segunda seguinte — só quando é para pular o fim de semana", () => {
    expect([diaUtil("2026-11-13", true), diaUtil("2026-11-14", true), diaUtil("2026-11-15", true), diaUtil("2026-11-16", true)]).toEqual(["2026-11-13", "2026-11-16", "2026-11-16", "2026-11-16"]);
    expect([diaUtil("2026-11-14", false), diaUtil("2026-11-15", false)]).toEqual(["2026-11-14", "2026-11-15"]);
  });

  it("sequência de dias: pula sábado e domingo; sem pular, vai direto; começando no sábado, começa na segunda", () => {
    expect(sequenciaDeDias("2026-11-12", 5, true)).toEqual(["2026-11-12", "2026-11-13", "2026-11-16", "2026-11-17", "2026-11-18"]);
    expect(sequenciaDeDias("2026-11-12", 5, false)).toEqual(["2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16"]);
    expect(sequenciaDeDias("2026-11-14", 2, true)).toEqual(["2026-11-16", "2026-11-17"]);
    // vira o mês e o ano sem cair em fim de semana
    expect(sequenciaDeDias("2026-12-30", 4, true)).toEqual(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-04"]);
    expect(sequenciaDeDias("2026-11-12", 0, true)).toEqual([]);
  });
});

describe("visitas da OS: dividir pela quantidade por dia", () => {
  it("tamanhos: lotes cheios e o resto no último; ou repartido por igual", () => {
    expect(tamanhosPorDia(60, 25)).toEqual([25, 25, 10]);
    expect(tamanhosPorDia(50, 25)).toEqual([25, 25]);
    expect(tamanhosPorDia(300, 25)).toHaveLength(12);
    expect(tamanhosPorDia(7, 25)).toEqual([7]);
    expect(tamanhosEquilibrados(60, 4)).toEqual([15, 15, 15, 15]);
    expect(tamanhosEquilibrados(62, 4)).toEqual([16, 16, 15, 15]);
  });

  it("PRIMEIRO planejamento: 60 equipamentos, 25 por dia → 3 visitas (25, 25, 10), cada uma num dia de trabalho", () => {
    const p = plano(planejarVisitas(origem(), P25, HOJE));
    // a atividade que já existia vira a 1ª visita; as outras são novas
    expect(forma(p)).toEqual([["a1", "2026-11-12", 25], [null, "2026-11-13", 25], [null, "2026-11-16", 10]]);
    expect(p.remover).toEqual([]);
    expect(p.visitas.map((v) => [v.equipamentoIds[0], v.equipamentoIds.at(-1)])).toEqual([["q001", "q025"], ["q026", "q050"], ["q051", "q060"]]);
    expect(resumoDoPlano(p)).toEqual({ visitas: 3, equipamentos: 60, de: "2026-11-12", ate: "2026-11-16", maiorLote: 25, menorLote: 10 });
    semDuplicarNemPerder(origem(), aplicar(origem(), p));
  });

  it("300 equipamentos, 25 por dia: 12 visitas, da primeira quinta à sexta de duas semanas depois, sem sábado nem domingo", () => {
    const tudo = [visita("a1", HOJE, faixa(1, 300))];
    const p = plano(planejarVisitas(tudo, P25, HOJE));
    expect(p.visitas).toHaveLength(12);
    expect(p.visitas.every((v) => v.equipamentoIds.length === 25 && !fimDeSemana(v.dia))).toBe(true);
    expect([p.visitas[0].dia, p.visitas.at(-1)!.dia]).toEqual(["2026-11-12", "2026-11-27"]);
    semDuplicarNemPerder(tudo, aplicar(tudo, p));
  });

  it("sem pular o fim de semana, o sábado e o domingo entram na sequência", () => {
    expect(forma(plano(planejarVisitas(origem(), { ...P25, pularFimSemana: false }, HOJE))).map((v) => v[1])).toEqual(["2026-11-12", "2026-11-13", "2026-11-14"]);
    // começando num sábado e pulando: a primeira visita é na segunda
    expect(forma(plano(planejarVisitas(origem(), { ...P25, inicio: "2026-11-14" }, HOJE))).map((v) => v[1])).toEqual(["2026-11-16", "2026-11-17", "2026-11-18"]);
  });

  it("os equipamentos vizinhos (setor, ambiente, TAG) caem no mesmo dia; TAG com número é ordenada como número", () => {
    const e = (id: string, setor: string, local: string, tag: string) => ({ id, feito: false, ordem: ordemDoEquipamento({ setor, localizacao: local, patrimonio: tag }) });
    const baguncado = [visita("a1", HOJE, [e("d", "Torre B", "Sala 1", "AC-10"), e("a", "Torre A", "Sala 2", "AC-3"), e("c", "Torre B", "Sala 1", "AC-2"), e("b", "Torre A", "Sala 10", "AC-1")])];
    const p = plano(planejarVisitas(baguncado, { ...P25, porDia: 2 }, HOJE));
    expect(p.visitas.map((v) => v.equipamentoIds)).toEqual([["a", "b"], ["c", "d"]]);
    // sem setor e sem local vai para o fim
    expect(ordemDoEquipamento({ nome: "Split" }) > ordemDoEquipamento({ setor: "Z", nome: "Split" })).toBe(true);
  });

  it("pedido inválido: data que não existe ou já passou, quantidade fora da faixa, visitas demais, nada a planejar", () => {
    expect(erro(planejarVisitas(origem(), { ...P25, inicio: "2026-02-31" }, HOJE))).toBe("Informe a data de início.");
    expect(erro(planejarVisitas(origem(), { ...P25, inicio: "2026-11-11" }, HOJE))).toBe("A data de início já passou.");
    expect(erro(planejarVisitas(origem(), P25, HOJE))).toBeNull(); // hoje ainda vale
    for (const porDia of [0, -3, 2.5, Number.NaN]) expect(erro(planejarVisitas(origem(), { ...P25, porDia }, HOJE))).toBe("Informe quantos equipamentos por dia.");
    expect(erro(planejarVisitas(origem(), { ...P25, porDia: POR_DIA_MAX + 1 }, HOJE))).toBe("São no máximo 500 equipamentos por dia.");
    expect(erro(planejarVisitas([visita("a1", HOJE, faixa(1, VISITAS_MAX + 1))], { ...P25, porDia: 1 }, HOJE))).toBe("Seriam 401 visitas. Aumente a quantidade por dia.");
    expect(erro(planejarVisitas([visita("a1", HOJE, faixa(1, 10, true), { status: "CONCLUIDA" })], P25, HOJE))).toBe("Não há equipamento a planejar: as visitas já começaram ou foram concluídas.");
  });
});

describe("visitas da OS: replanejar", () => {
  const planejado = () => aplicar(origem(), plano(planejarVisitas(origem(), P25, HOJE)));

  it("IDEMPOTENTE: replanejar com os mesmos parâmetros devolve as mesmas visitas, nos mesmos dias, com os mesmos lotes", () => {
    const antes = planejado();
    const p = plano(planejarVisitas(antes, P25, HOJE));
    expect(p.remover).toEqual([]);
    expect(p.visitas.every((v) => v.id !== null)).toBe(true);
    const depois = aplicar(antes, p);
    const retrato = (vs: VisitaAtual[]) => [...vs].sort((a, b) => a.id.localeCompare(b.id)).map((v) => [v.id, v.dia, v.equipamentos.map((e) => e.id)]);
    expect(retrato(depois)).toEqual(retrato(antes));
    // três vezes seguidas continua igual
    expect(retrato(aplicar(depois, plano(planejarVisitas(depois, P25, HOJE))))).toEqual(retrato(antes));
  });

  it("mudar a quantidade por dia: as visitas pendentes são reaproveitadas na ordem; as que sobram deixam de existir", () => {
    const antes = planejado();
    const idsAntes = [...antes].sort((a, b) => a.dia!.localeCompare(b.dia!)).map((v) => v.id);
    // de 25 para 40 por dia: 3 visitas viram 2
    const menos = plano(planejarVisitas(antes, { ...P25, porDia: 40 }, HOJE));
    expect(forma(menos)).toEqual([[idsAntes[0], "2026-11-12", 40], [idsAntes[1], "2026-11-13", 20]]);
    expect(menos.remover).toEqual([idsAntes[2]]);
    semDuplicarNemPerder(antes, aplicar(antes, menos));
    // de 25 para 12 por dia: 3 viram 5 (as 3 que existiam + 2 novas)
    const mais = plano(planejarVisitas(antes, { ...P25, porDia: 12 }, HOJE));
    expect(forma(mais)).toEqual([[idsAntes[0], "2026-11-12", 12], [idsAntes[1], "2026-11-13", 12], [idsAntes[2], "2026-11-16", 12], [null, "2026-11-17", 12], [null, "2026-11-18", 12]]);
    semDuplicarNemPerder(antes, aplicar(antes, mais));
  });

  it("NÃO mexe no que já foi feito: visita concluída, em andamento ou cancelada fica de fora; só a pendente é refeita", () => {
    const feitaComSobra = [...faixa(1, 20, true), ...faixa(21, 25)];
    const estado = [
      visita("v1", "2026-11-12", feitaComSobra, { status: "CONCLUIDA" }),
      visita("v2", "2026-11-13", [...faixa(26, 30, true), ...faixa(31, 50)], { status: "EM_ANDAMENTO" }),
      visita("v3", "2026-11-16", faixa(51, 60)),
      visita("v4", "2026-11-17", faixa(61, 70), { status: "CANCELADA" }),
    ];
    const p = plano(planejarVisitas(estado, { inicio: "2026-11-16", porDia: 4, pularFimSemana: true }, HOJE));
    // só os 10 equipamentos da visita pendente entram na conta
    expect(forma(p)).toEqual([["v3", "2026-11-16", 4], [null, "2026-11-17", 4], [null, "2026-11-18", 2]]);
    expect(p.visitas.flatMap((v) => v.equipamentoIds)).toEqual(ids(51, 60));
    expect(p.remover).toEqual([]);
    const depois = aplicar(estado, p);
    // as três que não são pendentes continuam idênticas
    for (const id of ["v1", "v2", "v4"]) expect(depois.find((v) => v.id === id)).toEqual(estado.find((v) => v.id === id));
  });

  it("visita AGENDADA que já tem registro de execução (checklist, foto, aviso) ou equipamento atendido NÃO é pendente", () => {
    expect(visitaPendente(visita("v", HOJE, faixa(1, 3)))).toBe(true);
    expect(visitaPendente(visita("v", HOJE, faixa(1, 3), { executada: true }))).toBe(false);
    expect(visitaPendente(visita("v", HOJE, [eq(1, true), eq(2)]))).toBe(false);
    for (const status of ["EM_ANDAMENTO", "CONCLUIDA", "CANCELADA"]) expect(visitaPendente(visita("v", HOJE, faixa(1, 3), { status }))).toBe(false);
    const estado = [visita("v1", "2026-11-12", faixa(1, 5), { executada: true }), visita("v2", "2026-11-13", faixa(6, 10))];
    expect(forma(plano(planejarVisitas(estado, { ...P25, porDia: 3 }, HOJE)))).toEqual([["v2", "2026-11-12", 3], [null, "2026-11-13", 2]]);
  });

  it("equipamento já atendido em outra visita não volta para a fila (nem que esteja numa pendente)", () => {
    const estado = [visita("v1", "2026-11-12", [eq(1, true), eq(2, true)], { status: "CONCLUIDA" }), visita("v2", "2026-11-13", [eq(2), eq(3), eq(4)])];
    expect(filaDePendentes(estado)).toEqual(["q003", "q004"]);
    // o mesmo equipamento em duas pendentes conta uma vez
    expect(filaDePendentes([visita("a", "2026-11-12", [eq(1), eq(2)]), visita("b", "2026-11-13", [eq(2), eq(3)])])).toEqual(["q001", "q002", "q003"]);
  });

  it("SOBRAS: o que ficou sem atendimento em visita concluída volta para a fila só se pedido — sem mexer na visita concluída", () => {
    const estado = [
      visita("v1", "2026-11-12", [...faixa(1, 20, true), ...faixa(21, 25)], { status: "CONCLUIDA" }),
      visita("v2", "2026-11-13", faixa(26, 35)),
    ];
    expect(sobras(estado)).toEqual(ids(21, 25));
    const sem = plano(planejarVisitas(estado, { inicio: "2026-11-13", porDia: 10, pularFimSemana: true }, HOJE));
    expect(sem.visitas.flatMap((v) => v.equipamentoIds)).toEqual(ids(26, 35));
    const com = plano(planejarVisitas(estado, { inicio: "2026-11-13", porDia: 10, pularFimSemana: true, incluirSobras: true }, HOJE));
    expect(forma(com)).toEqual([["v2", "2026-11-13", 10], [null, "2026-11-16", 5]]);
    expect(com.visitas[1].equipamentoIds).toEqual(ids(21, 25));
    // depois de aplicado, não é mais sobra (já está numa pendente): replanejar de novo não duplica
    const depois = aplicar(estado, com);
    expect(sobras(depois)).toEqual([]);
    const denovo = plano(planejarVisitas(depois, { inicio: "2026-11-13", porDia: 10, pularFimSemana: true, incluirSobras: true }, HOJE));
    expect(denovo.visitas.flatMap((v) => v.equipamentoIds).sort()).toEqual([...ids(21, 35)].sort());
    // sobra que está numa visita em andamento, ou que foi atendida noutra visita, não é sobra
    expect(sobras([visita("v1", HOJE, [eq(1)], { status: "CONCLUIDA" }), visita("v2", HOJE, [eq(1)], { status: "EM_ANDAMENTO" })])).toEqual([]);
    expect(sobras([visita("v1", HOJE, [eq(1)], { status: "CONCLUIDA" }), visita("v2", HOJE, [eq(1, true)], { status: "CONCLUIDA" })])).toEqual([]);
    expect(sobras([visita("v1", HOJE, [eq(1)], { status: "CANCELADA" })])).toEqual([]);
  });
});

describe("visitas da OS: incluir dia, tirar dia, mover", () => {
  const tres = () => [visita("v1", "2026-11-12", faixa(1, 25)), visita("v2", "2026-11-13", faixa(26, 50)), visita("v3", "2026-11-16", faixa(51, 60))];

  it("INCLUIR UM DIA: mais uma visita no dia escolhido, e os equipamentos pendentes repartidos por igual; cada visita continua no SEU dia", () => {
    const p = plano(incluirDia(tres(), "2026-11-14", HOJE));
    expect(forma(p)).toEqual([["v1", "2026-11-12", 15], ["v2", "2026-11-13", 15], [null, "2026-11-14", 15], ["v3", "2026-11-16", 15]]);
    expect(p.remover).toEqual([]);
    expect(p.visitas.flatMap((v) => v.equipamentoIds)).toEqual(ids(1, 60)); // a sequência por local se mantém
    semDuplicarNemPerder(tres(), aplicar(tres(), p));
    // no fim da fila também
    expect(forma(plano(incluirDia(tres(), "2026-11-20", HOJE))).at(-1)).toEqual([null, "2026-11-20", 15]);
  });

  it("incluir dia: recusa dia que já tem visita pendente, dia passado, e quando não há equipamento para mais um dia", () => {
    expect(erro(incluirDia(tres(), "2026-11-13", HOJE))).toBe("Já existe uma visita pendente nesse dia.");
    expect(erro(incluirDia(tres(), "2026-11-11", HOJE))).toBe("Esse dia já passou.");
    expect(erro(incluirDia(tres(), "13/11/2026", HOJE))).toBe("Informe o dia da nova visita.");
    expect(erro(incluirDia([visita("v1", HOJE, [eq(1)])], "2026-11-13", HOJE))).toBe("Não há equipamentos para mais um dia: cada visita ficaria sem equipamento.");
    expect(erro(incluirDia([visita("v1", HOJE, faixa(1, 5, true), { status: "CONCLUIDA" })], "2026-11-13", HOJE))).toBe("Não há visita pendente para repartir os equipamentos.");
  });

  it("TIRAR UM DIA: a visita deixa de existir e os equipamentos dela vão para as outras pendentes — nada se perde", () => {
    const p = plano(tirarDia(tres(), "v2"));
    expect(forma(p)).toEqual([["v1", "2026-11-12", 30], ["v3", "2026-11-16", 30]]);
    expect(p.remover).toEqual(["v2"]);
    semDuplicarNemPerder(tres(), aplicar(tres(), p));
    expect(erro(tirarDia([visita("v1", HOJE, faixa(1, 5))], "v1"))).toBe("É a única visita pendente. Para mudar o dia, mova a visita.");
    expect(erro(tirarDia(tres(), "nao-existe"))).toBe(MSG_NAO_PENDENTE);
    expect(erro(tirarDia([...tres(), visita("v9", "2026-11-10", faixa(90, 95, true), { status: "CONCLUIDA" })], "v9"))).toBe(MSG_NAO_PENDENTE);
  });

  it("MOVER UMA VISITA de dia: só ela muda; lotes e as outras visitas ficam como estão", () => {
    const p = plano(moverVisita(tres(), "v2", "2026-11-19", HOJE));
    expect(forma(p)).toEqual([["v1", "2026-11-12", 25], ["v3", "2026-11-16", 10], ["v2", "2026-11-19", 25]]);
    expect(p.remover).toEqual([]);
    expect(erro(moverVisita(tres(), "v2", "2026-11-10", HOJE))).toBe("Esse dia já passou.");
    expect(erro(moverVisita(tres(), "v2", "", HOJE))).toBe("Informe o novo dia da visita.");
    expect(erro(moverVisita([...tres(), visita("v9", HOJE, faixa(90, 91), { status: "EM_ANDAMENTO" })], "v9", "2026-11-19", HOJE))).toBe(MSG_NAO_PENDENTE);
    // pode ir para um sábado: mover é escolha de quem planeja
    expect(erro(moverVisita(tres(), "v2", "2026-11-14", HOJE))).toBeNull();
  });

  it("AJUSTE MANUAL: mover equipamentos de uma visita pendente para outra; a que fica vazia deixa de existir", () => {
    const p = plano(moverEquipamentos(tres(), ["q001", "q002", "q030"], "v3"));
    expect(forma(p)).toEqual([["v1", "2026-11-12", 23], ["v2", "2026-11-13", 24], ["v3", "2026-11-16", 13]]);
    expect(p.visitas[2].equipamentoIds.slice(-3)).toEqual(["q001", "q002", "q030"]);
    semDuplicarNemPerder(tres(), aplicar(tres(), p));
    // mover o que já está no destino não muda nada (idempotente)
    expect(forma(plano(moverEquipamentos(tres(), ["q051"], "v3")))).toEqual([["v1", "2026-11-12", 25], ["v2", "2026-11-13", 25], ["v3", "2026-11-16", 10]]);
    // esvaziar uma visita: ela sai
    const vazio = plano(moverEquipamentos(tres(), ids(51, 60), "v1"));
    expect(forma(vazio)).toEqual([["v1", "2026-11-12", 35], ["v2", "2026-11-13", 25]]);
    expect(vazio.remover).toEqual(["v3"]);
  });

  it("mover equipamento: só entre visitas pendentes e só o que ainda não foi atendido", () => {
    const comFeita = [...tres(), visita("v0", "2026-11-11", faixa(90, 95, true), { status: "CONCLUIDA" })];
    expect(erro(moverEquipamentos(comFeita, ["q001"], "v0"))).toBe(MSG_NAO_PENDENTE);
    expect(erro(moverEquipamentos(comFeita, ["q090"], "v1"))).toBe("Só dá para mover equipamento de uma visita pendente.");
    expect(erro(moverEquipamentos(tres(), ["nao-existe"], "v1"))).toBe("Só dá para mover equipamento de uma visita pendente.");
    expect(erro(moverEquipamentos(tres(), [], "v1"))).toBe("Escolha os equipamentos a mover.");
  });
});

describe("visitas da OS: progresso e numeração", () => {
  it("o progresso SOMA as visitas: equipamento distinto atendido sobre equipamento distinto; cancelada não conta", () => {
    const estado = [
      visita("v1", "2026-11-12", [...faixa(1, 20, true), ...faixa(21, 25)], { status: "CONCLUIDA" }),
      visita("v2", "2026-11-13", [...faixa(26, 40, true), ...faixa(41, 50)], { status: "EM_ANDAMENTO" }),
      visita("v3", "2026-11-16", faixa(51, 60)),
      visita("v4", "2026-11-17", faixa(61, 99, true), { status: "CANCELADA" }),
    ];
    expect(progressoDasVisitas(estado)).toEqual({ feitos: 35, total: 60, visitas: 3, concluidas: 1 });
    // o equipamento que voltou numa segunda visita conta UMA vez no total e, atendido, uma vez nos feitos
    const voltou = [visita("v1", HOJE, [eq(1), eq(2, true)], { status: "CONCLUIDA" }), visita("v2", HOJE, [eq(1, true)], { status: "CONCLUIDA" })];
    expect(progressoDasVisitas(voltou)).toEqual({ feitos: 2, total: 2, visitas: 2, concluidas: 2 });
    expect(progressoDasVisitas([])).toEqual({ feitos: 0, total: 0, visitas: 0, concluidas: 0 });
  });

  it("'Visita N de M': por data, sem contar a cancelada; sem data vai para o fim", () => {
    const n = numerarVisitas([
      { id: "c", status: "AGENDADA", dataAgendada: "2026-11-16T15:00:00Z" }, { id: "a", status: "CONCLUIDA", dataAgendada: "2026-11-12T15:00:00Z" },
      { id: "x", status: "CANCELADA", dataAgendada: "2026-11-13T15:00:00Z" }, { id: "b", status: "AGENDADA", dataAgendada: new Date("2026-11-13T15:00:00Z") },
      { id: "z", status: "AGENDADA", dataAgendada: null },
    ]);
    expect([...n]).toEqual([["a", { numero: 1, total: 4 }], ["b", { numero: 2, total: 4 }], ["c", { numero: 3, total: 4 }], ["z", { numero: 4, total: 4 }]]);
    expect(n.has("x")).toBe(false);
  });

  it("os pedidos da rota: cada operação com os seus campos; o que falta tem mensagem", () => {
    const ok = (d: unknown) => pedidoVisitasSchema.safeParse(d).success;
    const msg = (d: unknown) => { const r = pedidoVisitasSchema.safeParse(d); return r.success ? null : r.error.issues[0].message; };
    expect(pedidoVisitasSchema.parse({ acao: "PLANEJAR", inicio: HOJE, porDia: 25 })).toEqual({ acao: "PLANEJAR", inicio: HOJE, porDia: 25, pularFimSemana: true });
    expect(ok({ acao: "PLANEJAR", inicio: HOJE, porDia: 25, pularFimSemana: false, incluirSobras: true, executor: { tecnicoIds: ["t1"], equipeId: "e1" } })).toBe(true);
    expect(msg({ acao: "PLANEJAR", porDia: 25 })).toBe("Informe a data de início.");
    expect(msg({ acao: "PLANEJAR", inicio: "2026-02-31", porDia: 25 })).toBe("Informe a data de início.");
    expect(msg({ acao: "PLANEJAR", inicio: HOJE })).toBe("Informe quantos equipamentos por dia.");
    expect(msg({ acao: "PLANEJAR", inicio: HOJE, porDia: "25" })).toBe("Informe quantos equipamentos por dia.");
    expect(msg({ acao: "PLANEJAR", inicio: HOJE, porDia: 0 })).toBe("Informe quantos equipamentos por dia.");
    expect(msg({ acao: "PLANEJAR", inicio: HOJE, porDia: 2.5 })).toBe("Informe um número inteiro de equipamentos por dia.");
    expect(msg({ acao: "PLANEJAR", inicio: HOJE, porDia: 501 })).toBe("São no máximo 500 equipamentos por dia.");
    expect(ok({ acao: "MOVER_VISITA", visitaId: "v1", dia: HOJE })).toBe(true);
    expect(msg({ acao: "MOVER_VISITA", visitaId: "v1", dia: "amanhã" })).toBe("Informe o novo dia da visita.");
    expect(ok({ acao: "INCLUIR_DIA", dia: HOJE })).toBe(true);
    expect(msg({ acao: "INCLUIR_DIA" })).toBe("Informe o dia da nova visita.");
    expect(ok({ acao: "TIRAR_DIA", visitaId: "v1" })).toBe(true);
    expect(ok({ acao: "MOVER_EQUIPAMENTOS", equipamentoIds: ["q1"], paraVisitaId: "v2" })).toBe(true);
    expect(msg({ acao: "MOVER_EQUIPAMENTOS", equipamentoIds: [], paraVisitaId: "v2" })).toBe("Escolha os equipamentos a mover.");
    expect(ok({ acao: "APAGAR_TUDO" })).toBe(false);
    expect(ok({})).toBe(false);
  });
});
