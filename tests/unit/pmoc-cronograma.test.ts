/**
 * PMOC — Etapa 2: as regras PURAS do cronograma (lib/pmoc-cronograma), com o relógio em 12/11/2026,
 * 12:00 de Brasília. O que o banco e as rotas fazem está em pmoc-cronograma-pg; aqui é a conta:
 *  - as datas: primeira execução, de N em N meses, até a expiração (inclusive);
 *  - a quem o item se aplica (todos, tipo, equipamento; cadastro antigo pelo tipo do enum);
 *  - quando o plano não gera (inativo, rascunho, expirado);
 *  - o PLANO de reagendamento, caso a caso, e a prova de que aplicá-lo e planejar de novo não muda nada.
 */
import { describe, expect, it } from "vitest";
import {
  FREQUENCIAS, descricaoDaOs, equipamentoNoItem, equipamentosSemCronograma, escopoDoItem, execucaoPendente, itemCronogramaSchema, motivoSemGerar,
  FIM_SEMANA_PADRAO, FINS_DE_SEMANA, execucoesDesejadas, nomeComPmoc, prevalece,
  ocorrenciasDoItem, periodoDaOs, planejarCronograma, planoTemMudanca, proximaOcorrencia, resumirPlano, rotuloFrequencia, soCriar, textoResultado,
  type EquipamentoPlano, type EstadoCronograma, type ExecucaoExistente, type ItemCronograma, type OsDaExecucao, type PlanoCronograma,
} from "@/lib/pmoc-cronograma";
import { proximasOcorrencias } from "@/lib/recorrencia-helpers";

const AGORA = new Date("2026-11-12T15:00:00.000Z");
const meioDia = (iso: string) => `${iso}T15:00:00.000Z`;
const dias = (item: Partial<ItemCronograma>, exp = "2027-11-11") => ocorrenciasDoItem({ dataInicio: "2026-11-12", intervaloMeses: 1, diaExecucao: 25, ...item }, exp).map((o) => o.data.toISOString().slice(0, 10));

describe("cronograma: as datas", () => {
  it("mensal, dia 25, a partir de 12/11: de 25/11 até a última antes da expiração; ao meio-dia de Brasília", () => {
    const oc = ocorrenciasDoItem({ dataInicio: "2026-11-12", intervaloMeses: 1, diaExecucao: 25 }, "2027-11-11");
    expect(oc.map((o) => o.periodo)).toEqual(["2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06", "2027-07", "2027-08", "2027-09", "2027-10"]);
    expect(oc[0].data.toISOString()).toBe(meioDia("2026-11-25"));
    expect(oc.at(-1)!.data.toISOString()).toBe(meioDia("2027-10-25"));
  });

  it("a primeira é o primeiro 'dia de execução' NO início ou depois dele; daí em diante, de N em N meses", () => {
    expect(dias({ dataInicio: "2026-11-25", diaExecucao: 25, intervaloMeses: 3 })).toEqual(["2026-11-25", "2027-02-25", "2027-05-25", "2027-08-25"]); // começa no próprio dia
    expect(dias({ dataInicio: "2026-11-26", diaExecucao: 25, intervaloMeses: 3 })).toEqual(["2026-12-25", "2027-03-25", "2027-06-25", "2027-09-25"]); // o dia 25 de nov. já passou
    expect(dias({ dataInicio: "2026-12-31", diaExecucao: 1, intervaloMeses: 6 })).toEqual(["2027-01-01", "2027-07-01"]);                               // vira o ano
  });

  it("a cada N meses: bimestral, semestral, anual e intervalos sem nome (4, 5…)", () => {
    expect(dias({ intervaloMeses: 2 })).toEqual(["2026-11-25", "2027-01-25", "2027-03-25", "2027-05-25", "2027-07-25", "2027-09-25"]);
    expect(dias({ intervaloMeses: 6 })).toEqual(["2026-11-25", "2027-05-25"]);
    expect(dias({ intervaloMeses: 12 })).toEqual(["2026-11-25"]);
    expect(dias({ intervaloMeses: 4 })).toEqual(["2026-11-25", "2027-03-25", "2027-07-25"]);
    expect(dias({ intervaloMeses: 5 }, "2028-11-11")).toEqual(["2026-11-25", "2027-04-25", "2027-09-25", "2028-02-25", "2028-07-25"]);
  });

  it("expiração: a execução no próprio dia da expiração entra; um dia depois, não; início depois da expiração, nenhuma", () => {
    expect(dias({}, "2027-01-25")).toEqual(["2026-11-25", "2026-12-25", "2027-01-25"]);
    expect(dias({}, "2027-01-24")).toEqual(["2026-11-25", "2026-12-25"]);
    expect(dias({ dataInicio: "2027-11-12" })).toEqual([]);
    expect(dias({}, "2026-11-24")).toEqual([]);
  });

  it("dia 28 existe em todo mês (fevereiro inclusive); dia fora de 1–28 e intervalo inválido são contidos", () => {
    expect(dias({ diaExecucao: 28, intervaloMeses: 3 }, "2027-03-31")).toEqual(["2026-11-28", "2027-02-28"]);
    expect(dias({ diaExecucao: 31, intervaloMeses: 12 })).toEqual(["2026-11-28"]);
    expect(dias({ diaExecucao: 0, dataInicio: "2026-11-01", intervaloMeses: 12 })).toEqual(["2026-11-01", "2027-11-01"]);
    expect(dias({ intervaloMeses: 0 })).toHaveLength(12); // vira mensal: nunca laço infinito
  });

  it("a próxima execução é a primeira de hoje em diante (a de hoje ainda conta); null quando acabou", () => {
    const item = { dataInicio: "2026-06-01", intervaloMeses: 1, diaExecucao: 12 };
    expect(proximaOcorrencia(item, "2027-11-11", AGORA)!.data.toISOString()).toBe(meioDia("2026-11-12"));
    expect(proximaOcorrencia({ ...item, diaExecucao: 11 }, "2027-11-11", AGORA)!.data.toISOString()).toBe(meioDia("2026-12-11"));
    expect(proximaOcorrencia(item, "2026-11-11", AGORA)).toBeNull();
  });

  it("reaproveita a recorrência dos contratos sem mudar o que ela já fazia (frequência por nome continua valendo)", () => {
    const base = { dataInicio: new Date("2026-11-01T00:00:00Z"), dataFim: new Date("2027-10-31T00:00:00Z"), diaRecorrencia: 10, fimSemana: "MANTER", aPartirDe: new Date("2026-11-01T15:00:00Z"), limite: 50 };
    const periodos = (extra: object) => proximasOcorrencias({ ...base, frequencia: "TRIMESTRAL", ...extra }).map((o) => o.periodo);
    expect(periodos({})).toEqual(["2026-11", "2027-02", "2027-05", "2027-08"]);                      // como sempre foi
    expect(periodos({ intervaloMeses: null })).toEqual(["2026-11", "2027-02", "2027-05", "2027-08"]); // sem o número, vale o nome
    expect(periodos({ intervaloMeses: 4 })).toEqual(["2026-11", "2027-03", "2027-07"]);               // com o número, vale o número
  });

  it("frequência por extenso e o que o formulário aceita", () => {
    expect(FREQUENCIAS.map((f) => [f.meses, f.rotulo])).toEqual([[1, "Mensal"], [2, "Bimestral"], [3, "Trimestral"], [6, "Semestral"], [12, "Anual"]]);
    expect([1, 3, 12, 4, 18].map(rotuloFrequencia)).toEqual(["Mensal", "Trimestral", "Anual", "A cada 4 meses", "A cada 18 meses"]);
    const ok = { tipoOsId: "to1", dataInicio: "2026-11-12", intervaloMeses: 1, diaExecucao: 25 };
    expect(itemCronogramaSchema.parse(ok)).toMatchObject({ tipoEquipamentoId: null, equipamentoId: null, intervaloMeses: 1, diaExecucao: 25 });
    expect(itemCronogramaSchema.parse({ ...ok, tipoEquipamentoId: "", equipamentoId: "q1" })).toMatchObject({ tipoEquipamentoId: null, equipamentoId: "q1" });
    const erro = (extra: object) => itemCronogramaSchema.safeParse({ ...ok, ...extra }).error?.issues[0].message;
    expect(erro({ diaExecucao: 29 })).toBe("O dia de execução vai de 1 a 28.");
    expect(erro({ diaExecucao: null })).toBe("Informe o dia de execução.");
    expect(erro({ intervaloMeses: "3" })).toBe("Informe de quantos em quantos meses.");
    expect(erro({ tipoEquipamentoId: "te1", equipamentoId: "q1" })).toBe("Escolha um tipo de equipamento OU um equipamento, não os dois.");
  });
});

