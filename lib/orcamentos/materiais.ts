import { type Comportamento, ehComportamento } from "@/lib/estoque/categoria";
import type { MaterialEfetivo } from "@/lib/estoque/composicao";
import { round2, totalDoItem, totalDoUnitario, unitarioDoTotal } from "@/lib/orcamentos/calculo";

/**
 * Estoque E3.3 — materiais e peças de uma linha de serviço do ORÇAMENTO. REGRA PURA (tela, servidor e testes):
 *
 *  - Materializar = copiar a composição do serviço (E3.2, já expandida: o kit vira itens soltos) para o
 *    orçamento, com a quantidade padrão, o valor de venda (tabela do cliente ou padrão) e o custo (interno).
 *    A partir daí é SNAPSHOT: mudar o cadastro depois não mexe no orçamento.
 *  - INCLUSO no serviço: ajusta o valor da linha do serviço pela diferença do padrão:
 *      ajuste = Σ (quantidade − quantidade padrão) × valor de venda
 *    Exceder soma; usar menos abate; avulso (padrão 0) entra integral; "não usado" (quantidade 0) abate o padrão.
 *    O cliente não vê o material: só a linha do serviço, já ajustada.
 *  - VENDA À PARTE (peça): vira uma linha de PRODUTO (quantidade × valor de venda), visível e cobrada à parte,
 *    separada do serviço no orçamento e no financeiro (pronta para a NF de produto no futuro).
 *  - Valor manual: o total da linha digitado na mão vale, independente de base + ajuste.
 *  - Custo (último custo de compra) é só interno: margem e estoque. Nunca entra no preço.
 */

export type OrigemMaterial = "SOLTO" | "KIT" | "AVULSO";
export const ORIGENS_MATERIAL: readonly OrigemMaterial[] = ["SOLTO", "KIT", "AVULSO"];

export interface MaterialOrcamento {
  /** Id local (tela) ou gravado */
  id?: string | null;
  produtoId?: string | null;
  descricao: string;
  unidade: string;
  /** Comportamento efetivo CONGELADO na materialização (E3.1 + override da composição) */
  comportamento: Comportamento;
  quantidade: number;
  /** Quantidade da composição do serviço (0 = avulso) */
  quantidadePadrao: number;
  /** Valor de venda unitário (tabela do cliente ou valor padrão do produto) */
  valorVendaUnit: number;
  /** Último custo de compra (interno); null = nunca comprado com custo */
  custoUnit: number | null;
  origem: OrigemMaterial;
  kitNome?: string | null;
}

const num = (v: unknown) => { const n = typeof v === "number" ? v : Number(v ?? 0); return Number.isFinite(n) ? n : 0; };
const arred3 = (n: number) => Math.round(n * 1000) / 1000;

export const ehPeca = (m: Pick<MaterialOrcamento, "comportamento">) => m.comportamento === "VENDA_A_PARTE";
export const ehIncluso = (m: Pick<MaterialOrcamento, "comportamento">) => !ehPeca(m);
export const LABEL_ORIGEM: Record<OrigemMaterial, string> = { SOLTO: "Composição", KIT: "Kit", AVULSO: "Avulso" };

/**
 * Da composição expandida (lib/estoque/composicao › expandirComposicao) para o snapshot do orçamento: o kit já
 * chega explodido em itens; cada item vira uma linha própria (quantidade editável independente). `precoVenda`
 * = tabela do cliente (se houver o produto nela) ou o valor padrão do produto; `custos` = último custo de compra.
 */
export function materializarComposicao(
  efetivos: readonly MaterialEfetivo[], precoVenda: (produtoId: string) => number | null | undefined, custos: ReadonlyMap<string, number>,
): MaterialOrcamento[] {
  return efetivos.map((m) => ({
    produtoId: m.produtoId, descricao: m.nome, unidade: m.unidade || "un", comportamento: m.comportamento,
    quantidade: arred3(m.quantidade), quantidadePadrao: arred3(m.quantidade),
    valorVendaUnit: round2(num(precoVenda(m.produtoId))), custoUnit: custos.get(m.produtoId) ?? null,
    origem: m.origem.tipo === "kit" ? "KIT" : "SOLTO", kitNome: m.origem.tipo === "kit" ? m.origem.kitNome : null,
  }));
}

/** Material avulso adicionado no orçamento (padrão 0: entra integral no ajuste ou vira peça inteira) */
export function materialAvulso(p: { produtoId: string; nome: string; unidade?: string | null; comportamento: unknown; valorVendaUnit: unknown; custoUnit?: number | null; quantidade?: number }): MaterialOrcamento {
  return {
    produtoId: p.produtoId, descricao: p.nome, unidade: p.unidade || "un", comportamento: ehComportamento(p.comportamento) ? p.comportamento : "INCLUSO_NO_SERVICO",
    quantidade: arred3(num(p.quantidade ?? 1)), quantidadePadrao: 0, valorVendaUnit: round2(num(p.valorVendaUnit)), custoUnit: p.custoUnit ?? null, origem: "AVULSO", kitNome: null,
  };
}

/** Diferença (R$) que um material INCLUSO faz no serviço: (quantidade − padrão) × venda. Peça = 0 (vai à parte). */
export const diferencaDoMaterial = (m: MaterialOrcamento) => (ehPeca(m) ? 0 : round2((num(m.quantidade) - num(m.quantidadePadrao)) * num(m.valorVendaUnit)));

/** Ajuste total no valor do serviço pelos materiais inclusos (pode ser negativo: usar menos abate). */
export const ajusteDosMateriais = (ms: readonly MaterialOrcamento[] | null | undefined) => round2((ms ?? []).reduce((s, m) => s + diferencaDoMaterial(m), 0));

