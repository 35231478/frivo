/**
 * App de campo, leva 3 (PR A) — FAIXA ESPERADA nas medições, REGRAS PURAS:
 *  - a grandeza (gravada ou pelo texto), a conversão de unidades (pressão, temperatura, diferença), a faixa na unidade
 *    da resposta, a avaliação (abaixo/dentro/acima) e os textos do alerta;
 *  - o ΔT calculado (retorno − insuflamento; água: entrada − saída), com "Não se aplica" e unidades diferentes;
 *  - as faixas sugeridas por gás e o "Aplicar faixas sugeridas" (grava a grandeza, acrescenta superaquecimento e ΔT);
 *  - o que a tela do tipo manda (faixa válida) e o plano de gravação; o ΔT não entra nas pendências; o aparelho refaz
 *    o ΔT sozinho.
 */
import { describe, expect, it } from "vitest";
import {
  aplicarFaixasSugeridas, avaliarFaixa, avisoFaixa, calcularGrandeza, converter, DIAS_FORA_DA_FAIXA, ehCalculada, FAIXAS_SUGERIDAS, faixaNaUnidade,
  faixaSugerida, foraDaFaixa, GASES, GRANDEZA, grandezaDoItem, NOME_GAS, textoFaixa, type ItemParaFaixa,
} from "@/lib/checklist/faixas";
import { checklistSchema, planejarChecklist } from "@/lib/checklist/tipo";
import { faltasEquipamento, type EquipamentoParaPendencia } from "@/lib/execucao/pendencias";
import { comCalculadas, estadoDaAtividade } from "@/lib/tecnico/offline/estado";
import type { ItemTela, OperacaoFila, RespostaTela, RetratoAtividade } from "@/lib/tecnico/offline/tipos";

describe("grandeza do item", () => {
  it("a gravada vale; senão, o texto conhecido (sem acento, maiúscula ou espaço a mais); OK/Atenção nunca tem grandeza", () => {
    expect(grandezaDoItem({ texto: "Qualquer", tipoResposta: "MEDICAO", grandeza: "DESCARGA" })).toBe("DESCARGA");
    expect(grandezaDoItem({ texto: "  PRESSAO  de   Succão ", tipoResposta: "MEDICAO" })).toBe("SUCCAO");
    expect(grandezaDoItem({ texto: "Temperatura de retorno", tipoResposta: "MEDICAO" })).toBe("RETORNO");
    expect(grandezaDoItem({ texto: "Corrente do motor do ventilador", tipoResposta: "MEDICAO" })).toBe("CORRENTE_VENTILADORES");
    expect(grandezaDoItem({ texto: "Diferença de temperatura do ar (ΔT)", tipoResposta: "MEDICAO" })).toBe("DELTA_T");
    expect(grandezaDoItem({ texto: "Pressão de sucção", tipoResposta: "OK_ATENCAO_NA" })).toBeNull();
    expect(grandezaDoItem({ texto: "Vibração do mancal", tipoResposta: "MEDICAO", grandeza: "INVENTADA" })).toBeNull();
  });
  it("calculadas: só o ΔT do ar e o da água", () => {
    expect(Object.keys(GRANDEZA).filter((g) => ehCalculada(g))).toEqual(["DELTA_T", "DELTA_T_AGUA"]);
    expect(GRANDEZA.DELTA_T.calculo).toEqual(["RETORNO", "INSUFLAMENTO"]);
    expect(GRANDEZA.DELTA_T_AGUA.calculo).toEqual(["AGUA_ENTRADA", "AGUA_SAIDA"]);
    expect(ehCalculada(null)).toBe(false);
  });
});