/* ───────── a quem se aplica ───────── */
const eq = (id: string, extra: Partial<EquipamentoPlano> = {}): EquipamentoPlano => ({ id, ativo: true, unidadeId: "u1", tipoEquipamentoId: "teSplit", tipo: "AR_CONDICIONADO_SPLIT", ...extra });
const TIPOS = [{ id: "teSplit", chaveEnum: "AR_CONDICIONADO_SPLIT" }, { id: "teChiller", chaveEnum: "CHILLER" }, { id: "teSemChave", chaveEnum: null }];
const item = (id: string, extra: Partial<ItemCronograma> = {}): ItemCronograma => ({ id, ativo: true, tipoEquipamentoId: null, equipamentoId: null, tipoOsId: "to1", dataInicio: "2026-11-12", intervaloMeses: 6, diaExecucao: 25, fimSemana: "MANTER", criadoEm: "2026-11-01T12:00:00.000Z", ...extra });

describe("cronograma: a quem o item se aplica", () => {
  it("todos, por tipo e por equipamento; cadastro antigo (sem tipo novo) entra pelo tipo do enum", () => {
    const chiller = eq("qC", { tipoEquipamentoId: "teChiller", tipo: "CHILLER" });
    const antigo = eq("qA", { tipoEquipamentoId: null });
    expect([item("i"), item("i", { tipoEquipamentoId: "teSplit" }), item("i", { equipamentoId: "qC" })].map(escopoDoItem)).toEqual(["TODOS", "TIPO", "EQUIPAMENTO"]);
    const entra = (i: ItemCronograma) => [eq("q1"), chiller, antigo].filter((e) => equipamentoNoItem(i, e, TIPOS)).map((e) => e.id);
    expect(entra(item("i"))).toEqual(["q1", "qC", "qA"]);
    expect(entra(item("i", { tipoEquipamentoId: "teSplit" }))).toEqual(["q1", "qA"]);
    expect(entra(item("i", { tipoEquipamentoId: "teChiller" }))).toEqual(["qC"]);
    expect(entra(item("i", { tipoEquipamentoId: "teSemChave" }))).toEqual([]);
    expect(entra(item("i", { equipamentoId: "qC" }))).toEqual(["qC"]);
    // Com tipo novo no cadastro, vale ELE — não o enum antigo (que pode ter ficado para trás)
    const reclassificado = eq("qR", { tipoEquipamentoId: "teChiller", tipo: "AR_CONDICIONADO_SPLIT" });
    expect(equipamentoNoItem(item("i", { tipoEquipamentoId: "teChiller" }), reclassificado, TIPOS)).toBe(true);
    expect(equipamentoNoItem(item("i", { tipoEquipamentoId: "teSplit" }), reclassificado, TIPOS)).toBe(false);
  });

  it("equipamentos ativos fora de todos os itens ativos: é o que a tela avisa", () => {
    const equipamentos = [eq("q1"), eq("qC", { tipoEquipamentoId: "teChiller", tipo: "CHILLER" }), eq("qInativo", { ativo: false, tipoEquipamentoId: "teChiller" })];
    expect(equipamentosSemCronograma([item("i1", { tipoEquipamentoId: "teSplit" })], equipamentos, TIPOS)).toEqual(["qC"]);
    expect(equipamentosSemCronograma([item("i1", { tipoEquipamentoId: "teSplit" }), item("i2", { ativo: false })], equipamentos, TIPOS)).toEqual(["qC"]); // item excluído não cobre
    expect(equipamentosSemCronograma([item("i1")], equipamentos, TIPOS)).toEqual([]);
    expect(equipamentosSemCronograma([], equipamentos, TIPOS)).toEqual(["q1", "qC"]);
  });
});

/* ───────── o plano ───────── */
const PMOC = { status: "PUBLICADO", ativo: true, dataInicio: "2026-11-12", dataExpiracao: "2027-11-11" };
const estado = (extra: Partial<EstadoCronograma> = {}): EstadoCronograma => ({ pmoc: PMOC, itens: [item("i1")], equipamentos: [eq("q1"), eq("q2")], tipos: TIPOS, execucoes: [], ...extra });
const os = (id: string, dia: string, extra: Partial<OsDaExecucao> = {}): OsDaExecucao => ({ id, numero: id.toUpperCase(), status: "AGENDADA", atividadeId: `a-${id}`, atividadeStatus: "AGENDADA", dataAgendada: meioDia(dia), equipamentoIds: ["q1", "q2"], feitos: [], ...extra });
const exec = (equipamentoId: string, periodo: string, o: OsDaExecucao | null, extra: Partial<ExecucaoExistente> = {}): ExecucaoExistente => ({
  id: `x-${equipamentoId}-${periodo}`, cronogramaId: "i1", equipamentoId, periodo, dataPrevista: meioDia(`${periodo}-25`), os: o, ...extra,
});
/** Aplica o plano ao estado, como o servidor faz no banco — para provar que planejar de novo não muda nada */
function aplicar(e: EstadoCronograma, p: PlanoCronograma): EstadoCronograma {
  let n = 0;
  const execucoes = e.execucoes.filter((x) => !p.retirar.some((r) => r.execucaoId === x.id)).map((x) => ({ ...x, os: x.os ? { ...x.os, equipamentoIds: [...x.os.equipamentoIds], feitos: [...x.os.feitos] } : null }));
  const porOs = new Map(execucoes.filter((x) => x.os).map((x) => [x.os!.id, x.os!]));
  for (const r of p.retirar) if (!p.cancelar.includes(r.osId)) { const o = porOs.get(r.osId); if (o) o.equipamentoIds = o.equipamentoIds.filter((id) => id !== r.equipamentoId); }
  for (const m of p.mover) for (const x of execucoes) if (x.os?.id === m.osId) { x.os.dataAgendada = m.para.toISOString(); if (m.execucaoIds.includes(x.id)) x.dataPrevista = m.para.toISOString(); }
  for (const c of p.criar) {
    const nova = os(`nova${++n}`, c.data.toISOString().slice(0, 10), { equipamentoIds: [...c.equipamentoIds] });
    for (const id of c.equipamentoIds) execucoes.push({ id: `x-${c.itemId}-${id}-${c.periodo}`, cronogramaId: c.itemId, equipamentoId: id, periodo: c.periodo, dataPrevista: c.data.toISOString(), os: nova });
  }
  for (const i of p.incluir) {
    const alvo = porOs.get(i.osId)!; alvo.equipamentoIds.push(i.equipamentoId);
    execucoes.push({ id: `x-${i.itemId}-${i.equipamentoId}-${i.periodo}`, cronogramaId: i.itemId, equipamentoId: i.equipamentoId, periodo: i.periodo, dataPrevista: i.data.toISOString(), os: alvo });
  }
  return { ...e, execucoes };
}
const criar = (p: PlanoCronograma) => p.criar.map((c) => [c.data.toISOString().slice(0, 10), c.unidadeId, c.equipamentoIds, c.itemId]);