/** Linha de produto de cada peça (quantidade > 0): o que o cliente vê e paga à parte. */
export function pecasDosMateriais(ms: readonly MaterialOrcamento[] | null | undefined) {
  return (ms ?? []).filter((m) => ehPeca(m) && num(m.quantidade) > 0).map((m) => ({
    material: m, descricao: m.descricao, quantidade: num(m.quantidade), valorUnitario: round2(num(m.valorVendaUnit)),
    valorTotal: totalDoUnitario(m.quantidade, m.valorVendaUnit),
  }));
}

export interface LinhaServicoComMateriais {
  quantidade: unknown;
  /** Com materiais: o unitário BASE (antes do ajuste); sem: o unitário como sempre */
  valorUnitario: unknown;
  valorTotal?: unknown;
  valorManual?: boolean | null;
  materiais?: readonly MaterialOrcamento[] | null;
}

export interface ValorDaLinha {
  temMateriais: boolean;
  /** unitário base × quantidade (null sem materiais) */
  valorBase: number | null;
  ajuste: number;
  valorManual: boolean;
  valorTotal: number;
  /** O unitário efetivo (total ÷ qtd) — o que a OS, a fatura e a nota leem */
  valorUnitario: number;
}

/**
 * O valor que vale para a linha do serviço:
 *  - sem materiais: como sempre (o total manda; lib/orcamentos/calculo);
 *  - com materiais: base (unitário × qtd) + ajuste dos inclusos; ou o total digitado na mão (valorManual).
 */
export function valorDaLinha(l: LinhaServicoComMateriais): ValorDaLinha {
  const ms = l.materiais ?? [];
  if (!ms.length) return { temMateriais: false, valorBase: null, ajuste: 0, valorManual: false, valorTotal: totalDoItem(l), valorUnitario: num(l.valorUnitario) };
  const valorBase = totalDoUnitario(l.quantidade, l.valorUnitario);
  const ajuste = ajusteDosMateriais(ms);
  const manual = !!l.valorManual && l.valorTotal !== undefined && l.valorTotal !== null && l.valorTotal !== "";
  const valorTotal = manual ? round2(num(l.valorTotal)) : round2(Math.max(0, valorBase + ajuste));
  return { temMateriais: true, valorBase, ajuste, valorManual: manual, valorTotal, valorUnitario: unitarioDoTotal(valorTotal, l.quantidade) };
}

export interface ResumoMateriais {
  ajuste: number;
  /** Σ das peças (à parte) */
  pecas: number;
  quantasPecas: number;
  /** Custo interno (custo × quantidade): inclusos, peças e o total; produtos sem custo listados */
  custoInclusos: number;
  custoPecas: number;
  custoTotal: number;
  semCusto: number;
}

/** Resumo interno de uma linha (ajuste, peças e custo) — para o Zé entender por que o total mudou. */
export function resumoMateriais(ms: readonly MaterialOrcamento[] | null | undefined): ResumoMateriais {
  let custoInclusos = 0, custoPecas = 0, semCusto = 0;
  for (const m of ms ?? []) {
    if (num(m.quantidade) <= 0) continue;
    if (m.custoUnit == null) { semCusto++; continue; }
    const c = num(m.custoUnit) * num(m.quantidade);
    if (ehPeca(m)) custoPecas += c; else custoInclusos += c;
  }
  const pecas = pecasDosMateriais(ms);
  return {
    ajuste: ajusteDosMateriais(ms), pecas: round2(pecas.reduce((s, p) => s + p.valorTotal, 0)), quantasPecas: pecas.length,
    custoInclusos: round2(custoInclusos), custoPecas: round2(custoPecas), custoTotal: round2(custoInclusos + custoPecas), semCusto,
  };
}

/** Conferência pura das linhas de material (a mesma mensagem na tela e no servidor); null = ok. */
export function erroDosMateriais(ms: readonly Partial<MaterialOrcamento>[] | null | undefined): string | null {
  for (const m of ms ?? []) {
    if (!m.descricao?.trim()) return "Todo material precisa de uma descrição.";
    if (!ehComportamento(m.comportamento)) return "Comportamento de faturamento do material inválido.";
    if (!(num(m.quantidade) >= 0) || !(num(m.quantidadePadrao) >= 0)) return "A quantidade do material não pode ser negativa.";
    if (num(m.valorVendaUnit) < 0 || (m.custoUnit != null && num(m.custoUnit) < 0)) return "Valor do material não pode ser negativo.";
    if (m.origem && !ORIGENS_MATERIAL.includes(m.origem)) return "Origem do material inválida.";
  }
  return null;
}

/**
 * Prepara as linhas de serviço para gravar/calcular: o valor efetivo de cada uma (base + ajuste, ou manual) e as
 * linhas de PRODUTO derivadas das peças, na ordem dos serviços. Serviço sem materiais sai como entrou.
 */
export function prepararServicosComMateriais<T extends LinhaServicoComMateriais & { descricao: string }>(servicos: readonly T[]) {
  const linhas = servicos.map((s) => {
    const v = valorDaLinha(s);
    const materiais = (s.materiais ?? []).map((m, ordem) => ({ ...m, quantidade: arred3(num(m.quantidade)), quantidadePadrao: arred3(num(m.quantidadePadrao)), valorVendaUnit: round2(num(m.valorVendaUnit)), ordem }));
    return { linha: s, valor: v, materiais };
  });
  const pecas = linhas.flatMap((l, idxServico) => pecasDosMateriais(l.materiais).map((p) => ({ ...p, idxServico, descricao: p.descricao, observacao: null as string | null })));
  return { linhas, pecas };
}
