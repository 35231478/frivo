/**
 * PMOC — RENOVAÇÃO anual: as regras puras (lib/pmoc-renovacao).
 *  - a vigência proposta (dia seguinte à expiração, um ano);
 *  - para onde vai o início de cada item do cronograma na nova vigência;
 *  - o que vai (equipamentos ativos, itens) e o que fica (equipamento inativo e o item dele);
 *  - o nome proposto, o pedido e a ligação entre os dois planos no histórico.
 * O cronograma renovado é conferido com as MESMAS regras que geram as OS (lib/pmoc-cronograma).
 */
import { describe, expect, it } from "vitest";
import { execucoesDesejadas, type EstadoCronograma, type ItemCronograma } from "@/lib/pmoc-cronograma";
import {
  acaoRenovacaoGerada, acaoRenovadoDe, avisosDaVigencia, comReferencia, deslocarInicioDoItem, lerReferencia, mesesDeDeslocamento, nomeDaRenovacao, planejarRenovacao,
  renovacaoSchema, resumoDoQueFoi, somarDias, somarMeses, umAnoDepois, vigenciaProposta, PREFIXO_RENOVACAO_GERADA, TEXTO_MOTIVO_FORA,
  type ItemDeOrigem, type OrigemRenovacao,
} from "@/lib/pmoc-renovacao";

const ANTIGA = { dataInicio: "2026-11-12", dataExpiracao: "2027-11-11" };
const NOVA = { dataInicio: "2027-11-12", dataExpiracao: "2028-11-11" };

const item = (id: string, extra: Partial<ItemDeOrigem> = {}): ItemDeOrigem => ({
  id, ativo: true, tipoEquipamentoId: null, equipamentoId: null, tipoOsId: "toLeve", dataInicio: "2026-11-12", intervaloMeses: 1, diaExecucao: 25,
  fimSemana: "POSTERGAR", criadoEm: "2026-11-01T12:00:00.000Z", ...extra,
});
const LEVE = item("iLeve");
const QUIMICA = item("iQuimica", { tipoOsId: "toQuimica", tipoEquipamentoId: "teSplit", intervaloMeses: 6, dataInicio: "2027-04-01", criadoEm: "2026-11-02T12:00:00.000Z" });
const origem = (extra: Partial<OrigemRenovacao> = {}): OrigemRenovacao => ({
  pmoc: ANTIGA, equipamentos: [{ id: "q1", ativo: true }, { id: "q2", ativo: true }], itens: [LEVE, QUIMICA], ...extra,
});

