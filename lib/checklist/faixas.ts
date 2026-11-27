/**
 * FAIXA ESPERADA das medições do checklist (puro: app, escritório, servidor e testes usam o mesmo).
 *
 *  - Grandeza: o que a medição mede (sucção, descarga, superaquecimento, insuflamento, retorno, ΔT…). Liga a faixa
 *    sugerida e o cálculo do ΔT. Os itens que já existiam ganham a grandeza pelo texto ("Pressão de sucção" → SUCCAO).
 *  - Faixa: mínimo e/ou máximo, na unidade do item. Fora dela o app só ALERTA (não bloqueia, não exige observação).
 *  - Unidades: pressão (psi, bar, kPa, MPa, kgf/cm²) e temperatura (°C, °F; K nas diferenças) se convertem; o resto
 *    só compara na mesma unidade. Sem conversão possível, não há alerta (melhor calar do que alertar errado).
 *  - ΔT: calculado (retorno − insuflamento; água: entrada − saída). O técnico não digita.
 *  - Faixas sugeridas por gás: REFERÊNCIAS típicas (condição nominal, ambiente ~35 °C). A empresa aplica, confere com
 *    o fabricante e ajusta por tipo de equipamento. Corrente não tem faixa padrão (depende da placa).
 */

/* ───────── Grandezas ───────── */

export const GRANDEZAS = [
  "SUCCAO", "DESCARGA", "SUPERAQUECIMENTO", "INSUFLAMENTO", "RETORNO", "DELTA_T",
  "AGUA_ENTRADA", "AGUA_SAIDA", "DELTA_T_AGUA", "CORRENTE_COMPRESSOR", "CORRENTE_VENTILADORES",
] as const;
export type Grandeza = (typeof GRANDEZAS)[number];

interface DefGrandeza {
  nome: string;
  unidade: string;
  /** Diferença de temperatura (K = °C; °F × 1,8, sem o 32) */
  diferenca?: boolean;
  /** Calculada: minuendo − subtraendo (o técnico não digita) */
  calculo?: [Grandeza, Grandeza];
  /** Textos que reconhecem os itens já existentes (comparação sem acento nem maiúsculas) */
  textos: string[];
}

export const GRANDEZA: Record<Grandeza, DefGrandeza> = {
  SUCCAO: { nome: "Pressão de sucção", unidade: "psi", textos: ["pressao de succao", "pressao de baixa"] },
  DESCARGA: { nome: "Pressão de descarga", unidade: "psi", textos: ["pressao de descarga", "pressao de alta"] },
  SUPERAQUECIMENTO: { nome: "Superaquecimento", unidade: "K", diferenca: true, textos: ["superaquecimento"] },
  INSUFLAMENTO: { nome: "Temperatura de insuflamento", unidade: "°C", textos: ["temperatura de insuflamento", "temperatura do insuflamento"] },
  RETORNO: { nome: "Temperatura de retorno", unidade: "°C", textos: ["temperatura de retorno", "temperatura do retorno"] },
  DELTA_T: { nome: "Diferença de temperatura do ar (ΔT)", unidade: "°C", diferenca: true, calculo: ["RETORNO", "INSUFLAMENTO"], textos: ["diferenca de temperatura do ar (δt)", "diferenca de temperatura do ar", "delta t do ar", "δt do ar"] },
  AGUA_ENTRADA: { nome: "Temperatura de entrada da água", unidade: "°C", textos: ["temperatura de entrada da agua"] },
  AGUA_SAIDA: { nome: "Temperatura de saída da água", unidade: "°C", textos: ["temperatura de saida da agua"] },
  DELTA_T_AGUA: { nome: "Diferença de temperatura da água (ΔT)", unidade: "°C", diferenca: true, calculo: ["AGUA_ENTRADA", "AGUA_SAIDA"], textos: ["diferenca de temperatura da agua (δt)", "diferenca de temperatura da agua", "delta t da agua", "δt da agua"] },
  CORRENTE_COMPRESSOR: { nome: "Corrente do compressor", unidade: "A", textos: ["corrente do compressor"] },
  CORRENTE_VENTILADORES: { nome: "Corrente dos ventiladores", unidade: "A", textos: ["corrente dos ventiladores", "corrente do motor do ventilador", "corrente do ventilador"] },
};