describe("cronograma: quando o plano gera", () => {
  it("só ativo, publicado e não expirado — o dia da expiração ainda vale", () => {
    expect(motivoSemGerar(PMOC, AGORA)).toBeNull();
    expect(motivoSemGerar({ ...PMOC, status: "RASCUNHO" }, AGORA)).toBe("RASCUNHO");
    expect(motivoSemGerar({ ...PMOC, ativo: false }, AGORA)).toBe("INATIVO");
    expect(motivoSemGerar({ ...PMOC, ativo: false, status: "RASCUNHO" }, AGORA)).toBe("INATIVO");
    expect(motivoSemGerar({ ...PMOC, dataExpiracao: "2026-11-12" }, AGORA)).toBeNull();
    expect(motivoSemGerar({ ...PMOC, dataExpiracao: "2026-11-11" }, AGORA)).toBe("EXPIRADO");
  });

  it("rascunho, inativo e expirado: plano vazio — nada é criado NEM mexido, mesmo havendo OS geradas", () => {
    const comOs = { execucoes: [exec("q1", "2026-11", os("o1", "2026-11-25")), exec("q2", "2026-11", os("o1", "2026-11-25"))], equipamentos: [eq("q1"), eq("q2", { ativo: false })] };
    for (const pmoc of [{ ...PMOC, status: "RASCUNHO" }, { ...PMOC, ativo: false }, { ...PMOC, dataExpiracao: "2026-11-11" }]) {
      const p = planejarCronograma(estado({ pmoc, ...comOs }), AGORA);
      expect(planoTemMudanca(p)).toBe(false);
      expect(p.motivo).not.toBeNull();
    }
  });
});