describe("renovação do PMOC: datas", () => {
  it("somar dias e meses de calendário: vira o mês e o ano; dia que não existe vira o último do mês", () => {
    expect(somarDias("2027-11-11", 1)).toBe("2027-11-12");
    expect(somarDias("2027-12-31", 1)).toBe("2028-01-01");
    expect(somarDias("2028-03-01", -1)).toBe("2028-02-29");
    expect(somarMeses("2027-04-01", 12)).toBe("2028-04-01");
    expect(somarMeses("2026-11-12", 2)).toBe("2027-01-12");
    expect(somarMeses("2027-01-31", 1)).toBe("2027-02-28");
    expect(somarMeses("2028-02-29", 12)).toBe("2029-02-28");
    expect(somarMeses("2027-03-15", -4)).toBe("2026-11-15");
    expect(somarMeses("2027-05-20", 0)).toBe("2027-05-20");
  });

  it("vigência proposta: começa no dia SEGUINTE à expiração atual e vale um ano", () => {
    expect(vigenciaProposta("2027-11-11")).toEqual({ dataInicio: "2027-11-12", dataExpiracao: "2028-11-11" });
    expect(vigenciaProposta("2026-12-31")).toEqual({ dataInicio: "2027-01-01", dataExpiracao: "2027-12-31" });
    // ano bissexto: o ano que começa em 01/03/2027 termina em 29/02/2028
    expect(vigenciaProposta("2027-02-28")).toEqual({ dataInicio: "2027-03-01", dataExpiracao: "2028-02-29" });
    expect(umAnoDepois("2026-11-12")).toBe("2027-11-11");
    expect(umAnoDepois("2028-02-29")).toBe("2029-02-28");
  });

  it("o item que começava COM o plano (ou antes) começa com o plano novo", () => {
    expect(deslocarInicioDoItem("2026-11-12", ANTIGA.dataInicio, NOVA.dataInicio)).toBe("2027-11-12");
    expect(deslocarInicioDoItem("2026-06-01", ANTIGA.dataInicio, NOVA.dataInicio)).toBe("2027-11-12");
    // mesmo com a nova vigência começando noutro dia
    expect(deslocarInicioDoItem("2026-11-12", ANTIGA.dataInicio, "2028-01-10")).toBe("2028-01-10");
  });

  it("renovação de um ano: o item que começava no meio do plano fica no MESMO dia e mês do ano seguinte", () => {
    expect(mesesDeDeslocamento(ANTIGA.dataInicio, NOVA.dataInicio)).toBe(12);
    expect(deslocarInicioDoItem("2027-04-01", ANTIGA.dataInicio, NOVA.dataInicio)).toBe("2028-04-01");
    expect(deslocarInicioDoItem("2027-02-15", ANTIGA.dataInicio, NOVA.dataInicio)).toBe("2028-02-15");
    expect(deslocarInicioDoItem("2026-11-13", ANTIGA.dataInicio, NOVA.dataInicio)).toBe("2027-11-13");
    // 29/02 não existe no ano seguinte: vira 28/02
    expect(deslocarInicioDoItem("2028-02-29", "2027-11-12", "2028-11-12")).toBe("2029-02-28");
  });

  it("vigência mudada no diálogo: o item anda os mesmos MESES que o início do plano, e nunca começa antes dele", () => {
    // o plano novo começa 2 meses mais tarde (janeiro/2028): o item de abril vai para junho
    expect(mesesDeDeslocamento("2026-11-12", "2028-01-10")).toBe(14);
    expect(deslocarInicioDoItem("2027-04-01", "2026-11-12", "2028-01-10")).toBe("2028-06-01");
    // só ano e mês contam para o deslocamento (do dia 12 para o dia 30 do mesmo mês = 12 meses)
    expect(mesesDeDeslocamento("2026-11-12", "2027-11-30")).toBe(12);
    // o item que começava 3 dias depois do plano cairia antes do novo início: começa com o plano novo
    expect(deslocarInicioDoItem("2026-11-15", "2026-11-12", "2027-11-30")).toBe("2027-11-30");
    // renovação adiantada (10 meses depois)
    expect(deslocarInicioDoItem("2027-04-01", "2026-11-12", "2027-09-01")).toBe("2028-02-01");
  });

  it("observações da vigência: começa antes do fim da atual; início que já passou", () => {
    expect(avisosDaVigencia(ANTIGA, NOVA, "2027-10-20")).toEqual([]);
    expect(avisosDaVigencia(ANTIGA, { dataInicio: "2027-11-11", dataExpiracao: "2028-11-10" }, "2027-10-20")).toEqual(["A nova vigência começa antes do fim da atual (11/11/2027)."]);
    expect(avisosDaVigencia(ANTIGA, NOVA, "2027-11-12")).toEqual([]);
    expect(avisosDaVigencia(ANTIGA, NOVA, "2027-11-13")).toEqual(["O início já passou: só as manutenções de hoje em diante geram OS."]);
  });
});

