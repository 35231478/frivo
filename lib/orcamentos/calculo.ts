/**
 * Orçamento — o CÁLCULO, puro e único (tela, servidor, documento e testes usam este mesmo):
 *  - item: o total manda. Editar o unitário recalcula o total (unitário × qtd); editar o total
 *    recalcula o unitário (total ÷ qtd, em centavos). O total digitado é guardado como veio — o
 *    unitário exibido é o arredondado (ex.: R$ 100,00 em 3 un. = 33,33 cada, total 100,00).
 *  - grupo: subtotal → desconto do grupo (R$ ou %, nunca maior que o subtotal) → total do grupo;
 *  - ISS: sobre os SERVIÇOS já com o desconto deles, somado ao total;
 *  - documento do CLIENTE: o ISS vem EMBUTIDO nos preços dos serviços (sem linha própria) e as
 *    contas fecham ao centavo.
 */

export type TipoDesconto = "VALOR" | "PERCENTUAL";

export const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export interface ItemCalculo { quantidade: unknown; valorUnitario: unknown; valorTotal?: unknown }

/** Total que vale para o item: unitário × qtd arredondado. */
export const totalDoUnitario = (quantidade: unknown, valorUnitario: unknown) => round2(num(quantidade) * num(valorUnitario));

/** Unitário a partir do total digitado (em centavos). Quantidade zero: não dá para dividir → 0. */
export const unitarioDoTotal = (valorTotal: unknown, quantidade: unknown) => {
  const q = num(quantidade);
  return q > 0 ? round2(num(valorTotal) / q) : 0;
};

/**
 * O total informado bate com unitário × qtd (dentro do arredondamento do unitário em centavos)?
 * Ex.: 3 × 33,33 = 99,99 aceita total 100,00 (o unitário real é 33,333…).
 */
export function totalCoerente(quantidade: unknown, valorUnitario: unknown, valorTotal: unknown): boolean {
  const q = num(quantidade);
  return Math.abs(num(valorTotal) - q * num(valorUnitario)) <= 0.005 * q + 0.005;
}

/** O total do item: o informado (quando coerente com o unitário) ou unitário × qtd. */
export function totalDoItem(it: ItemCalculo): number {
  if (it.valorTotal !== undefined && it.valorTotal !== null && it.valorTotal !== "" && totalCoerente(it.quantidade, it.valorUnitario, it.valorTotal)) {
    return round2(num(it.valorTotal));
  }
  return totalDoUnitario(it.quantidade, it.valorUnitario);
}

/** O desconto em R$: % do subtotal ou o valor, nunca negativo nem maior que o subtotal. */
export function valorDesconto(subtotal: number, valor: unknown, tipo: TipoDesconto): number {
  const v = Math.max(0, num(valor));
  const bruto = tipo === "PERCENTUAL" ? subtotal * (Math.min(v, 100) / 100) : v;
  return round2(Math.min(bruto, subtotal));
}

export interface EntradaCalculo {
  servicos: ItemCalculo[];
  produtos: ItemCalculo[];
  descontoServicos?: unknown;
  tipoDescontoServicos?: TipoDesconto;
  descontoProdutos?: unknown;
  tipoDescontoProdutos?: TipoDesconto;
  /** Alíquota de ISS em % (ex.: 5 = 5%) */
  issAliquota?: unknown;
}

export interface TotaisOrcamento {
  subtotalServicos: number;
  descontoServicos: number;
  /** Serviços depois do desconto: a base do ISS */
  servicosLiquidos: number;
  issAliquota: number;
  valorIss: number;
  /** Serviços líquidos + ISS */
  totalServicos: number;
  subtotalProdutos: number;
  descontoProdutos: number;
  totalProdutos: number;
  /** Soma dos dois descontos (R$) */
  descontoTotal: number;
  totalGeral: number;
}

export function calcularOrcamento(e: EntradaCalculo): TotaisOrcamento {
  const subtotalServicos = round2(e.servicos.reduce((s, it) => s + totalDoItem(it), 0));
  const subtotalProdutos = round2(e.produtos.reduce((s, it) => s + totalDoItem(it), 0));
  const descontoServicos = valorDesconto(subtotalServicos, e.descontoServicos, e.tipoDescontoServicos ?? "VALOR");
  const descontoProdutos = valorDesconto(subtotalProdutos, e.descontoProdutos, e.tipoDescontoProdutos ?? "VALOR");
  const servicosLiquidos = round2(subtotalServicos - descontoServicos);
  const issAliquota = Math.min(100, Math.max(0, num(e.issAliquota)));
  const valorIss = round2(servicosLiquidos * issAliquota / 100);
  const totalServicos = round2(servicosLiquidos + valorIss);
  const totalProdutos = round2(subtotalProdutos - descontoProdutos);
  return {
    subtotalServicos, descontoServicos, servicosLiquidos, issAliquota, valorIss, totalServicos,
    subtotalProdutos, descontoProdutos, totalProdutos,
    descontoTotal: round2(descontoServicos + descontoProdutos),
    totalGeral: round2(totalServicos + totalProdutos),
  };
}

/**
 * Reparte `alvo` (em centavos) entre as partes, proporcional aos pesos, sem perder centavo:
 * o que sobra do arredondamento vai para as maiores frações (método do maior resto).
 */