describe("unidades", () => {
  it("pressão: psi, bar, kPa, MPa e kgf/cm² se convertem (maiúsculas e espaços não importam)", () => {
    expect(converter(14.5037738, "psi", "bar")).toBeCloseTo(1, 6);
    expect(converter(1, "BAR", "kPa")).toBeCloseTo(100, 3);
    expect(converter(1, "kgf/cm2", "psi")).toBeCloseTo(14.2233, 3);
    expect(converter(1, "MPa", "psig")).toBeCloseTo(145.0377, 3);
  });
  it("temperatura absoluta: °C ↔ °F; K absoluto não; diferença: K ≡ °C e °F × 1,8 (sem o 32)", () => {
    expect(converter(25, "°C", "°F")).toBeCloseTo(77, 6);
    expect(converter(77, "ºF", "C")).toBeCloseTo(25, 6);
    expect(converter(25, "°C", "K")).toBeNull();
    expect(converter(10, "K", "°C", true)).toBe(10);
    expect(converter(10, "°C", "°F", true)).toBeCloseTo(18, 6);
    expect(converter(18, "°F", "K", true)).toBeCloseTo(10, 6);
  });
  it("famílias diferentes ou desconhecidas: não converte; a mesma unidade escrita igual sempre vale", () => {
    expect(converter(10, "psi", "°C")).toBeNull();
    expect(converter(10, "A", "V")).toBeNull();
    expect(converter(10, "A", "A")).toBe(10);
    expect(converter(10, null, null)).toBe(10);
  });
});

describe("faixa e alerta", () => {
  const item = { valorMin: 115, valorMax: 140, unidade: "psi", grandeza: "SUCCAO" };
  it("a faixa vai para a unidade da resposta; sem faixa ou sem conversão: null", () => {
    expect(faixaNaUnidade(item, "psi")).toEqual({ min: 115, max: 140 });
    expect(faixaNaUnidade(item, "bar")).toEqual({ min: 7.929, max: 9.653 });
    expect(faixaNaUnidade(item, null)).toEqual({ min: 115, max: 140 });
    expect(faixaNaUnidade(item, "°C")).toBeNull();
    expect(faixaNaUnidade({ ...item, valorMin: null, valorMax: null }, "psi")).toBeNull();
    expect(faixaNaUnidade({ valorMin: 5, valorMax: null, unidade: "K", grandeza: "SUPERAQUECIMENTO" }, "°F")).toEqual({ min: 9, max: null });
  });
  it("abaixo, dentro (os limites contam) e acima; só mínimo ou só máximo; sem valor ou sem faixa: nada", () => {
    const f = { min: 115, max: 140 };
    expect([avaliarFaixa(114.9, f), avaliarFaixa(115, f), avaliarFaixa(140, f), avaliarFaixa(140.01, f)]).toEqual(["abaixo", "dentro", "dentro", "acima"]);
    expect(avaliarFaixa(3, { min: 5, max: null })).toBe("abaixo");
    expect(avaliarFaixa(1000, { min: 5, max: null })).toBe("dentro");
    expect(avaliarFaixa(17, { min: null, max: 16 })).toBe("acima");
    expect(avaliarFaixa(null, f)).toBeNull();
    expect(avaliarFaixa(Number.NaN, f)).toBeNull();
    expect(avaliarFaixa(1, null)).toBeNull();
    expect([foraDaFaixa(100, f), foraDaFaixa(120, f), foraDaFaixa(120, null)]).toEqual([true, false, false]);
  });
  it("os textos: faixa completa, só mínimo, só máximo; o alerta diz abaixo ou acima", () => {
    expect(textoFaixa({ min: 115, max: 140 }, "psi")).toBe("115–140 psi");
    expect(textoFaixa({ min: 7.929, max: 9.653 }, "bar")).toBe("7,93–9,65 bar");
    expect(textoFaixa({ min: 5, max: null }, "K")).toBe("≥ 5 K");
    expect(textoFaixa({ min: null, max: 16 }, "°C")).toBe("≤ 16 °C");
    expect(textoFaixa({ min: null, max: null }, "°C")).toBeNull();
    expect(avisoFaixa("abaixo", { min: 115, max: 140 }, "psi")).toBe("Abaixo do esperado (115–140 psi)");
    expect(avisoFaixa("acima", { min: 115, max: 140 }, "psi")).toBe("Acima do esperado (115–140 psi)");
    expect(avisoFaixa("dentro", { min: 115, max: 140 }, "psi")).toBeNull();
    expect(DIAS_FORA_DA_FAIXA).toBe(30);
  });
});