describe("cronograma: o plano de reagendamento", () => {
  it("nada gerado ainda: uma OS por item, competência e LOCAL, com os equipamentos ativos do item", () => {
    const p = planejarCronograma(estado({ equipamentos: [eq("q1"), eq("q2"), eq("q3", { unidadeId: "u2" }), eq("qInativo", { ativo: false })] }), AGORA);
    expect(criar(p)).toEqual([
      ["2026-11-25", "u1", ["q1", "q2"], "i1"], ["2026-11-25", "u2", ["q3"], "i1"],
      ["2027-05-25", "u1", ["q1", "q2"], "i1"], ["2027-05-25", "u2", ["q3"], "i1"],
    ]);
    expect(resumirPlano(p)).toEqual({ criar: 4, incluir: 0, mover: 0, retirar: 0, cancelar: 0, mantidas: 0, substituidos: 0 });
  });

  // Etapa 2.1: antes, dois itens no mesmo equipamento e no mesmo mês geravam DUAS OS; agora só o de maior
  // intervalo gera (a substituição tem o seu bloco de testes mais abaixo). Em equipamentos ou meses
  // diferentes, cada item continua sendo um serviço, com a sua OS.
  it("itens em equipamentos diferentes geram OS separadas (cada item é um serviço); item inativo não gera", () => {
    const itens = [item("iSplit", { equipamentoId: "q1", intervaloMeses: 12 }), item("iChiller", { equipamentoId: "q2", intervaloMeses: 12, diaExecucao: 20, tipoOsId: "to2" }), item("iExcluido", { ativo: false })];
    const p = planejarCronograma(estado({ itens }), AGORA);
    expect(criar(p)).toEqual([["2026-11-20", "u1", ["q2"], "iChiller"], ["2026-11-25", "u1", ["q1"], "iSplit"]]);
  });

  it("nunca cria no passado: item que começou há meses só gera de hoje em diante (a de hoje entra)", () => {
    const p = planejarCronograma(estado({ equipamentos: [eq("q1")], itens: [item("i1", { dataInicio: "2026-06-01", intervaloMeses: 1, diaExecucao: 12 })], pmoc: { ...PMOC, dataExpiracao: "2027-01-31" } }), AGORA);
    expect(criar(p).map((c) => c[0])).toEqual(["2026-11-12", "2026-12-12", "2027-01-12"]);
  });

  it("tudo já gerado e igual ao cronograma: plano sem mudança (idempotência)", () => {
    const o1 = os("o1", "2026-11-25"), o2 = os("o2", "2027-05-25");
    const p = planejarCronograma(estado({ execucoes: [exec("q1", "2026-11", o1), exec("q2", "2026-11", o1), exec("q1", "2027-05", o2), exec("q2", "2027-05", o2)] }), AGORA);
    expect(planoTemMudanca(p)).toBe(false);
    expect(resumirPlano(p)).toEqual({ criar: 0, incluir: 0, mover: 0, retirar: 0, cancelar: 0, mantidas: 0, substituidos: 0 });
  });

  it("aplicar o plano e planejar de novo não muda nada — em todos os cenários abaixo", () => {
    const o1 = os("o1", "2026-11-25"), o2 = os("o2", "2027-05-25");
    const gerado = [exec("q1", "2026-11", o1), exec("q2", "2026-11", o1), exec("q1", "2027-05", o2), exec("q2", "2027-05", o2)];
    const cenarios: EstadoCronograma[] = [
      estado({ equipamentos: [eq("q1"), eq("q2"), eq("q3", { unidadeId: "u2" })] }),                                   // do zero
      estado({ execucoes: gerado, itens: [item("i1", { diaExecucao: 27 })] }),                                        // mudou o dia
      estado({ execucoes: gerado, equipamentos: [eq("q1"), eq("q2", { ativo: false })] }),                            // equipamento inativado
      estado({ execucoes: gerado, equipamentos: [eq("q1"), eq("q2"), eq("q3"), eq("q4", { unidadeId: "u2" })] }),     // equipamentos novos
      estado({ execucoes: gerado, itens: [item("i1", { ativo: false })] }),                                           // item excluído
      estado({ execucoes: gerado, pmoc: { ...PMOC, dataExpiracao: "2027-03-31" } }),                                  // plano encurtado
      estado({ execucoes: gerado, itens: [item("i1", { intervaloMeses: 3 })] }),                                      // frequência maior
    ];
    for (const [i, e] of cenarios.entries()) {
      const p = planejarCronograma(e, AGORA);
      expect(planoTemMudanca(p), `cenário ${i}: tem o que fazer`).toBe(true);
      const depois = planejarCronograma(aplicar(e, p), AGORA);
      expect(resumirPlano(depois), `cenário ${i}: depois de aplicado`).toEqual({ criar: 0, incluir: 0, mover: 0, retirar: 0, cancelar: 0, mantidas: 0, substituidos: 0 });
    }
  });

  it("mudou o dia de execução: muda a data da OS inteira (uma vez por OS), não cria outra", () => {
    const o1 = os("o1", "2026-11-25"), o2 = os("o2", "2027-05-25");
    const p = planejarCronograma(estado({ itens: [item("i1", { diaExecucao: 27 })], execucoes: [exec("q1", "2026-11", o1), exec("q2", "2026-11", o1), exec("q1", "2027-05", o2), exec("q2", "2027-05", o2)] }), AGORA);
    expect(p.mover.map((m) => [m.osId, m.atividadeId, m.de.slice(0, 10), m.para.toISOString().slice(0, 10), m.execucaoIds])).toEqual([
      ["o1", "a-o1", "2026-11-25", "2026-11-27", ["x-q1-2026-11", "x-q2-2026-11"]],
      ["o2", "a-o2", "2027-05-25", "2027-05-27", ["x-q1-2027-05", "x-q2-2027-05"]],
    ]);
    expect(p.criar).toEqual([]);
  });

  it("data mudada à mão não é desfeita; data nova no passado não é aplicada", () => {
    const manual = os("oManual", "2027-05-20", { equipamentoIds: ["q1"] }); // o escritório puxou de 25/05 para 20/05
    const e = estado({ equipamentos: [eq("q1")], itens: [item("i1", { diaExecucao: 5, dataInicio: "2026-11-01" })], execucoes: [exec("q1", "2026-11", os("oNov", "2026-11-25", { equipamentoIds: ["q1"] })), exec("q1", "2027-05", manual)] });
    const p = planejarCronograma(e, AGORA);
    expect(p.mover).toEqual([]);              // novembro: 05/11 já passou; maio: ajustada à mão
    expect(p.mantidas).toEqual(["oManual"]);
    expect(p.retirar).toEqual([]);
    expect(p.criar.map((c) => c.periodo)).toEqual(["2027-11"]); // com o dia 5 cabe mais uma competência antes da expiração
  });

  it("só mexe no que AINDA NÃO COMEÇOU: OS iniciada, concluída, cancelada, de data passada, apagada ou com o equipamento já atendido ficam", () => {
    const fixas: OsDaExecucao[] = [
      os("o", "2026-11-25", { status: "EM_ANDAMENTO", atividadeStatus: "EM_ANDAMENTO" }),
      os("o", "2026-11-25", { status: "CONCLUIDA", atividadeStatus: "CONCLUIDA" }),
      os("o", "2026-11-25", { status: "CANCELADA" }),
      os("o", "2026-11-25", { status: "PAUSADA" }),
      os("o", "2026-11-25", { atividadeStatus: "CANCELADA" }),
      os("o", "2026-11-11"),                                   // ontem
      os("o", "2026-11-25", { feitos: ["q1"] }),               // o técnico já atendeu este equipamento
      os("o", "2026-11-25", { atividadeId: null, dataAgendada: null }),
    ];
    for (const [i, o] of fixas.entries()) expect(execucaoPendente(exec("q1", "2026-11", o), "2026-11-12"), `caso ${i}`).toBe(false);
    expect(execucaoPendente(exec("q1", "2026-11", null), "2026-11-12")).toBe(false);
    for (const status of ["ABERTA", "AGUARDANDO_ATENDIMENTO", "AGENDADA"]) expect(execucaoPendente(exec("q1", "2026-11", os("o", "2026-11-12", { status })), "2026-11-12")).toBe(true); // hoje ainda é pendente
    // Equipamento inativado com a OS já em andamento: fica; e a competência não é gerada de novo
    const andamento = os("o1", "2026-11-25", { status: "EM_ANDAMENTO", atividadeStatus: "EM_ANDAMENTO", equipamentoIds: ["q1"] });
    const p = planejarCronograma(estado({ equipamentos: [eq("q1", { ativo: false })], itens: [item("i1", { intervaloMeses: 12 })], execucoes: [exec("q1", "2026-11", andamento)] }), AGORA);
    expect(planoTemMudanca(p)).toBe(false);
    // OS apagada ou cancelada à mão: a execução continua registrada, então NÃO é gerada outra
    for (const o of [null, os("o1", "2026-11-25", { status: "CANCELADA" })]) {
      const q = planejarCronograma(estado({ equipamentos: [eq("q1")], itens: [item("i1", { intervaloMeses: 12 })], execucoes: [exec("q1", "2026-11", o)] }), AGORA);
      expect(q.criar).toEqual([]);
    }
  });

  it("equipamento inativado ou tirado do plano: sai das OS pendentes; a OS continua enquanto tiver outro equipamento", () => {
    const o1 = os("o1", "2026-11-25"), o2 = os("o2", "2027-05-25");
    const execucoes = [exec("q1", "2026-11", o1), exec("q2", "2026-11", o1), exec("q1", "2027-05", o2), exec("q2", "2027-05", o2)];
    for (const equipamentos of [[eq("q1"), eq("q2", { ativo: false })], [eq("q1")]]) {
      const p = planejarCronograma(estado({ equipamentos, execucoes }), AGORA);
      expect(p.retirar.map((r) => [r.osId, r.atividadeId, r.equipamentoId, r.execucaoId])).toEqual([["o1", "a-o1", "q2", "x-q2-2026-11"], ["o2", "a-o2", "q2", "x-q2-2027-05"]]);
      expect(p.cancelar).toEqual([]);
      expect(p.criar).toEqual([]);
    }
  });

  it("OS que fica sem equipamento nenhum entra em 'cancelar'; com equipamento posto à mão, não", () => {
    const sozinho = os("o1", "2026-11-25", { equipamentoIds: ["q2"] });
    const comExtra = os("o2", "2027-05-25", { equipamentoIds: ["q2", "qPostoAMao"] });
    const p = planejarCronograma(estado({ equipamentos: [eq("q2", { ativo: false })], execucoes: [exec("q2", "2026-11", sozinho), exec("q2", "2027-05", comExtra)] }), AGORA);
    expect(p.retirar.map((r) => r.osId)).toEqual(["o1", "o2"]);
    expect(p.retirar.every((r) => !("substituidoPor" in r))).toBe(true); // saiu por estar inativo, não por substituição
    expect(resumirPlano(p)).toMatchObject({ retirar: 2, substituidos: 0 });
    expect(p.cancelar).toEqual(["o1"]);
  });

  it("equipamento novo: entra na OS pendente do mesmo item, competência e local — com a data do cronograma como prevista; noutro local, OS nova", () => {
    const o1 = os("o1", "2026-11-25", { equipamentoIds: ["q1"] }), o2 = os("o2", "2027-05-22", { equipamentoIds: ["q1"] }); // a de maio foi puxada à mão para o dia 22
    const p = planejarCronograma(estado({ equipamentos: [eq("q1"), eq("q2"), eq("q3", { unidadeId: "u2" })], execucoes: [exec("q1", "2026-11", o1), exec("q1", "2027-05", o2)] }), AGORA);
    expect(p.incluir.map((i) => [i.osId, i.atividadeId, i.equipamentoId, i.periodo, i.data.toISOString().slice(0, 10)])).toEqual([
      ["o1", "a-o1", "q2", "2026-11", "2026-11-25"],
      ["o2", "a-o2", "q2", "2027-05", "2027-05-25"], // a prevista é a do cronograma: a OS continua contando como ajustada à mão
    ]);
    expect(criar(p)).toEqual([["2026-11-25", "u2", ["q3"], "i1"], ["2027-05-25", "u2", ["q3"], "i1"]]);
    expect(p.mantidas).toEqual(["o2"]);
  });

  it("a OS do local já começou: o equipamento novo ganha OS própria (não entra em OS em andamento)", () => {
    const andamento = os("o1", "2026-11-25", { status: "EM_ANDAMENTO", atividadeStatus: "EM_ANDAMENTO", equipamentoIds: ["q1"] });
    const p = planejarCronograma(estado({ itens: [item("i1", { intervaloMeses: 12 })], execucoes: [exec("q1", "2026-11", andamento)] }), AGORA);
    expect(p.incluir).toEqual([]);
    expect(criar(p)).toEqual([["2026-11-25", "u1", ["q2"], "i1"]]);
  });

  it("item excluído, frequência menor e plano encurtado: as competências que deixaram de existir saem; as que ficam, ficam", () => {
    const o = (id: string, dia: string) => os(id, dia, { equipamentoIds: ["q1"] });
    const execucoes = [exec("q1", "2026-11", o("o1", "2026-11-25")), exec("q1", "2027-02", o("o2", "2027-02-25")), exec("q1", "2027-05", o("o3", "2027-05-25")), exec("q1", "2027-08", o("o4", "2027-08-25"))];
    const base = { equipamentos: [eq("q1")], execucoes };
    expect(planejarCronograma(estado({ ...base, itens: [item("i1", { ativo: false })] }), AGORA).cancelar).toEqual(["o1", "o2", "o3", "o4"]);
    expect(planejarCronograma(estado({ ...base, itens: [item("i1", { intervaloMeses: 6 })] }), AGORA).cancelar).toEqual(["o2", "o4"]);
    expect(planejarCronograma(estado({ ...base, itens: [item("i1", { intervaloMeses: 3 })], pmoc: { ...PMOC, dataExpiracao: "2027-03-31" } }), AGORA).cancelar).toEqual(["o3", "o4"]);
  });

  it("'só criar' (o que roda sozinho ao publicar e ao salvar): cria e inclui; nunca muda data, retira ou cancela", () => {
    const o1 = os("o1", "2026-11-25", { equipamentoIds: ["q1", "qInativo"] });
    const completo = planejarCronograma(estado({
      itens: [item("i1", { diaExecucao: 27 })], equipamentos: [eq("q1"), eq("q2"), eq("qInativo", { ativo: false })],
      execucoes: [exec("q1", "2026-11", o1), exec("qInativo", "2026-11", o1)],
    }), AGORA);
    expect(resumirPlano(completo)).toMatchObject({ criar: 1, incluir: 1, mover: 1, retirar: 1 });
    expect(resumirPlano(soCriar(completo))).toEqual({ criar: 1, incluir: 1, mover: 0, retirar: 0, cancelar: 0, mantidas: 0, substituidos: 0 });
  });
});