export const ehGrandeza = (g: unknown): g is Grandeza => typeof g === "string" && (GRANDEZAS as readonly string[]).includes(g);
/** ΔT e afins: o app calcula, o técnico não digita */
export const ehCalculada = (g: string | null | undefined) => ehGrandeza(g) && !!GRANDEZA[g].calculo;

const normal = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim();

/** A grandeza do item: a gravada; senão, pelo texto (só os textos conhecidos). */
export function grandezaDoItem(item: { grandeza?: string | null; texto: string; tipoResposta?: string }): Grandeza | null {
  if (item.tipoResposta && item.tipoResposta !== "MEDICAO") return null;
  if (ehGrandeza(item.grandeza)) return item.grandeza;
  const t = normal(item.texto);
  return GRANDEZAS.find((g) => GRANDEZA[g].textos.includes(t)) ?? null;
}

/* ───────── Unidades ───────── */

type Familia = "pressao" | "temperatura";
const UNIDADE: Record<string, { familia: Familia; canonica: string }> = {
  psi: { familia: "pressao", canonica: "psi" }, psig: { familia: "pressao", canonica: "psi" },
  bar: { familia: "pressao", canonica: "bar" }, kpa: { familia: "pressao", canonica: "kPa" }, mpa: { familia: "pressao", canonica: "MPa" },
  "kgf/cm²": { familia: "pressao", canonica: "kgf/cm²" }, "kgf/cm2": { familia: "pressao", canonica: "kgf/cm²" },
  "°c": { familia: "temperatura", canonica: "°C" }, "ºc": { familia: "temperatura", canonica: "°C" }, c: { familia: "temperatura", canonica: "°C" },
  "°f": { familia: "temperatura", canonica: "°F" }, "ºf": { familia: "temperatura", canonica: "°F" }, f: { familia: "temperatura", canonica: "°F" },
  k: { familia: "temperatura", canonica: "K" },
};
/** Quanto vale 1 unidade em psi */
const PSI: Record<string, number> = { psi: 1, bar: 14.5037738, kPa: 0.145037738, MPa: 145.037738, "kgf/cm²": 14.2233433 };

const ler = (u: string | null | undefined) => (u ? UNIDADE[u.trim().toLocaleLowerCase("pt-BR").replace(/\s+/g, "")] : undefined);

/**
 * Converte `valor` de uma unidade para outra. `diferenca`: diferença de temperatura (K ≡ °C; °F = °C × 1,8).
 * Mesma unidade (escrita igual): devolve o valor. Não dá para converter: null.
 */
export function converter(valor: number, de: string | null | undefined, para: string | null | undefined, diferenca = false): number | null {
  if ((de ?? "").trim() === (para ?? "").trim()) return valor;
  const a = ler(de), b = ler(para);
  if (!a || !b || a.familia !== b.familia) return null;
  if (a.canonica === b.canonica) return valor;
  if (a.familia === "pressao") return (valor * PSI[a.canonica]) / PSI[b.canonica];
  // temperatura
  if (diferenca) {
    const emC = a.canonica === "°F" ? valor / 1.8 : valor; // K e °C: o mesmo passo
    return b.canonica === "°F" ? emC * 1.8 : emC;
  }
  if (a.canonica === "K" || b.canonica === "K") return null; // K absoluto não é usado em campo
  return a.canonica === "°C" ? valor * 1.8 + 32 : (valor - 32) / 1.8;
}

const arred = (n: number) => Math.round(n * 1000) / 1000;

/* ───────── Faixa ───────── */

export interface Faixa { min: number | null; max: number | null }

/** A faixa do item levada para a unidade da resposta (null = não há faixa ou não converte). */
export function faixaNaUnidade(item: { valorMin: number | null; valorMax: number | null; unidade: string | null; grandeza?: string | null; texto?: string },
  unidade: string | null | undefined): Faixa | null {
  if (item.valorMin === null && item.valorMax === null) return null;
  const g = ehGrandeza(item.grandeza) ? item.grandeza : null;
  const dif = !!(g && GRANDEZA[g].diferenca);
  const u = unidade ?? item.unidade;
  const conv = (v: number | null) => (v === null ? null : converter(v, item.unidade, u, dif));
  const min = conv(item.valorMin), max = conv(item.valorMax);
  if ((item.valorMin !== null && min === null) || (item.valorMax !== null && max === null)) return null;
  return { min: min === null ? null : arred(min), max: max === null ? null : arred(max) };
}

