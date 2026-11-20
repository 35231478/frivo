/**
 * CALENDÁRIO — a AUDITORIA dos filtros, pedida pelo dono: "conferir que todos funcionam de verdade
 * e se combinam, com teste travando cada um".
 *
 * Até esta leva o predicado era uma função anônima dentro do componente do painel, sem teste
 * nenhum: dava para quebrar o filtro de técnico (ou o de unidade) e nada acusava. Aqui há um teste
 * por filtro, um para a combinação, um para a contagem da pílula "N filtros ativos" e um para a
 * ida e volta pela URL (inclusive o parâmetro ANTIGO `unidade=`, que era texto digitado).
 *
 * Junto vem a navegação do período (as setas), que na visão Semana andava um MÊS.
 */
import { describe, expect, it } from "vitest";
import {
  CHAVES_FILTRO, FILTROS_VAZIOS, cardCasa, contarAtivos, gravarFiltrosNaUrl, lerFiltrosDaUrl,
  temFiltro, type CardFiltravel, type FiltrosCalendario,
} from "@/lib/calendario/filtros";
import { gridCalendario, passoDoPeriodo, rotuloDoPeriodo } from "@/lib/calendario/grid";

/** Um cartão de OS plausível; cada teste muda só o que interessa. */
const card = (over: Partial<CardFiltravel> = {}): CardFiltravel => ({
  clienteId: "cli-hospital",
  tipoOsId: "tipo-preventiva",
  numero: "OS-2026-0147",
  unidadeId: "uni-matriz",
  tecnicoId: "tec-ana",
  tecnicoIds: ["tec-ana", "tec-bruno"],
  status: "AGENDADA",
  prioridade: "NORMAL",
  ...over,
});

const com = (over: Partial<FiltrosCalendario>): FiltrosCalendario => ({ ...FILTROS_VAZIOS, ...over });

describe("Calendário — cada filtro, isolado", () => {
  it("sem filtro nenhum, todo cartão passa", () => {
    expect(cardCasa(card(), FILTROS_VAZIOS)).toBe(true);
    expect(cardCasa(card({ status: "CONCLUIDA", tipoOsId: null, unidadeId: null }), FILTROS_VAZIOS)).toBe(true);
    expect(temFiltro(FILTROS_VAZIOS)).toBe(false);
  });

  it("CLIENTE: só o cliente escolhido", () => {
    const f = com({ clienteId: "cli-hospital" });
    expect(cardCasa(card(), f)).toBe(true);
    expect(cardCasa(card({ clienteId: "cli-padaria" }), f)).toBe(false);
  });

  it("TIPO DE OS: aceita vários; e a OS sem atividade no período não tem tipo", () => {
    expect(cardCasa(card(), com({ tipos: ["tipo-preventiva"] }))).toBe(true);
    expect(cardCasa(card(), com({ tipos: ["tipo-corretiva"] }))).toBe(false);
    // dois tipos marcados é OU entre eles
    expect(cardCasa(card(), com({ tipos: ["tipo-corretiva", "tipo-preventiva"] }))).toBe(true);
    // o tipo é da ATIVIDADE: a OS que está no calendário pela data prevista não casa com nenhum
    expect(cardCasa(card({ tipoOsId: null }), com({ tipos: ["tipo-preventiva"] }))).toBe(false);
  });

  it("NÚMERO DA OS: trecho, sem caixa e sem espaço sobrando", () => {
    expect(cardCasa(card(), com({ numero: "0147" }))).toBe(true);
    expect(cardCasa(card(), com({ numero: "os-2026" }))).toBe(true);
    expect(cardCasa(card(), com({ numero: "  0147  " }))).toBe(true);
    expect(cardCasa(card(), com({ numero: "0148" }))).toBe(false);
    // só espaço é o mesmo que não filtrar
    expect(cardCasa(card(), com({ numero: "   " }))).toBe(true);
  });

  it("UNIDADE: por id do cadastro (duas empresas podem ter uma 'Matriz')", () => {
    const f = com({ unidadeId: "uni-matriz" });
    expect(cardCasa(card(), f)).toBe(true);
    expect(cardCasa(card({ unidadeId: "uni-anexo" }), f)).toBe(false);
    // OS sem unidade não casa com unidade nenhuma
    expect(cardCasa(card({ unidadeId: null }), f)).toBe(false);
  });

  it("TÉCNICO: o responsável OU qualquer membro da equipe da atividade", () => {
    expect(cardCasa(card(), com({ tecnicoId: "tec-ana" }))).toBe(true);
    // o Bruno não é o responsável, mas está na equipe daquele dia
    expect(cardCasa(card(), com({ tecnicoId: "tec-bruno" }))).toBe(true);
    expect(cardCasa(card(), com({ tecnicoId: "tec-carla" }))).toBe(false);
    // cartão sem equipe gravada não quebra
    expect(cardCasa(card({ tecnicoIds: undefined }), com({ tecnicoId: "tec-ana" }))).toBe(true);
    expect(cardCasa(card({ tecnicoId: null, tecnicoIds: undefined }), com({ tecnicoId: "tec-ana" }))).toBe(false);
  });

  it("STATUS: vários marcados é OU", () => {
    expect(cardCasa(card(), com({ status: ["AGENDADA"] }))).toBe(true);
    expect(cardCasa(card(), com({ status: ["CONCLUIDA"] }))).toBe(false);
    expect(cardCasa(card(), com({ status: ["CONCLUIDA", "AGENDADA"] }))).toBe(true);
  });

  it("PRIORIDADE: vários marcados é OU", () => {
    expect(cardCasa(card({ prioridade: "URGENTE" }), com({ prioridade: ["URGENTE"] }))).toBe(true);
    expect(cardCasa(card({ prioridade: "NORMAL" }), com({ prioridade: ["URGENTE"] }))).toBe(false);
    expect(cardCasa(card({ prioridade: "ALTA" }), com({ prioridade: ["URGENTE", "ALTA"] }))).toBe(true);
  });
});

