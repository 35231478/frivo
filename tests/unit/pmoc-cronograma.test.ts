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
const item = (id: string, extra: Partial<ItemCronograma> = {}): ItemCronograma => ({ id, ativo: true, tipoEquipamentoId: null, equipamentoId: null, tipoOsId: "to1", dataInicio: "2026-11-12", intervaloMeses: 6, diaExecucao: 25, ...extra });

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
    expect(resumirPlano(p)).toEqual({ criar: 4, incluir: 0, mover: 0, retirar: 0, cancelar: 0, mantidas: 0 });
  });

  it("dois itens que pegam o mesmo equipamento geram OS separadas (cada item é um serviço); item inativo não gera", () => {
    const p = planejarCronograma(estado({ equipamentos: [eq("q1")], itens: [item("iMensal", { intervaloMeses: 12 }), item("iAnual", { intervaloMeses: 12, diaExecucao: 20, tipoOsId: "to2" }), item("iExcluido", { ativo: false })] }), AGORA);
    expect(criar(p)).toEqual([["2026-11-20", "u1", ["q1"], "iAnual"], ["2026-11-25", "u1", ["q1"], "iMensal"]]);
  });

  it("nunca cria no passado: item que começou há meses só gera de hoje em diante (a de hoje entra)", () => {
    const p = planejarCronograma(estado({ equipamentos: [eq("q1")], itens: [item("i1", { dataInicio: "2026-06-01", intervaloMeses: 1, diaExecucao: 12 })], pmoc: { ...PMOC, dataExpiracao: "2027-01-31" } }), AGORA);
    expect(criar(p).map((c) => c[0])).toEqual(["2026-11-12", "2026-12-12", "2027-01-12"]);
  });

  it("tudo já gerado e igual ao cronograma: plano sem mudança (idempotência)", () => {
    const o1 = os("o1", "2026-11-25"), o2 = os("o2", "2027-05-25");
    const p = planejarCronograma(estado({ execucoes: [exec("q1", "2026-11", o1), exec("q2", "2026-11", o1), exec("q1", "2027-05", o2), exec("q2", "2027-05", o2)] }), AGORA);
    expect(planoTemMudanca(p)).toBe(false);
    expect(resumirPlano(p)).toEqual({ criar: 0, incluir: 0, mover: 0, retirar: 0, cancelar: 0, mantidas: 0 });
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
      expect(resumirPlano(depois), `cenário ${i}: depois de aplicado`).toEqual({ criar: 0, incluir: 0, mover: 0, retirar: 0, cancelar: 0, mantidas: 0 });
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
    expect(resumirPlano(soCriar(completo))).toEqual({ criar: 1, incluir: 1, mover: 0, retirar: 0, cancelar: 0, mantidas: 0 });
  });
});

describe("cronograma: textos", () => {
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