export type SituacaoFaixa = "dentro" | "abaixo" | "acima";
/** O valor medido contra a faixa (já na mesma unidade). Sem faixa: null. */
export function avaliarFaixa(valor: number | null | undefined, faixa: Faixa | null): SituacaoFaixa | null {
  if (valor === null || valor === undefined || !Number.isFinite(valor) || !faixa) return null;
  if (faixa.min !== null && valor < faixa.min) return "abaixo";
  if (faixa.max !== null && valor > faixa.max) return "acima";
  return "dentro";
}
export const foraDaFaixa = (valor: number | null | undefined, faixa: Faixa | null) => {
  const s = avaliarFaixa(valor, faixa);
  return s === "abaixo" || s === "acima";
};

const num = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
/** "115–140 psi", "≥ 5 K", "≤ 16 °C" */
export function textoFaixa(f: Faixa | null, unidade: string | null | undefined): string | null {
  if (!f || (f.min === null && f.max === null)) return null;
  const u = unidade ? ` ${unidade}` : "";
  if (f.min !== null && f.max !== null) return `${num(f.min)}–${num(f.max)}${u}`;
  return f.min !== null ? `≥ ${num(f.min)}${u}` : `≤ ${num(f.max!)}${u}`;
}
/** O aviso do app: "Abaixo do esperado (115–140 psi)" */
export function avisoFaixa(s: SituacaoFaixa | null, f: Faixa | null, unidade: string | null | undefined): string | null {
  if (s !== "abaixo" && s !== "acima") return null;
  return `${s === "abaixo" ? "Abaixo" : "Acima"} do esperado (${textoFaixa(f, unidade)})`;
}

/** Painel do gestor: medições fora da faixa dos últimos N dias */
export const DIAS_FORA_DA_FAIXA = 30;

/* ───────── ΔT (calculado) ───────── */

export interface LeituraGrandeza { valor: number | null; unidade: string | null; naoSeAplica: boolean }
export type Calculo = { valor: number; unidade: string } | { naoSeAplica: true } | null;

/**
 * O valor de uma grandeza calculada a partir das leituras do MESMO equipamento. As duas em °C/°F/K se convertem
 * (o resultado sai na unidade do item). Uma das duas "Não se aplica": o ΔT também não se aplica. Falta leitura: null.
 */
export function calcularGrandeza(g: Grandeza, leituras: Partial<Record<Grandeza, LeituraGrandeza>>, unidadeItem: string | null): Calculo {
  const c = GRANDEZA[g].calculo;
  if (!c) return null;
  const [a, b] = [leituras[c[0]], leituras[c[1]]];
  if (a?.naoSeAplica || b?.naoSeAplica) return { naoSeAplica: true };
  if (!a || !b || a.valor === null || b.valor === null) return null;
  const u = unidadeItem ?? GRANDEZA[g].unidade;
  // As duas leituras são temperaturas absolutas: leva a 2ª para a unidade da 1ª, subtrai e converte a diferença
  const bNaA = converter(b.valor, b.unidade, a.unidade, false);
  if (bNaA === null) return null;
  const dif = converter(a.valor - bNaA, a.unidade, u, true);
  return dif === null ? null : { valor: arred(dif), unidade: u };
}

/* ───────── Faixas sugeridas por gás ───────── */

export const GASES = ["R410A", "R32", "R22"] as const;
export type Gas = (typeof GASES)[number];
export const NOME_GAS: Record<Gas, string> = { R410A: "R-410A", R32: "R-32", R22: "R-22" };

interface Sugestao { unidade: string; geral?: [number, number]; porGas?: Record<Gas, [number, number]> }
/** Referências típicas em condição nominal (ar-condicionado de expansão direta, ambiente ~35 °C). */
export const FAIXAS_SUGERIDAS: Partial<Record<Grandeza, Sugestao>> = {
  SUCCAO: { unidade: "psi", porGas: { R410A: [115, 140], R32: [120, 150], R22: [58, 75] } },
  DESCARGA: { unidade: "psi", porGas: { R410A: [300, 420], R32: [330, 450], R22: [200, 280] } },
  SUPERAQUECIMENTO: { unidade: "K", geral: [5, 12] },
  INSUFLAMENTO: { unidade: "°C", geral: [10, 16] },
  DELTA_T: { unidade: "°C", geral: [8, 14] },
  AGUA_SAIDA: { unidade: "°C", geral: [5, 9] },
  DELTA_T_AGUA: { unidade: "°C", geral: [4, 7] },
};