describe("ΔT calculado", () => {
  const l = (valor: number | null, unidade = "°C", naoSeAplica = false) => ({ valor, unidade, naoSeAplica });
  it("ar: retorno − insuflamento; água: entrada − saída", () => {
    expect(calcularGrandeza("DELTA_T", { RETORNO: l(24), INSUFLAMENTO: l(12.5) }, "°C")).toEqual({ valor: 11.5, unidade: "°C" });
    expect(calcularGrandeza("DELTA_T_AGUA", { AGUA_ENTRADA: l(12), AGUA_SAIDA: l(7) }, "°C")).toEqual({ valor: 5, unidade: "°C" });
  });
  it("unidades diferentes: converte; resultado na unidade do item (°F de diferença = × 1,8)", () => {
    expect(calcularGrandeza("DELTA_T", { RETORNO: l(75.2, "°F"), INSUFLAMENTO: l(12.5) }, "°C")).toEqual({ valor: 11.5, unidade: "°C" });
    expect(calcularGrandeza("DELTA_T", { RETORNO: l(24), INSUFLAMENTO: l(12.5) }, "°F")).toEqual({ valor: 20.7, unidade: "°F" });
    expect(calcularGrandeza("DELTA_T", { RETORNO: l(24), INSUFLAMENTO: l(12.5, "psi") }, "°C")).toBeNull();
  });
  it("uma leitura 'Não se aplica': o ΔT também; falta leitura: nada; grandeza comum: nada", () => {
    expect(calcularGrandeza("DELTA_T", { RETORNO: l(null, "°C", true), INSUFLAMENTO: l(12) }, "°C")).toEqual({ naoSeAplica: true });
    expect(calcularGrandeza("DELTA_T", { RETORNO: l(24) }, "°C")).toBeNull();
    expect(calcularGrandeza("DELTA_T", { RETORNO: l(24), INSUFLAMENTO: l(null) }, "°C")).toBeNull();
    expect(calcularGrandeza("SUCCAO", { SUCCAO: l(120, "psi") }, "psi")).toBeNull();
  });
});

describe("faixas sugeridas por gás", () => {
  it("os três gases; sucção e descarga por gás; o resto vale para todos; corrente sem faixa", () => {
    expect(GASES).toEqual(["R410A", "R32", "R22"]);
    expect(NOME_GAS).toEqual({ R410A: "R-410A", R32: "R-32", R22: "R-22" });
    expect(GASES.map((g) => faixaSugerida("SUCCAO", g, "psi"))).toEqual([{ min: 115, max: 140 }, { min: 120, max: 150 }, { min: 58, max: 75 }]);
    expect(GASES.map((g) => faixaSugerida("DESCARGA", g, "psi"))).toEqual([{ min: 300, max: 420 }, { min: 330, max: 450 }, { min: 200, max: 280 }]);
    expect(GASES.map((g) => faixaSugerida("SUPERAQUECIMENTO", g, "K"))).toEqual(Array(3).fill({ min: 5, max: 12 }));
    expect(faixaSugerida("INSUFLAMENTO", "R22", "°C")).toEqual({ min: 10, max: 16 });
    expect(faixaSugerida("DELTA_T", "R32", "°C")).toEqual({ min: 8, max: 14 });
    expect(faixaSugerida("DELTA_T_AGUA", "R410A", "°C")).toEqual({ min: 4, max: 7 });
    expect(faixaSugerida("AGUA_SAIDA", "R410A", "°C")).toEqual({ min: 5, max: 9 });
    expect(faixaSugerida("CORRENTE_COMPRESSOR", "R410A", "A")).toBeNull();
    expect(faixaSugerida("RETORNO", "R410A", "°C")).toBeNull();
    expect(Object.keys(FAIXAS_SUGERIDAS)).not.toContain("CORRENTE_COMPRESSOR");
  });
  it("vai para a unidade do item (bar, °F); unidade que não converte: nenhuma sugestão", () => {
    expect(faixaSugerida("SUCCAO", "R410A", "bar")).toEqual({ min: 7.929, max: 9.653 });
    expect(faixaSugerida("INSUFLAMENTO", "R410A", "°F")).toEqual({ min: 50, max: 60.8 });
    expect(faixaSugerida("SUCCAO", "R410A", "A")).toBeNull();
  });
});