describe("renovação do PMOC: o que vai e o que fica", () => {
  it("leva os equipamentos ATIVOS e todos os itens, com intervalo, dia, tipo de OS, fim de semana e a quem se aplica", () => {
    const p = planejarRenovacao(origem(), NOVA);
    expect(p.equipamentoIds).toEqual(["q1", "q2"]);
    expect(p.equipamentosFora).toEqual([]);
    expect(p.itensFora).toEqual([]);
    expect(p.itens).toEqual([
      { origemId: "iLeve", tipoEquipamentoId: null, equipamentoId: null, tipoOsId: "toLeve", dataInicio: "2027-11-12", intervaloMeses: 1, diaExecucao: 25, fimSemana: "POSTERGAR" },
      { origemId: "iQuimica", tipoEquipamentoId: "teSplit", equipamentoId: null, tipoOsId: "toQuimica", dataInicio: "2028-04-01", intervaloMeses: 6, diaExecucao: 25, fimSemana: "POSTERGAR" },
    ]);
  });

  it("equipamento INATIVO fica de fora, e o item que era só dele também; o item por tipo e o de todos continuam", () => {
    const p = planejarRenovacao(origem({
      equipamentos: [{ id: "q1", ativo: true }, { id: "q2", ativo: false }],
      itens: [LEVE, QUIMICA, item("iSoQ2", { equipamentoId: "q2", intervaloMeses: 3, fimSemana: "ADIANTAR" }), item("iSoQ1", { equipamentoId: "q1", intervaloMeses: 12, diaExecucao: 5, fimSemana: "MANTER" })],
    }), NOVA);
    expect(p.equipamentoIds).toEqual(["q1"]);
    expect(p.equipamentosFora).toEqual(["q2"]);
    expect(p.itensFora).toEqual([{ id: "iSoQ2", motivo: "EQUIPAMENTO_INATIVO" }]);
    expect(p.itens.map((i) => i.origemId).sort()).toEqual(["iLeve", "iQuimica", "iSoQ1"]);
    expect(p.itens.find((i) => i.origemId === "iSoQ1")).toMatchObject({ equipamentoId: "q1", intervaloMeses: 12, diaExecucao: 5, fimSemana: "MANTER" });
    expect(TEXTO_MOTIVO_FORA.EQUIPAMENTO_INATIVO).toBe("o equipamento está inativo");
  });

  it("item de um equipamento que nem está mais no plano fica de fora; item EXCLUÍDO (inativo) não é levado nem listado", () => {
    const p = planejarRenovacao(origem({ itens: [LEVE, item("iFantasma", { equipamentoId: "qSaiu" }), item("iExcluido", { ativo: false }), item("iExcluidoQ1", { ativo: false, equipamentoId: "q1" })] }), NOVA);
    expect(p.itens.map((i) => i.origemId)).toEqual(["iLeve"]);
    expect(p.itensFora).toEqual([{ id: "iFantasma", motivo: "EQUIPAMENTO_INATIVO" }]);
  });

  it("vigência encurtada: o item que começaria depois da nova expiração fica de fora, com o motivo", () => {
    const curta = { dataInicio: "2027-11-12", dataExpiracao: "2028-03-31" };
    const p = planejarRenovacao(origem(), curta);
    expect(p.itens.map((i) => i.origemId)).toEqual(["iLeve"]);
    expect(p.itensFora).toEqual([{ id: "iQuimica", motivo: "DEPOIS_DA_EXPIRACAO" }]);
    // no último dia ainda entra
    expect(planejarRenovacao(origem(), { dataInicio: "2027-11-12", dataExpiracao: "2028-04-01" }).itensFora).toEqual([]);
  });

  it("a ORDEM dos itens é a de criação no plano de origem (é o desempate da substituição), não a da lista", () => {
    const a = item("iB", { criadoEm: "2026-11-03T12:00:00.000Z" }), b = item("iA", { criadoEm: "2026-11-01T12:00:00.000Z" });
    const c = item("iD", { criadoEm: "2026-11-02T12:00:00.000Z" }), d = item("iC", { criadoEm: "2026-11-02T12:00:00.000Z" });
    expect(planejarRenovacao(origem({ itens: [a, b, c, d] }), NOVA).itens.map((i) => i.origemId)).toEqual(["iA", "iC", "iD", "iB"]);
  });

  it("não muda o plano de origem (função pura) e, sem itens nem equipamentos, devolve tudo vazio", () => {
    const o = origem(), antes = JSON.stringify(o);
    planejarRenovacao(o, NOVA);
    expect(JSON.stringify(o)).toBe(antes);
    expect(planejarRenovacao({ pmoc: ANTIGA, equipamentos: [], itens: [] }, NOVA)).toEqual({ equipamentoIds: [], equipamentosFora: [], itens: [], itensFora: [] });
  });

  it("o cronograma renovado gera, pelas regras das OS, o MESMO desenho do ano anterior, um ano à frente", () => {
    const estado = (pmoc: typeof ANTIGA, itens: ItemCronograma[]): EstadoCronograma => ({
      pmoc: { status: "PUBLICADO", ativo: true, ...pmoc }, itens,
      equipamentos: [{ id: "q1", ativo: true, unidadeId: "u1", tipoEquipamentoId: "teSplit", tipo: "AR_CONDICIONADO_SPLIT" }],
      tipos: [{ id: "teSplit", chaveEnum: "AR_CONDICIONADO_SPLIT" }], execucoes: [],
    });
    const desenho = (e: EstadoCronograma) => [...execucoesDesejadas(e, new Date("2000-01-01T12:00:00Z")).desejado.values()]
      .map((q) => `${q.periodo}:${q.item.tipoOsId}`).sort();
    const novos: ItemCronograma[] = planejarRenovacao(origem(), NOVA).itens.map((i, n) => ({ id: `n${n}`, ativo: true, ...i, criadoEm: `2027-11-12T15:00:00.00${n}Z` }));
    const antigo = desenho(estado(ANTIGA, [LEVE, QUIMICA])), novo = desenho(estado(NOVA, novos));
    expect(antigo).toHaveLength(12);
    expect(antigo.filter((x) => x.endsWith("toQuimica"))).toEqual(["2027-04:toQuimica", "2027-10:toQuimica"]);
    expect(novo).toEqual(antigo.map((x) => `${Number(x.slice(0, 4)) + 1}${x.slice(4)}`));
  });
});