describe("Calendário — os filtros COMBINADOS (E entre eles)", () => {
  it("todos os sete juntos: passa só quem casa em todos", () => {
    const f = com({
      clienteId: "cli-hospital", tipos: ["tipo-preventiva"], numero: "0147",
      unidadeId: "uni-matriz", tecnicoId: "tec-bruno", status: ["AGENDADA"], prioridade: ["NORMAL"],
    });
    expect(cardCasa(card(), f)).toBe(true);
    // basta UM deles não casar
    expect(cardCasa(card({ clienteId: "cli-padaria" }), f)).toBe(false);
    expect(cardCasa(card({ tipoOsId: "tipo-corretiva" }), f)).toBe(false);
    expect(cardCasa(card({ numero: "OS-2026-0999" }), f)).toBe(false);
    expect(cardCasa(card({ unidadeId: "uni-anexo" }), f)).toBe(false);
    expect(cardCasa(card({ tecnicoId: null, tecnicoIds: [] }), f)).toBe(false);
    expect(cardCasa(card({ status: "EM_ANDAMENTO" }), f)).toBe(false);
    expect(cardCasa(card({ prioridade: "BAIXA" }), f)).toBe(false);
  });

  it("cliente + unidade de OUTRO cliente não devolve nada (o par impossível)", () => {
    const f = com({ clienteId: "cli-hospital", unidadeId: "uni-da-padaria" });
    expect(cardCasa(card(), f)).toBe(false);
    expect(cardCasa(card({ clienteId: "cli-padaria", unidadeId: "uni-da-padaria" }), f)).toBe(false);
  });

  it("a pílula conta um por filtro em uso, não um por valor marcado", () => {
    expect(contarAtivos(FILTROS_VAZIOS)).toBe(0);
    expect(contarAtivos(com({ status: ["ABERTA", "AGENDADA", "CONCLUIDA"] }))).toBe(1);
    expect(contarAtivos(com({ clienteId: "c", tecnicoId: "t" }))).toBe(2);
    expect(contarAtivos(com({ numero: "   " })), "só espaço não é filtro").toBe(0);
    const todos = com({
      clienteId: "c", tipos: ["t"], numero: "1", unidadeId: "u", tecnicoId: "te",
      status: ["A"], prioridade: ["P"],
    });
    expect(contarAtivos(todos)).toBe(CHAVES_FILTRO.length);
  });
});

describe("Calendário — os filtros na URL", () => {
  const url = (q: string) => new URLSearchParams(q);

  it("lê e grava de volta sem perder nada", () => {
    const lidos = lerFiltrosDaUrl(url("clienteId=c1&tipos=t1,t2&numero=147&unidadeId=u1&tecnicoId=te1&status=ABERTA&prioridade=ALTA,URGENTE"));
    expect(lidos).toEqual({
      clienteId: "c1", tipos: ["t1", "t2"], numero: "147", unidadeId: "u1",
      tecnicoId: "te1", status: ["ABERTA"], prioridade: ["ALTA", "URGENTE"],
    });
    const p = gravarFiltrosNaUrl(new URLSearchParams(), lidos);
    expect(lerFiltrosDaUrl(p)).toEqual(lidos);
  });

  it("o mês, o ano, a visão e o dia não são tocados ao gravar os filtros", () => {
    const p = gravarFiltrosNaUrl(url("mes=3&ano=2027&view=semanal&dia=12"), com({ clienteId: "c1" }));
    expect(p.get("mes")).toBe("3");
    expect(p.get("ano")).toBe("2027");
    expect(p.get("view")).toBe("semanal");
    expect(p.get("dia")).toBe("12");
    expect(p.get("clienteId")).toBe("c1");
  });

  it("filtro vazio SAI da URL (link limpo)", () => {
    const p = gravarFiltrosNaUrl(url("clienteId=c1&status=ABERTA"), FILTROS_VAZIOS);
    expect(p.get("clienteId")).toBeNull();
    expect(p.get("status")).toBeNull();
  });

  it("link antigo com `unidade=` (o nome digitado) vira o id do cadastro", () => {
    const unidades = [{ value: "u1", label: "Matriz" }, { value: "u2", label: "Anexo Oncologia" }];
    expect(lerFiltrosDaUrl(url("unidade=Anexo%20Oncologia"), unidades).unidadeId).toBe("u2");
    // sem caixa também
    expect(lerFiltrosDaUrl(url("unidade=matriz"), unidades).unidadeId).toBe("u1");
    // nome que não existe mais no cadastro não vira filtro fantasma
    expect(lerFiltrosDaUrl(url("unidade=Galpão%20Velho"), unidades).unidadeId).toBe("");
    // e o parâmetro antigo some assim que é traduzido
    expect(gravarFiltrosNaUrl(url("unidade=Matriz"), com({ unidadeId: "u1" })).get("unidade")).toBeNull();
  });
});