describe("'Aplicar faixas sugeridas' na tela do tipo", () => {
  const med = (texto: string, unidade: string, extra: Partial<ItemParaFaixa> = {}): ItemParaFaixa =>
    ({ texto, tipoResposta: "MEDICAO", unidade, valorMin: null, valorMax: null, ...extra });
  const ok = (texto: string): ItemParaFaixa => ({ texto, tipoResposta: "OK_ATENCAO_NA", unidade: null, valorMin: null, valorMax: null });
  const split = [ok("Limpeza dos filtros de ar"), med("Pressão de sucção", "psi"), med("Pressão de descarga", "psi"), med("Corrente do compressor", "A"),
    med("Temperatura de insuflamento", "°C"), med("Temperatura de retorno", "°C"), ok("Teste de funcionamento")];
  const novo = (b: ItemParaFaixa) => ({ ...b, novo: true });
  it("split com R-410A: grava a grandeza, põe as faixas, acrescenta superaquecimento (depois da descarga) e ΔT (depois do retorno)", () => {
    const r = aplicarFaixasSugeridas(split, "R410A", novo);
    expect(r.itens.map((i) => `${i.texto}|${i.grandeza ?? "-"}|${i.valorMin ?? "-"}|${i.valorMax ?? "-"}`)).toEqual([
      "Limpeza dos filtros de ar|-|-|-", "Pressão de sucção|SUCCAO|115|140", "Pressão de descarga|DESCARGA|300|420", "Superaquecimento|SUPERAQUECIMENTO|5|12",
      "Corrente do compressor|CORRENTE_COMPRESSOR|-|-", "Temperatura de insuflamento|INSUFLAMENTO|10|16", "Temperatura de retorno|RETORNO|-|-",
      "Diferença de temperatura do ar (ΔT)|DELTA_T|8|14", "Teste de funcionamento|-|-|-",
    ]);
    expect(r.itens.filter((i) => (i as { novo?: boolean }).novo).map((i) => [i.unidade, i.tipoResposta])).toEqual([["K", "MEDICAO"], ["°C", "MEDICAO"]]);
    expect(r.mudancas).toEqual([
      { texto: "Pressão de sucção", antes: null, depois: "115–140 psi" }, { texto: "Pressão de descarga", antes: null, depois: "300–420 psi" },
      { texto: "Temperatura de insuflamento", antes: null, depois: "10–16 °C" },
      { texto: "Superaquecimento", antes: null, depois: "5–12 K", novo: true }, { texto: "Diferença de temperatura do ar (ΔT)", antes: null, depois: "8–14 °C", novo: true },
    ]);
  });
  it("trocar o gás troca a faixa (e diz o que era); aplicar de novo não acrescenta nada nem lista o que não mudou", () => {
    const r410 = aplicarFaixasSugeridas(split, "R410A", novo).itens;
    const r22 = aplicarFaixasSugeridas(r410, "R22", novo);
    expect(r22.itens).toHaveLength(r410.length);
    expect(r22.mudancas).toEqual([{ texto: "Pressão de sucção", antes: "115–140 psi", depois: "58–75 psi" }, { texto: "Pressão de descarga", antes: "300–420 psi", depois: "200–280 psi" }]);
    expect(aplicarFaixasSugeridas(r22.itens, "R22", novo).mudancas).toEqual([]);
  });
  it("na unidade do item (bar); sem sucção/descarga não cria superaquecimento; insuflamento depois do retorno: ΔT depois do insuflamento", () => {
    const r = aplicarFaixasSugeridas([med("Pressão de sucção", "bar"), med("Temperatura de retorno", "°C"), med("Temperatura de insuflamento", "°C")], "R410A", novo);
    expect(r.itens.map((i) => i.texto)).toEqual(["Pressão de sucção", "Temperatura de retorno", "Temperatura de insuflamento", "Diferença de temperatura do ar (ΔT)"]);
    expect([r.itens[0].valorMin, r.itens[0].valorMax]).toEqual([7.929, 9.653]);
  });
  it("chiller: ΔT da água depois da saída; item desconhecido fica como está", () => {
    const r = aplicarFaixasSugeridas([med("Temperatura de entrada da água", "°C"), med("Temperatura de saída da água", "°C"), med("Vibração", "mm/s")], "R410A", novo);
    expect(r.itens.map((i) => `${i.texto}|${i.valorMin ?? "-"}`)).toEqual(["Temperatura de entrada da água|-", "Temperatura de saída da água|5", "Diferença de temperatura da água (ΔT)|4", "Vibração|-"]);
  });
});