/* ───────── Etapa 2.1: substituição ───────── */
/** A rotina LEVE, mensal, dia 25, em todos os equipamentos — criada primeiro */
const leve = (extra: Partial<ItemCronograma> = {}) => item("iLeve", { intervaloMeses: 1, criadoEm: "2026-11-01T12:00:00.000Z", ...extra });
/** A LIMPEZA QUÍMICA, semestral, dia 25, a partir de abril/2027 (o 6º mês do plano) — criada depois */
const quimica = (extra: Partial<ItemCronograma> = {}) => item("iQuimica", { intervaloMeses: 6, tipoOsId: "toQuimica", dataInicio: "2027-04-01", criadoEm: "2026-11-02T12:00:00.000Z", ...extra });
/** Por competência, quem atende cada equipamento: { "2027-04": { q1: "iQuimica", q2: "iLeve" } } */
function quemAtende(p: PlanoCronograma) {
  const out: Record<string, Record<string, string>> = {};
  for (const c of [...p.criar].sort((a, b) => a.periodo.localeCompare(b.periodo))) for (const id of c.equipamentoIds) (out[c.periodo] ??= {})[id] = c.itemId;
  return out;
}
const MESES = ["2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06", "2027-07", "2027-08", "2027-09", "2027-10"];

describe("cronograma: substituição — no mesmo equipamento e na mesma competência, só o item de MAIOR intervalo gera", () => {
  it("mensal + química semestral, mês a mês: nos meses 1 a 5 só a leve; no 6º só a química; e assim de novo até o 12º", () => {
    const p = planejarCronograma(estado({ itens: [leve(), quimica()] }), AGORA);
    const atende = quemAtende(p);
    expect(Object.keys(atende)).toEqual(MESES);
    for (const [n, mes] of MESES.entries()) {
      const esperado = n === 5 || n === 11 ? "iQuimica" : "iLeve"; // abril/2027 e outubro/2027
      expect(atende[mes], mes).toEqual({ q1: esperado, q2: esperado });
    }
    // Uma OS por mês (e não duas no mês da química): 12 no total, 10 da leve e 2 da química
    expect(p.criar).toHaveLength(12);
    expect(p.criar.filter((c) => c.itemId === "iLeve")).toHaveLength(10);
    expect(criar(p).filter((c) => c[3] === "iQuimica")).toEqual([["2027-04-25", "u1", ["q1", "q2"], "iQuimica"], ["2027-10-25", "u1", ["q1", "q2"], "iQuimica"]]);
  });

  it("vale a COMPETÊNCIA, não o dia: leve no dia 10 e química no dia 25 do mesmo mês ainda é uma OS só (a da química)", () => {
    const p = planejarCronograma(estado({ itens: [leve({ diaExecucao: 10, dataInicio: "2026-12-01" }), quimica()] }), AGORA);
    expect(criar(p).filter((c) => (c[0] as string).startsWith("2027-04"))).toEqual([["2027-04-25", "u1", ["q1", "q2"], "iQuimica"]]);
    expect(criar(p).filter((c) => (c[0] as string).startsWith("2027-03"))).toEqual([["2027-03-10", "u1", ["q1", "q2"], "iLeve"]]);
  });

  it("é POR EQUIPAMENTO: a química só em alguns — cada equipamento resolve sozinho qual serviço vale no mês", () => {
    const p = planejarCronograma(estado({ equipamentos: [eq("q1"), eq("q2"), eq("q3")], itens: [leve(), quimica({ equipamentoId: "q2" })] }), AGORA);
    const abril = criar(p).filter((c) => (c[0] as string).startsWith("2027-04"));
    // A OS da leve continua existindo em abril, sem o q2; o q2 vai na OS da química
    expect(abril).toEqual([["2027-04-25", "u1", ["q1", "q3"], "iLeve"], ["2027-04-25", "u1", ["q2"], "iQuimica"]]);
    expect(quemAtende(p)["2027-03"]).toEqual({ q1: "iLeve", q2: "iLeve", q3: "iLeve" });
    expect(quemAtende(p)["2027-10"]).toEqual({ q1: "iLeve", q2: "iQuimica", q3: "iLeve" });
  });

  it("por TIPO de equipamento: a química dos chillers não tira a leve dos splits", () => {
    const equipamentos = [eq("q1"), eq("qC", { tipoEquipamentoId: "teChiller", tipo: "CHILLER" })];
    const p = planejarCronograma(estado({ equipamentos, itens: [leve(), quimica({ tipoEquipamentoId: "teChiller" })] }), AGORA);
    expect(quemAtende(p)["2027-04"]).toEqual({ q1: "iLeve", qC: "iQuimica" });
  });

  it("três camadas (mensal, trimestral, semestral): no mês em que as três coincidem só a semestral gera", () => {
    const tri = item("iTri", { intervaloMeses: 3, tipoOsId: "toTri", dataInicio: "2027-01-01", criadoEm: "2026-11-03T12:00:00.000Z" });
    const atende = quemAtende(planejarCronograma(estado({ equipamentos: [eq("q1")], itens: [leve(), tri, quimica()] }), AGORA));
    expect(MESES.map((m) => atende[m].q1)).toEqual(["iLeve", "iLeve", "iTri", "iLeve", "iLeve", "iQuimica", "iLeve", "iLeve", "iTri", "iLeve", "iLeve", "iQuimica"]);
  });

  it("DESEMPATE no mesmo intervalo: vale o item criado primeiro — em qualquer ordem da lista; no mesmo instante, o de menor id", () => {
    const a = item("iB-criadoAntes", { intervaloMeses: 6, criadoEm: "2026-11-01T12:00:00.000Z" });
    const b = item("iA-criadoDepois", { intervaloMeses: 6, criadoEm: "2026-11-05T12:00:00.000Z", tipoOsId: "to2", diaExecucao: 20 });
    for (const itens of [[a, b], [b, a]]) {
      const p = planejarCronograma(estado({ equipamentos: [eq("q1")], itens }), AGORA);
      expect(criar(p)).toEqual([["2026-11-25", "u1", ["q1"], "iB-criadoAntes"], ["2027-05-25", "u1", ["q1"], "iB-criadoAntes"]]);
    }
    expect(prevalece(a, b)).toBe(true);
    expect(prevalece(b, a)).toBe(false);
    // intervalo maior ganha de quem foi criado antes
    expect(prevalece({ ...b, intervaloMeses: 12 }, a)).toBe(true);
    expect(prevalece(a, { ...b, intervaloMeses: 12 })).toBe(false);
    // mesmo intervalo e mesmo instante de criação: o id decide (sempre o mesmo resultado)
    const gemeo = { ...b, criadoEm: a.criadoEm };
    expect(prevalece(gemeo, a)).toBe(true);  // "iA-…" < "iB-…"
    expect(prevalece(a, gemeo)).toBe(false);
  });

  it("execução que passou SEM nunca ter sido gerada não substitui ninguém; a que foi gerada, sim (mesmo já passada)", () => {
    // A química de novembro era no dia 5 — já passou e nunca virou OS: a leve do dia 25 sai normalmente
    const itens = [leve(), quimica({ dataInicio: "2026-11-01", diaExecucao: 5 })];
    expect(quemAtende(planejarCronograma(estado({ equipamentos: [eq("q1")], itens }), AGORA))["2026-11"]).toEqual({ q1: "iLeve" });
    // Se a química do dia 5 foi gerada (e feita), ela é o serviço de novembro: a leve não sai
    const feita = os("oQ", "2026-11-05", { status: "CONCLUIDA", atividadeStatus: "CONCLUIDA", equipamentoIds: ["q1"], feitos: ["q1"] });
    const p = planejarCronograma(estado({ equipamentos: [eq("q1")], itens, execucoes: [exec("q1", "2026-11", feita, { cronogramaId: "iQuimica" })] }), AGORA);
    expect(quemAtende(p)["2026-11"]).toBeUndefined();
    expect(quemAtende(p)["2026-12"]).toEqual({ q1: "iLeve" });
  });

  it("a lista do que foi substituído diz quem cedeu, em que mês e para qual item — é o que a tela mostra", () => {
    const { desejado, substituidas } = execucoesDesejadas(estado({ equipamentos: [eq("q1")], itens: [leve(), quimica()] }), AGORA);
    expect(substituidas.map((x) => [x.item.id, x.equipamento.id, x.periodo, x.porItemId])).toEqual([["iLeve", "q1", "2027-04", "iQuimica"], ["iLeve", "q1", "2027-10", "iQuimica"]]);
    expect([...desejado.values()].filter((q) => q.periodo === "2027-04").map((q) => q.item.id)).toEqual(["iQuimica"]);
    expect(desejado.size).toBe(12);
  });

  it("um item só, itens em meses diferentes e plano que não gera: nada é substituído", () => {
    expect(execucoesDesejadas(estado(), AGORA).substituidas).toEqual([]);
    const alternados = [item("iA", { intervaloMeses: 2 }), item("iB", { intervaloMeses: 2, dataInicio: "2026-12-01", criadoEm: "2026-11-02T12:00:00.000Z" })];
    expect(execucoesDesejadas(estado({ itens: alternados }), AGORA).substituidas).toEqual([]);
    expect(planejarCronograma(estado({ itens: [leve(), quimica()], pmoc: { ...PMOC, status: "RASCUNHO" } }), AGORA)).toMatchObject({ motivo: "RASCUNHO", criar: [] });
  });
});