/** A faixa sugerida de uma grandeza para o gás, já na unidade pedida. Sem sugestão ou sem conversão: null. */
export function faixaSugerida(g: Grandeza, gas: Gas, unidade: string | null): Faixa | null {
  const s = FAIXAS_SUGERIDAS[g];
  const par = s?.porGas?.[gas] ?? s?.geral;
  if (!s || !par) return null;
  const dif = !!GRANDEZA[g].diferenca;
  const [min, max] = [converter(par[0], s.unidade, unidade ?? s.unidade, dif), converter(par[1], s.unidade, unidade ?? s.unidade, dif)];
  return min === null || max === null ? null : { min: arred(min), max: arred(max) };
}

/* ───────── "Aplicar faixas sugeridas" (tela do tipo de equipamento) ───────── */

export interface ItemParaFaixa {
  texto: string; tipoResposta: string; unidade: string | null; grandeza?: string | null; valorMin: number | null; valorMax: number | null;
}
export interface MudancaFaixa { texto: string; antes: string | null; depois: string | null; novo?: boolean }

/**
 * Aplica as faixas sugeridas do gás nos itens de medição que a gente reconhece (e grava a grandeza deles) e
 * ACRESCENTA o que falta: superaquecimento (onde há sucção e descarga) e ΔT (onde há insuflamento e retorno; na água,
 * entrada e saída). Devolve a lista nova e o resumo do que mudou (a tela mostra antes de salvar).
 * `novoItem` monta o item acrescentado no formato da tela.
 */
export function aplicarFaixasSugeridas<T extends ItemParaFaixa>(itens: T[], gas: Gas, novoItem: (base: ItemParaFaixa) => T): { itens: T[]; mudancas: MudancaFaixa[] } {
  const mudancas: MudancaFaixa[] = [];
  const comFaixa = (it: T): T => {
    const g = grandezaDoItem(it);
    if (!g) return it;
    const f = faixaSugerida(g, gas, it.unidade);
    const antes = textoFaixa({ min: it.valorMin, max: it.valorMax }, it.unidade);
    if (!f) return it.grandeza === g ? it : { ...it, grandeza: g };
    const depois = textoFaixa(f, it.unidade);
    if (antes !== depois) mudancas.push({ texto: it.texto, antes, depois });
    return { ...it, grandeza: g, valorMin: f.min, valorMax: f.max };
  };
  const lista = itens.map(comFaixa);
  const tem = (g: Grandeza) => lista.some((i) => grandezaDoItem(i) === g);
  const posDe = (g: Grandeza) => lista.findIndex((i) => grandezaDoItem(i) === g);
  const acrescentar = (g: Grandeza, depoisDe: Grandeza) => {
    const unidade = GRANDEZA[g].unidade;
    const f = faixaSugerida(g, gas, unidade);
    const base: ItemParaFaixa = { texto: GRANDEZA[g].nome, tipoResposta: "MEDICAO", unidade, grandeza: g, valorMin: f?.min ?? null, valorMax: f?.max ?? null };
    lista.splice(posDe(depoisDe) + 1, 0, novoItem(base));
    mudancas.push({ texto: base.texto, antes: null, depois: textoFaixa(f, unidade), novo: true });
  };
  if (tem("SUCCAO") && tem("DESCARGA") && !tem("SUPERAQUECIMENTO")) acrescentar("SUPERAQUECIMENTO", "DESCARGA");
  if (tem("INSUFLAMENTO") && tem("RETORNO") && !tem("DELTA_T")) acrescentar("DELTA_T", posDe("RETORNO") > posDe("INSUFLAMENTO") ? "RETORNO" : "INSUFLAMENTO");
  if (tem("AGUA_ENTRADA") && tem("AGUA_SAIDA") && !tem("DELTA_T_AGUA")) acrescentar("DELTA_T_AGUA", posDe("AGUA_SAIDA") > posDe("AGUA_ENTRADA") ? "AGUA_SAIDA" : "AGUA_ENTRADA");
  return { itens: lista, mudancas };
}