describe("a tela do tipo: o que vai e o que muda", () => {
  const base = { texto: "Pressão de sucção", tipoResposta: "MEDICAO", unidade: "psi" };
  const erro = (it: Record<string, unknown>) => { const r = checklistSchema.safeParse({ itens: [it] }); return r.success ? null : r.error.issues[0].message; };
  it("faixa: números; mínimo não passa do máximo; grandeza só da lista", () => {
    expect(erro({ ...base, valorMin: 115, valorMax: 140, grandeza: "SUCCAO" })).toBeNull();
    expect(erro({ ...base, valorMin: 140, valorMax: 140 })).toBeNull();
    expect(erro({ ...base, valorMin: 141, valorMax: 140 })).toBe("Faixa: o mínimo não pode passar do máximo.");
    expect(erro({ ...base, valorMin: 5, valorMax: null })).toBeNull();
    expect(erro({ ...base, valorMax: 2_000_000 })).toBe("Faixa: número grande demais.");
    expect(erro({ ...base, grandeza: "INVENTADA" })).not.toBeNull();
  });
  it("o plano grava grandeza e faixa; mudar só a faixa atualiza; item OK/Atenção nunca leva faixa", () => {
    const atual = { id: "i1", texto: "Pressão de sucção", pedirFoto: false, pedirObservacao: false, ordem: 1, tipoResposta: "MEDICAO" as const, unidade: "psi", grandeza: "SUCCAO", valorMin: 115, valorMax: 140 };
    const entrada = (x: Record<string, unknown>) => checklistSchema.parse({ itens: [{ id: "i1", ...base, grandeza: "SUCCAO", valorMin: 115, valorMax: 140, ...x }] }).itens;
    const p = (x: Record<string, unknown>) => { const r = planejarChecklist([atual], entrada(x)); if (!r.ok) throw new Error(r.erro); return r.plano; };
    expect(p({}).atualizar).toEqual([]);
    expect(p({ valorMin: 120 }).atualizar).toMatchObject([{ id: "i1", valorMin: 120, valorMax: 140, grandeza: "SUCCAO" }]);
    expect(p({ valorMax: null }).atualizar).toMatchObject([{ id: "i1", valorMax: null }]);
    expect(p({ grandeza: null }).atualizar).toMatchObject([{ id: "i1", grandeza: null }]);
    const r = planejarChecklist([], checklistSchema.parse({ itens: [{ texto: "Filtro", tipoResposta: "OK_ATENCAO_NA", valorMin: 1, valorMax: 2, grandeza: "SUCCAO" }] }).itens);
    expect(r.ok && r.plano.criar[0]).toEqual({ texto: "Filtro", pedirFoto: false, pedirObservacao: false, ordem: 1, tipoResposta: "OK_ATENCAO_NA", unidade: null });
  });
});