export function repartir(alvo: number, pesos: number[]): number[] {
  const alvoC = Math.round(alvo * 100);
  const soma = pesos.reduce((s, p) => s + p, 0);
  if (!pesos.length) return [];
  if (soma <= 0) {
    // Sem peso: tudo no primeiro (não deveria acontecer com subtotal > 0)
    return pesos.map((_, i) => (i === 0 ? alvoC / 100 : 0));
  }
  const brutos = pesos.map((p) => (alvoC * p) / soma);
  const base = brutos.map(Math.floor);
  let resto = alvoC - base.reduce((s, b) => s + b, 0);
  const ordem = brutos.map((b, i) => ({ i, f: b - Math.floor(b) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (const { i } of ordem) {
    if (resto <= 0) break;
    base[i] += 1;
    resto -= 1;
  }
  return base.map((c) => c / 100);
}

export interface ItemCliente { quantidade: number; valorUnitario: number; valorTotal: number }
export interface VersaoCliente {
  servicos: ItemCliente[];
  subtotalServicos: number;
  descontoServicos: number;
  totalServicos: number;
  produtos: ItemCliente[];
  subtotalProdutos: number;
  descontoProdutos: number;
  totalProdutos: number;
  totalGeral: number;
  /** Havia ISS para embutir (o documento mostra a nota discreta "valores com impostos inclusos") */
  impostosInclusos: boolean;
}

/**
 * O que o CLIENTE vê: os serviços com o ISS embutido nos preços (proporcional a cada item e ao
 * desconto), sem linha de ISS. As contas fecham: Σ itens = subtotal; subtotal − desconto =
 * total dos serviços com ISS; total geral igual ao interno.
 */
export function versaoCliente(e: EntradaCalculo): VersaoCliente {
  const t = calcularOrcamento(e);
  const totaisServ = e.servicos.map(totalDoItem);
  const totaisProd = e.produtos.map(totalDoItem);
  const produtos = e.produtos.map((it, i) => ({ quantidade: num(it.quantidade), valorUnitario: unitarioDoTotal(totaisProd[i], it.quantidade), valorTotal: totaisProd[i] }));
  const base = {
    produtos, subtotalProdutos: t.subtotalProdutos, descontoProdutos: t.descontoProdutos, totalProdutos: t.totalProdutos, totalGeral: t.totalGeral,
  };
  if (t.valorIss <= 0 || t.subtotalServicos <= 0) {
    return {
      ...base,
      servicos: e.servicos.map((it, i) => ({ quantidade: num(it.quantidade), valorUnitario: unitarioDoTotal(totaisServ[i], it.quantidade), valorTotal: totaisServ[i] })),
      subtotalServicos: t.subtotalServicos, descontoServicos: t.descontoServicos, totalServicos: t.totalServicos,
      impostosInclusos: false,
    };
  }
  // Fator do imposto sobre os serviços líquidos; o subtotal "com imposto" cresce na mesma proporção
  const fator = t.totalServicos / t.servicosLiquidos;
  const subtotalServicos = t.descontoServicos === 0 ? t.totalServicos : round2(t.subtotalServicos * fator);
  const descontoServicos = round2(subtotalServicos - t.totalServicos);
  const valores = repartir(subtotalServicos, totaisServ);
  return {
    ...base,
    servicos: e.servicos.map((it, i) => ({ quantidade: num(it.quantidade), valorUnitario: unitarioDoTotal(valores[i], it.quantidade), valorTotal: valores[i] })),
    subtotalServicos, descontoServicos, totalServicos: t.totalServicos,
    impostosInclusos: true,
  };
}

/**
 * Compatibilidade: o desconto GERAL antigo (um só, sobre tudo) repartido nos grupos, em R$, com a
 * mesma soma — a mesma regra do SQL de migração: serviços primeiro (até o subtotal deles; no % levam o
 * mesmo % sobre eles), o resto em produtos.
 */
export function descontoGeralPorGrupo(subtotalServicos: number, subtotalProdutos: number, valor: unknown, tipo: TipoDesconto) {
  const total = round2(subtotalServicos + subtotalProdutos);
  const d = valorDesconto(total, valor, tipo);
  const tetoServicos = tipo === "PERCENTUAL" ? valorDesconto(subtotalServicos, valor, tipo) : subtotalServicos;
  const servicos = Math.min(d, tetoServicos);
  return { descontoServicos: servicos, descontoProdutos: round2(d - servicos) };
}

/** Rótulo do desconto: "10%" ou "" (valor em R$ não precisa de rótulo). */
export const rotuloDesconto = (valor: unknown, tipo: TipoDesconto) =>
  (tipo === "PERCENTUAL" ? `${String(num(valor)).replace(".", ",")}%` : "");

/** Validade padrão do orçamento: a data dele + 10 dias (dia civil "AAAA-MM-DD"). */
export const DIAS_VALIDADE_PADRAO = 10;
export function validadePadrao(diaOrcamento: string, dias = DIAS_VALIDADE_PADRAO): string {
  const [a, m, d] = diaOrcamento.split("-").map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d + dias));
  return dt.toISOString().slice(0, 10);
}