describe("cronograma: substituição com OS já geradas — 'Reagendar atividades'", () => {
  const oAbr = () => os("oAbr", "2027-04-25"), oMai = () => os("oMai", "2027-05-25");
  /** A leve já gerou abril e maio (q1 e q2 na mesma OS); só depois entrou a química */
  const geradas = (abr = oAbr(), mai = oMai()) => [
    exec("q1", "2027-04", abr, { cronogramaId: "iLeve" }), exec("q2", "2027-04", abr, { cronogramaId: "iLeve" }),
    exec("q1", "2027-05", mai, { cronogramaId: "iLeve" }), exec("q2", "2027-05", mai, { cronogramaId: "iLeve" }),
  ];
  const curto = { ...PMOC, dataInicio: "2027-04-01", dataExpiracao: "2027-05-31" };
  const AGORA_ABR = new Date("2027-04-01T15:00:00.000Z");
  const itens = (q: Partial<ItemCronograma> = {}) => [leve({ dataInicio: "2027-04-01" }), quimica(q)];

  it("a química entrou depois: a OS da leve de abril fica VAZIA e é cancelada; a de maio fica; a da química é criada", () => {
    const p = planejarCronograma(estado({ pmoc: curto, itens: itens(), execucoes: geradas() }), AGORA_ABR);
    // cada retirada diz por quem o equipamento passou a ser atendido (vai para o histórico da OS)
    expect(p.retirar.map((r) => [r.osId, r.equipamentoId, r.substituidoPor])).toEqual([["oAbr", "q1", "iQuimica"], ["oAbr", "q2", "iQuimica"]]);
    expect(p.cancelar).toEqual(["oAbr"]);
    expect(criar(p)).toEqual([["2027-04-25", "u1", ["q1", "q2"], "iQuimica"]]);
    expect(resumirPlano(p)).toEqual({ criar: 1, incluir: 0, mover: 0, retirar: 2, cancelar: 1, mantidas: 0, substituidos: 2 });
  });

  it("o que roda sozinho ao salvar SÓ cria: a OS da química nasce, a da leve fica até o 'Reagendar' (nada é cancelado sem pedir)", () => {
    const p = soCriar(planejarCronograma(estado({ pmoc: curto, itens: itens(), execucoes: geradas() }), AGORA_ABR));
    expect(resumirPlano(p)).toEqual({ criar: 1, incluir: 0, mover: 0, retirar: 0, cancelar: 0, mantidas: 0, substituidos: 0 });
  });

  it("química só no q2: o q2 sai da OS da leve, que CONTINUA com o q1 (não é cancelada)", () => {
    const p = planejarCronograma(estado({ pmoc: curto, itens: itens({ equipamentoId: "q2" }), execucoes: geradas() }), AGORA_ABR);
    expect(p.retirar.map((r) => [r.osId, r.equipamentoId])).toEqual([["oAbr", "q2"]]);
    expect(p.cancelar).toEqual([]);
    expect(criar(p)).toEqual([["2027-04-25", "u1", ["q2"], "iQuimica"]]);
  });

  it("a leve de abril já começou (ou já foi feita): fica como histórico — o reagendamento não mexe nela", () => {
    for (const extra of [{ status: "EM_ANDAMENTO", atividadeStatus: "EM_ANDAMENTO" }, { status: "CONCLUIDA", atividadeStatus: "CONCLUIDA", feitos: ["q1", "q2"] }]) {
      const p = planejarCronograma(estado({ pmoc: curto, itens: itens(), execucoes: geradas(os("oAbr", "2027-04-25", extra)) }), AGORA_ABR);
      expect(p.retirar, extra.status).toEqual([]);
      expect(p.cancelar, extra.status).toEqual([]);
      expect(criar(p), extra.status).toEqual([["2027-04-25", "u1", ["q1", "q2"], "iQuimica"]]);
    }
  });

  it("a química já gerada continua valendo como o serviço do mês mesmo com a OS cancelada à mão: a leve não volta sozinha", () => {
    const cancelada = os("oQ", "2027-04-25", { status: "CANCELADA" });
    const execucoes = [exec("q1", "2027-04", cancelada, { cronogramaId: "iQuimica" }), exec("q2", "2027-04", cancelada, { cronogramaId: "iQuimica" })];
    const p = planejarCronograma(estado({ pmoc: curto, itens: itens(), execucoes }), AGORA_ABR);
    expect(criar(p)).toEqual([["2027-05-25", "u1", ["q1", "q2"], "iLeve"]]);
  });

  it("a química foi EXCLUÍDA do cronograma: a OS dela é cancelada e a leve do mês volta a ser gerada", () => {
    const oQ = os("oQ", "2027-04-25");
    const execucoes = [exec("q1", "2027-04", oQ, { cronogramaId: "iQuimica" }), exec("q2", "2027-04", oQ, { cronogramaId: "iQuimica" })];
    const p = planejarCronograma(estado({ pmoc: curto, itens: itens({ ativo: false }), execucoes }), AGORA_ABR);
    expect(p.cancelar).toEqual(["oQ"]);
    expect(criar(p)).toEqual([["2027-04-25", "u1", ["q1", "q2"], "iLeve"], ["2027-05-25", "u1", ["q1", "q2"], "iLeve"]]);
  });

  it("IDEMPOTENTE: aplicar o plano e planejar de novo não muda nada — nem cria, nem cancela em looping", () => {
    const oQ = os("oQ", "2027-04-25");
    const daQuimica = [exec("q1", "2027-04", oQ, { cronogramaId: "iQuimica" }), exec("q2", "2027-04", oQ, { cronogramaId: "iQuimica" })];
    const empate = [item("iX", { intervaloMeses: 1, dataInicio: "2027-04-01", criadoEm: "2026-11-09T12:00:00.000Z" }), leve({ dataInicio: "2027-04-01" })];
    const cenarios: [string, EstadoCronograma, Date][] = [
      ["do zero, um ano", estado({ itens: [leve(), quimica()] }), AGORA],
      ["do zero, química parcial", estado({ equipamentos: [eq("q1"), eq("q2"), eq("q3", { unidadeId: "u2" })], itens: [leve(), quimica({ equipamentoId: "q2" })] }), AGORA],
      ["química entrou depois", estado({ pmoc: curto, itens: itens(), execucoes: geradas() }), AGORA_ABR],
      ["química parcial entrou depois", estado({ pmoc: curto, itens: itens({ equipamentoId: "q2" }), execucoes: geradas() }), AGORA_ABR],
      ["química excluída", estado({ pmoc: curto, itens: itens({ ativo: false }), execucoes: daQuimica }), AGORA_ABR],
      ["química virou mensal (empate com a leve)", estado({ pmoc: curto, itens: itens({ intervaloMeses: 1 }), execucoes: daQuimica }), AGORA_ABR],
      ["empate entre dois mensais já gerados", estado({ pmoc: curto, itens: empate, execucoes: [...geradas(), exec("q1", "2027-04", os("oX", "2027-04-25", { equipamentoIds: ["q1"] }), { id: "x-iX-q1-2027-04", cronogramaId: "iX" })] }), AGORA_ABR],
    ];
    for (const [nome, e, agora] of cenarios) {
      const p = planejarCronograma(e, agora);
      expect(planoTemMudanca(p), `${nome}: tem o que fazer`).toBe(true);
      let atual = aplicar(e, p);
      for (let volta = 1; volta <= 3; volta++) {
        const depois = planejarCronograma(atual, agora);
        expect(resumirPlano(depois), `${nome}: volta ${volta}`).toEqual({ criar: 0, incluir: 0, mover: 0, retirar: 0, cancelar: 0, mantidas: 0, substituidos: 0 });
        atual = aplicar(atual, depois);
      }
      // E o modo que roda sozinho ("só criar"), aplicado antes, chega ao mesmo fim depois de um reagendamento
      const sozinho = aplicar(e, soCriar(planejarCronograma(e, agora)));
      const final = aplicar(sozinho, planejarCronograma(sozinho, agora));
      expect(resumirPlano(planejarCronograma(final, agora)), `${nome}: depois do automático + reagendar`).toEqual({ criar: 0, incluir: 0, mover: 0, retirar: 0, cancelar: 0, mantidas: 0, substituidos: 0 });
    }
  });
});