describe("pendências e o aparelho", () => {
  const itens = [
    { id: "r", texto: "Temperatura de retorno", tipoResposta: "MEDICAO" as const, unidade: "°C", pedirFoto: false, pedirObservacao: false, ativo: true, ordem: 1 },
    { id: "i", texto: "Temperatura de insuflamento", tipoResposta: "MEDICAO" as const, unidade: "°C", pedirFoto: false, pedirObservacao: false, ativo: true, ordem: 2 },
    { id: "d", texto: "Diferença de temperatura do ar (ΔT)", tipoResposta: "MEDICAO" as const, unidade: "°C", grandeza: "DELTA_T", valorMin: 8, valorMax: 14, pedirFoto: false, pedirObservacao: false, ativo: true, ordem: 3 },
  ] as ItemTela[];
  const R = (x: Partial<RespostaTela>): RespostaTela => ({ status: null, observacao: null, valor: null, unidade: "°C", audio: false, audioId: null, ...x });
  it("o ΔT nunca é cobrado: falta a leitura, não o cálculo", () => {
    const e: EquipamentoParaPendencia = { equipamentoId: "e", titulo: "Split", feito: true, itens, respostas: {}, fotosPorItem: {}, formulario: null };
    expect(faltasEquipamento(e).semResposta).toEqual(["Temperatura de retorno", "Temperatura de insuflamento"]);
  });
  it("o aparelho refaz o ΔT: com as duas leituras, com 'Não se aplica', e apaga quando some uma leitura", () => {
    expect(comCalculadas(itens, { r: R({ valor: 24 }), i: R({ valor: 12.5 }) }).d).toMatchObject({ valor: 11.5, unidade: "°C", status: null });
    expect(comCalculadas(itens, { r: R({ status: "NAO_SE_APLICA" }), i: R({ valor: 12.5 }) }).d).toMatchObject({ valor: null, status: "NAO_SE_APLICA" });
    expect(comCalculadas(itens, { r: R({ valor: 24 }), i: R({ valor: null }), d: R({ valor: 11.5, observacao: "ok" }) }).d).toMatchObject({ valor: null, status: null, observacao: "ok" });
    expect(comCalculadas(itens, { r: R({ valor: 24 }) })).not.toHaveProperty("d");
    const semCalc = itens.slice(0, 2);
    const resp = { r: R({ valor: 24 }) };
    expect(comCalculadas(semCalc, resp)).toBe(resp);
  });
  it("na fila: a leitura sem sinal já muda o ΔT na tela; digitar no ΔT é ignorado (o servidor recusa)", () => {
    const retrato = {
      cartao: {}, execucao: {
        atividade: { id: "a1", titulo: "x", status: "EM_ANDAMENTO", tipoOs: null }, os: { id: "os1", numero: "OS-1", status: "ABERTA", clienteId: "c", unidadeId: null },
        bloqueada: false, adicionais: [], conclusao: { ok: false, semEquipamento: false, pendencias: [], atendidos: 0, naoAtendidos: 0, mensagem: null },
        equipamentos: [{ vinculoId: "v", feito: false, observacao: null, equipamento: { id: "e1", titulo: "Split" }, itens, respostas: {}, fotos: [], formulario: null, faltas: { semResposta: [], semFoto: [], semObservacao: [], formulario: null }, completo: false }],
      }, equipamentosUnidade: [], checklistsPorTipo: {}, geradoEm: "",
    } as unknown as RetratoAtividade;
    const op = (itemId: string, dados: Record<string, unknown>, seq: number) => ({ seq, id: `o${seq}`, tipo: "resposta", atividadeId: "a1", equipamentoId: "e1", itemId, dados, em: "x", criadoEm: "x", estado: "pendente", tentativas: 0 }) as unknown as OperacaoFila;
    const eq = (ops: OperacaoFila[]) => estadoDaAtividade(retrato, ops).equipamentos[0];
    expect(eq([op("r", { valor: 24 }, 1), op("i", { valor: 12.5 }, 2)]).respostas.d).toMatchObject({ valor: 11.5 });
    expect(eq([op("r", { valor: 24 }, 1), op("i", { valor: 12.5 }, 2), op("d", { valor: 99 }, 3)]).respostas.d).toMatchObject({ valor: 11.5 });
    // Só o ΔT "digitado" (sem leituras): nada muda, nem o equipamento conta como atendido
    const so = eq([op("d", { valor: 99 }, 1), op("d", { status: "NAO_SE_APLICA" }, 2)]);
    expect([so.feito, so.respostas.d]).toEqual([false, undefined]);
  });
});