describe("Calendário — as setas andam no período da visão", () => {
  it("MÊS: mês a mês, virando o ano", () => {
    expect(passoDoPeriodo("mensal", { ano: 2026, mes: 11, dia: 19 }, 1)).toEqual({ ano: 2026, mes: 12, dia: 1 });
    expect(passoDoPeriodo("mensal", { ano: 2026, mes: 12, dia: 19 }, 1)).toEqual({ ano: 2027, mes: 1, dia: 1 });
    expect(passoDoPeriodo("mensal", { ano: 2026, mes: 1, dia: 19 }, -1)).toEqual({ ano: 2025, mes: 12, dia: 1 });
  });

  it("SEMANA: sete dias, não um mês (era o defeito: não dava para ir à semana seguinte)", () => {
    expect(passoDoPeriodo("semanal", { ano: 2026, mes: 11, dia: 19 }, 1)).toEqual({ ano: 2026, mes: 11, dia: 26 });
    expect(passoDoPeriodo("semanal", { ano: 2026, mes: 11, dia: 19 }, -1)).toEqual({ ano: 2026, mes: 11, dia: 12 });
  });

  it("SEMANA: vira o mês e o ano sozinha", () => {
    expect(passoDoPeriodo("semanal", { ano: 2026, mes: 11, dia: 30 }, 1)).toEqual({ ano: 2026, mes: 12, dia: 7 });
    expect(passoDoPeriodo("semanal", { ano: 2026, mes: 12, dia: 29 }, 1)).toEqual({ ano: 2027, mes: 1, dia: 5 });
    expect(passoDoPeriodo("semanal", { ano: 2027, mes: 1, dia: 3 }, -1)).toEqual({ ano: 2026, mes: 12, dia: 27 });
  });

  it("quatro passos de semana andam 28 dias, e voltar desfaz", () => {
    let p = { ano: 2026, mes: 11, dia: 5 };
    for (let i = 0; i < 4; i++) p = passoDoPeriodo("semanal", p, 1);
    expect(p).toEqual({ ano: 2026, mes: 12, dia: 3 });
    for (let i = 0; i < 4; i++) p = passoDoPeriodo("semanal", p, -1);
    expect(p).toEqual({ ano: 2026, mes: 11, dia: 5 });
  });

  it("a semana seguinte é mesmo a grade dos sete dias seguintes", () => {
    const chaves = (p: { ano: number; mes: number; dia: number }) =>
      gridCalendario({ ...p, view: "semanal" }).dias.map((d) => d.toISOString().slice(0, 10));
    const esta = { ano: 2026, mes: 11, dia: 19 };
    const proxima = passoDoPeriodo("semanal", esta, 1);
    expect(chaves(esta)[0]).toBe("2026-11-15");
    expect(chaves(proxima)[0]).toBe("2026-11-22");
    expect(chaves(proxima)[6]).toBe("2026-11-28");
  });

  it("o cabeçalho diz o período que está na tela", () => {
    const dias = (p: { ano: number; mes: number; dia: number }) => gridCalendario({ ...p, view: "semanal" }).dias;
    expect(rotuloDoPeriodo("mensal", [], 11, 2026)).toBe("Novembro 2026");
    expect(rotuloDoPeriodo("semanal", dias({ ano: 2026, mes: 11, dia: 19 }), 11, 2026)).toBe("15 – 21 de novembro de 2026");
    // a semana que atravessa o mês mostra os dois (o nome do mês sozinho mentiria)
    expect(rotuloDoPeriodo("semanal", dias({ ano: 2026, mes: 12, dia: 1 }), 12, 2026)).toBe("29 de novembro – 5 de dezembro de 2026");
    // e a que atravessa o ano mostra os dois anos
    expect(rotuloDoPeriodo("semanal", dias({ ano: 2026, mes: 12, dia: 31 }), 12, 2026)).toBe("27 de dezembro de 2026 – 2 de janeiro de 2027");
  });
});