describe("renovação do PMOC: nome, pedido e histórico", () => {
  it("nome proposto: os anos da vigência antiga que estão no nome viram os da nova", () => {
    expect(nomeDaRenovacao("PMOC 2027 — Hospital Santa Clara", ANTIGA, NOVA)).toBe("PMOC 2028 — Hospital Santa Clara");
    expect(nomeDaRenovacao("PMOC 2026/2027 Hospital", ANTIGA, NOVA)).toBe("PMOC 2027/2028 Hospital");
    expect(nomeDaRenovacao("PMOC 2026", { dataInicio: "2026-01-01", dataExpiracao: "2026-12-31" }, { dataInicio: "2027-01-01", dataExpiracao: "2027-12-31" })).toBe("PMOC 2027");
    // número que não é ano da vigência (nem número maior) não é tocado
    expect(nomeDaRenovacao("PMOC 2027 — Sala 2019 — contrato 20271", ANTIGA, NOVA)).toBe("PMOC 2028 — Sala 2019 — contrato 20271");
  });

  it("nome sem ano ganha o ano da nova vigência no fim, sem passar de 150 caracteres", () => {
    expect(nomeDaRenovacao("PMOC Hospital Santa Clara", ANTIGA, NOVA)).toBe("PMOC Hospital Santa Clara — 2027/2028");
    expect(nomeDaRenovacao("PMOC Hospital", ANTIGA, { dataInicio: "2028-01-01", dataExpiracao: "2028-12-31" })).toBe("PMOC Hospital — 2028");
    const longo = nomeDaRenovacao("P".repeat(150), ANTIGA, NOVA);
    expect(longo).toHaveLength(150);
    expect(longo.endsWith(" — 2027/2028")).toBe(true);
  });

  it("pedido: nome e as duas datas, datas de verdade, expiração depois do início", () => {
    const ok = { nome: "  PMOC 2028 — Hospital  ", ...NOVA };
    expect(renovacaoSchema.parse(ok)).toEqual({ nome: "PMOC 2028 — Hospital", ...NOVA });
    const erro = (d: unknown) => { const r = renovacaoSchema.safeParse(d); return r.success ? null : r.error.issues[0].message; };
    expect(erro({ ...ok, nome: "ab" })).toBe("Informe o nome do novo plano (mín. 3 caracteres).");
    expect(erro({ ...ok, nome: "x".repeat(151) })).toBe("O nome vai até 150 caracteres.");
    expect(erro({ ...ok, dataInicio: "" })).toBe("Informe a data de início.");
    expect(erro({ ...ok, dataInicio: "2027-02-31" })).toBe("Informe a data de início.");
    expect(erro({ ...ok, dataExpiracao: "11/11/2028" })).toBe("Informe a data de expiração.");
    expect(erro({ nome: ok.nome, dataInicio: NOVA.dataInicio })).toBe("Informe a data de expiração.");
    expect(erro({ ...ok, dataInicio: 20271112 })).toBe("Informe a data de início.");
    expect(erro({})).toBe("Informe o nome do novo plano (mín. 3 caracteres).");
    expect(erro({ ...ok, dataExpiracao: NOVA.dataInicio })).toBe("A data de expiração deve ser depois da data de início.");
    expect(erro({ ...ok, dataExpiracao: "2027-01-01" })).toBe("A data de expiração deve ser depois da data de início.");
  });

  it("histórico: os textos das duas pontas e a marca que liga um plano ao outro", () => {
    expect(acaoRenovadoDe("PMOC 2027 — Hospital")).toBe("Renovado a partir de PMOC 2027 — Hospital");
    expect(acaoRenovacaoGerada("PMOC 2028 — Hospital")).toBe("Renovação gerada: PMOC 2028 — Hospital");
    expect(acaoRenovacaoGerada("x").startsWith(PREFIXO_RENOVACAO_GERADA)).toBe(true);
    const d = comReferencia("Nova vigência: 12/11/2027 a 11/11/2028.", "cmabc123");
    expect(lerReferencia(d)).toEqual({ texto: "Nova vigência: 12/11/2027 a 11/11/2028.", pmocId: "cmabc123" });
    expect(lerReferencia("[pmoc:cmabc123]")).toEqual({ texto: null, pmocId: "cmabc123" });
    // linha comum do histórico: nada muda; a marca só vale na ÚLTIMA linha, sozinha
    expect(lerReferencia("art-2027.pdf")).toEqual({ texto: "art-2027.pdf", pmocId: null });
    expect(lerReferencia(null)).toEqual({ texto: null, pmocId: null });
    expect(lerReferencia("arquivo [pmoc:cmabc123]")).toEqual({ texto: "arquivo [pmoc:cmabc123]", pmocId: null });
    expect(lerReferencia("[pmoc:cmabc123]\ncontinua")).toEqual({ texto: "[pmoc:cmabc123]\ncontinua", pmocId: null });
    expect(lerReferencia("texto\n[pmoc:tem espaço]")).toEqual({ texto: "texto\n[pmoc:tem espaço]", pmocId: null });
  });

  it("resumo do que foi levado, com singular e plural, e o que ficou de fora", () => {
    expect(resumoDoQueFoi(planejarRenovacao(origem(), NOVA))).toBe("Levou 2 equipamentos e 2 itens do cronograma. A ART não é levada.");
    const comFora = planejarRenovacao(origem({ equipamentos: [{ id: "q1", ativo: true }, { id: "q2", ativo: false }], itens: [LEVE, item("iSoQ2", { equipamentoId: "q2" })] }), NOVA);
    expect(resumoDoQueFoi(comFora)).toBe("Levou 1 equipamento e 1 item do cronograma. Ficaram de fora: 1 equipamento inativo e 1 item do cronograma. A ART não é levada.");
    const soEquip = planejarRenovacao(origem({ equipamentos: [{ id: "q1", ativo: false }, { id: "q2", ativo: false }], itens: [] }), NOVA);
    expect(resumoDoQueFoi(soEquip)).toBe("Levou 0 equipamentos e 0 itens do cronograma. Ficaram de fora: 2 equipamentos inativos. A ART não é levada.");
  });
});