/* ───────── Etapa 2.1: fim de semana ───────── */
describe("cronograma: dia de execução em sábado ou domingo — manter, adiantar (sexta) ou postergar (segunda)", () => {
  // Dia 14: 14/11/2026 é sábado, 14/12 é segunda, 14/01/2027 é quinta, 14/02 e 14/03 são domingos
  const dia14 = (fimSemana?: "MANTER" | "ADIANTAR" | "POSTERGAR") => dias({ diaExecucao: 14, fimSemana }, "2027-03-31");

  it("as três opções, com a mesma regra dos contratos; sem a opção (itens antigos) = manter", () => {
    expect(dia14("MANTER")).toEqual(["2026-11-14", "2026-12-14", "2027-01-14", "2027-02-14", "2027-03-14"]);
    expect(dia14("ADIANTAR")).toEqual(["2026-11-13", "2026-12-14", "2027-01-14", "2027-02-12", "2027-03-12"]);
    expect(dia14("POSTERGAR")).toEqual(["2026-11-16", "2026-12-14", "2027-01-14", "2027-02-15", "2027-03-15"]);
    expect(dia14()).toEqual(dia14("MANTER"));
    expect(FINS_DE_SEMANA).toEqual(["MANTER", "ADIANTAR", "POSTERGAR"]);
    expect(FIM_SEMANA_PADRAO).toBe("POSTERGAR"); // o que a tela propõe nos itens novos
  });

  it("dia útil não muda em nenhuma opção; a hora continua meio-dia de Brasília", () => {
    for (const f of FINS_DE_SEMANA) {
      const oc = ocorrenciasDoItem({ dataInicio: "2026-11-12", intervaloMeses: 12, diaExecucao: 25, fimSemana: f }, "2027-11-11"); // 25/11/2026: quarta
      expect(oc.map((o) => o.data.toISOString()), f).toEqual([meioDia("2026-11-25")]);
    }
    const seg = ocorrenciasDoItem({ dataInicio: "2026-11-12", intervaloMeses: 12, diaExecucao: 14, fimSemana: "POSTERGAR" }, "2027-11-11");
    expect(seg[0].data.toISOString()).toBe(meioDia("2026-11-16"));
  });

  it("a COMPETÊNCIA continua sendo o mês do dia de execução, mesmo quando a data ajustada escorrega para o mês vizinho", () => {
    // 28/02/2027 é domingo: postergar leva para 01/03, mas a execução é a de fevereiro
    const fev = ocorrenciasDoItem({ dataInicio: "2027-02-01", intervaloMeses: 1, diaExecucao: 28, fimSemana: "POSTERGAR" }, "2027-03-15");
    expect(fev.map((o) => [o.periodo, o.data.toISOString().slice(0, 10)])).toEqual([["2027-02", "2027-03-01"]]);
    // 01/08/2027 é domingo: adiantar leva para 30/07, mas a execução é a de agosto
    const ago = ocorrenciasDoItem({ dataInicio: "2027-07-02", intervaloMeses: 1, diaExecucao: 1, fimSemana: "ADIANTAR" }, "2027-08-31");
    expect(ago.map((o) => [o.periodo, o.data.toISOString().slice(0, 10)])).toEqual([["2027-08", "2027-07-30"]]);
  });

  it("o ajuste nunca passa dos limites: adiantar para antes do início do item e postergar para depois da expiração não geram", () => {
    // início no sábado 14/11, dia 14, adiantar: a sexta 13/11 é antes do início — a primeira é a de dezembro
    expect(dias({ dataInicio: "2026-11-14", diaExecucao: 14, fimSemana: "ADIANTAR" }, "2026-12-31")).toEqual(["2026-12-14"]);
    expect(dias({ dataInicio: "2026-11-14", diaExecucao: 14, fimSemana: "MANTER" }, "2026-12-31")).toEqual(["2026-11-14", "2026-12-14"]);
    // expira no domingo 14/02/2027: postergar levaria para 15/02, depois da expiração
    expect(dias({ diaExecucao: 14, fimSemana: "POSTERGAR", intervaloMeses: 3 }, "2027-02-14")).toEqual(["2026-11-16"]);
    expect(dias({ diaExecucao: 14, fimSemana: "MANTER", intervaloMeses: 3 }, "2027-02-14")).toEqual(["2026-11-14", "2027-02-14"]);
  });

  it("a próxima execução e o plano usam a data ajustada", () => {
    const base = { dataInicio: "2026-11-12", intervaloMeses: 1, diaExecucao: 14 };
    expect(proximaOcorrencia({ ...base, fimSemana: "POSTERGAR" }, "2027-11-11", AGORA)!.data.toISOString()).toBe(meioDia("2026-11-16"));
    expect(proximaOcorrencia({ ...base, fimSemana: "ADIANTAR" }, "2027-11-11", AGORA)!.data.toISOString()).toBe(meioDia("2026-11-13"));
    const p = planejarCronograma(estado({ itens: [item("i1", { ...base, fimSemana: "POSTERGAR" })], pmoc: { ...PMOC, dataExpiracao: "2026-12-31" } }), AGORA);
    expect(p.criar.map((c) => [c.periodo, c.data.toISOString().slice(0, 10)])).toEqual([["2026-11", "2026-11-16"], ["2026-12", "2026-12-14"]]);
  });

  it("mudou a opção num item já gerado: salvar não mexe na agenda; 'Reagendar' leva a OS do sábado para a segunda (e de volta)", () => {
    const base = { dataInicio: "2026-11-12", intervaloMeses: 12, diaExecucao: 14 };
    const sab = os("o1", "2026-11-14"), x = [exec("q1", "2026-11", sab, { dataPrevista: meioDia("2026-11-14") }), exec("q2", "2026-11", sab, { dataPrevista: meioDia("2026-11-14") })];
    const e = estado({ itens: [item("i1", { ...base, fimSemana: "POSTERGAR" })], execucoes: x });
    const p = planejarCronograma(e, AGORA);
    expect(p.mover.map((m) => [m.osId, m.para.toISOString().slice(0, 10)])).toEqual([["o1", "2026-11-16"]]);
    expect(resumirPlano(soCriar(p))).toEqual({ criar: 0, incluir: 0, mover: 0, retirar: 0, cancelar: 0, mantidas: 0, substituidos: 0 });
    const depois = aplicar(e, p);
    expect(planoTemMudanca(planejarCronograma(depois, AGORA))).toBe(false);
    const volta = planejarCronograma({ ...depois, itens: [item("i1", { ...base, fimSemana: "MANTER" })] }, AGORA);
    expect(volta.mover.map((m) => m.para.toISOString().slice(0, 10))).toEqual(["2026-11-14"]);
  });

  it("substituição e fim de semana juntos: a disputa é pela competência do dia de execução, não pela data ajustada", () => {
    // A leve de fevereiro (dia 28, domingo) vai para 01/03; a química é de março (dia 10): cada uma no seu mês
    const itens = [leve({ dataInicio: "2027-02-01", diaExecucao: 28, fimSemana: "POSTERGAR" }), quimica({ dataInicio: "2027-03-01", diaExecucao: 10 })];
    const p = planejarCronograma(estado({ equipamentos: [eq("q1")], itens, pmoc: { ...PMOC, dataInicio: "2027-02-01", dataExpiracao: "2027-04-30" } }), new Date("2027-02-01T15:00:00.000Z"));
    expect(p.criar.map((c) => [c.periodo, c.data.toISOString().slice(0, 10), c.itemId]).sort()).toEqual([
      ["2027-02", "2027-03-01", "iLeve"], ["2027-03", "2027-03-10", "iQuimica"], ["2027-04", "2027-04-28", "iLeve"],
    ]);
  });

  it("o formulário: a opção é opcional (o servidor completa) e só aceita os três valores", () => {
    const ok = { tipoOsId: "to1", dataInicio: "2026-11-12", intervaloMeses: 1, diaExecucao: 25 };
    expect(itemCronogramaSchema.parse(ok).fimSemana).toBeUndefined();
    for (const f of FINS_DE_SEMANA) expect(itemCronogramaSchema.parse({ ...ok, fimSemana: f }).fimSemana).toBe(f);
    expect(itemCronogramaSchema.safeParse({ ...ok, fimSemana: "ANTECIPAR" }).error?.issues[0].message).toBe("Escolha o que fazer no fim de semana.");
    expect(itemCronogramaSchema.safeParse({ ...ok, fimSemana: "" }).success).toBe(false);
  });
});

describe("cronograma: textos", () => {
  it("o nome do plano nas mensagens não repete 'PMOC' (inclusive no motivo do cancelamento da OS)", () => {
    expect(nomeComPmoc("PMOC 2026 — Hospital")).toBe("PMOC 2026 — Hospital");
    expect(nomeComPmoc("pmoc do anexo")).toBe("pmoc do anexo");
    expect(nomeComPmoc("Hospital Santa Clara")).toBe("PMOC Hospital Santa Clara");
  });

  it("a descrição da OS não repete 'PMOC' quando o nome do plano já diz; a competência vai como MM/AAAA", () => {
    expect(descricaoDaOs("PMOC mensal", "PMOC 2026 — Hospital", "2026-11")).toBe("PMOC mensal — PMOC 2026 — Hospital (11/2026)");
    expect(descricaoDaOs("Manutenção preventiva", "Hospital Santa Clara", "2027-03")).toBe("Manutenção preventiva — PMOC Hospital Santa Clara (03/2027)");
    expect(periodoDaOs("2026-11")).toBe("PMOC:2026-11");
  });

  it("o resumo do que mudou, no singular e no plural; vazio quando nada mudou", () => {
    expect(textoResultado({ criadas: [1], incluidos: 1, movidas: 1, retirados: 1, canceladas: 1 })).toBe("1 OS criada · 1 equipamento incluído · 1 OS com data nova · 1 equipamento retirado · 1 OS cancelada");
    expect(textoResultado({ criadas: 12, incluidos: 0, movidas: 2, retirados: 3, canceladas: 0 })).toBe("12 OS criadas · 2 OS com data nova · 3 equipamentos retirados");
    expect(textoResultado({ criadas: [], incluidos: 0, movidas: 0, retirados: 0, canceladas: 0 })).toBe("");
  });
});
