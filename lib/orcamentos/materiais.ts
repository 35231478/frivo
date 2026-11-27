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
 *
 * "Orçamento E2" — a REGRA DE COBRANÇA DOS MATERIAIS é da empresa (cada uma cobra do seu jeito), congelada em cada
 * orçamento/OS na hora em que nasce:
 *  - INCLUSO (padrão): como acima — o Material ajusta o serviço; só a Peça vai à parte;
 *  - A_PARTE: o Material também vai em linha própria (quantidade × venda) e soma no total, como a Peça; o serviço
 *    fica na base. O item continua MATERIAL (estoque, separação, custo e o rótulo não mudam) — só a cobrança muda.
 * Sem regra informada, vale INCLUSO (o comportamento de sempre).
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

/** "Orçamento E2" — como os materiais entram na cobrança (regra da empresa, congelada no orçamento/OS). */
export const COBRANCAS_MATERIAIS = ["INCLUSO", "A_PARTE"] as const;
export type CobrancaMateriais = (typeof COBRANCAS_MATERIAIS)[number];
export const COBRANCA_PADRAO: CobrancaMateriais = "INCLUSO";
export const LABEL_COBRANCA: Record<CobrancaMateriais, string> = { INCLUSO: "Incluso no serviço", A_PARTE: "Cobrado à parte" };
export const ehCobranca = (v: unknown): v is CobrancaMateriais => (COBRANCAS_MATERIAIS as readonly string[]).includes(String(v));
/** A regra que vale: a informada se for válida; senão INCLUSO (o de sempre). */
export const regraDeCobranca = (v: unknown): CobrancaMateriais => (ehCobranca(v) ? v : COBRANCA_PADRAO);
/**
 * O item vai em LINHA PRÓPRIA (quantidade × venda, somando no total)? A Peça sempre; o Material só quando a regra do
 * orçamento é "Cobrado à parte". No "Incluso", o Material ajusta o serviço pela diferença do padrão.
 */
export const cobradoAParte = (m: Pick<MaterialOrcamento, "comportamento">, regra?: CobrancaMateriais | null) =>
  ehPeca(m) || regraDeCobranca(regra) === "A_PARTE";

/**
 * "Orçamento E" — troca o Uso de um item SÓ neste orçamento (o cadastro do produto não muda): Material ↔ Peça.
 * Caso típico: gás refrigerante cobrado por kg (Material no cadastro, Peça neste orçamento). A Peça vai inteira em
 * linha própria (quantidade × venda) e deixa de ajustar o serviço; voltar a Material volta a ajustar pela diferença
 * do padrão. Nada mais muda (quantidade, venda, custo e origem ficam).
 */
export function trocarUso<T extends Pick<MaterialOrcamento, "comportamento">>(m: T): T {
  return { ...m, comportamento: ehPeca(m) ? "INCLUSO_NO_SERVICO" : "VENDA_A_PARTE" };
}
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

/**
 * Diferença (R$) que um material INCLUSO faz no serviço: (quantidade − padrão) × venda. O que vai à parte (Peça;
 * ou Material com a regra "Cobrado à parte") = 0 — é cobrado na linha própria.
 */
export const diferencaDoMaterial = (m: MaterialOrcamento, regra?: CobrancaMateriais | null) =>
  (cobradoAParte(m, regra) ? 0 : round2((num(m.quantidade) - num(m.quantidadePadrao)) * num(m.valorVendaUnit)));

/** Ajuste total no valor do serviço pelos materiais inclusos (pode ser negativo: usar menos abate). */
export const ajusteDosMateriais = (ms: readonly MaterialOrcamento[] | null | undefined, regra?: CobrancaMateriais | null) =>
  round2((ms ?? []).reduce((s, m) => s + diferencaDoMaterial(m, regra), 0));

/**
 * Linha de produto de cada item cobrado à parte (quantidade > 0): o que o cliente vê e paga à parte — a Peça sempre;
 * o Material também quando a regra é "Cobrado à parte" (`material: true` no retorno: continua Material).
 */
export function pecasDosMateriais(ms: readonly MaterialOrcamento[] | null | undefined, regra?: CobrancaMateriais | null) {
  return (ms ?? []).filter((m) => cobradoAParte(m, regra) && num(m.quantidade) > 0).map((m) => ({
    material: m, ehMaterial: !ehPeca(m), descricao: m.descricao, quantidade: num(m.quantidade), valorUnitario: round2(num(m.valorVendaUnit)),
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
export function valorDaLinha(l: LinhaServicoComMateriais, regra?: CobrancaMateriais | null): ValorDaLinha {
  const ms = l.materiais ?? [];
  if (!ms.length) return { temMateriais: false, valorBase: null, ajuste: 0, valorManual: false, valorTotal: totalDoItem(l), valorUnitario: num(l.valorUnitario) };
  const valorBase = totalDoUnitario(l.quantidade, l.valorUnitario);
  const ajuste = ajusteDosMateriais(ms, regra);
  const manual = !!l.valorManual && l.valorTotal !== undefined && l.valorTotal !== null && l.valorTotal !== "";
  const valorTotal = manual ? round2(num(l.valorTotal)) : round2(Math.max(0, valorBase + ajuste));
  return { temMateriais: true, valorBase, ajuste, valorManual: manual, valorTotal, valorUnitario: unitarioDoTotal(valorTotal, l.quantidade) };
}

export interface ResumoMateriais {
  ajuste: number;
  /** Σ do que vai à parte (peças; e materiais com a regra "Cobrado à parte") */
  pecas: number;
  quantasPecas: number;
  /** Custo interno (custo × quantidade): inclusos, peças e o total; produtos sem custo listados */
  custoInclusos: number;
  custoPecas: number;
  custoTotal: number;
  semCusto: number;
}

/**
 * Resumo interno de uma linha (ajuste, o que vai à parte e custo) — para entender por que o total mudou. O custo
 * separa por USO (Material × Peça), qualquer que seja a regra de cobrança.
 */
export function resumoMateriais(ms: readonly MaterialOrcamento[] | null | undefined, regra?: CobrancaMateriais | null): ResumoMateriais {
  let custoInclusos = 0, custoPecas = 0, semCusto = 0;
  for (const m of ms ?? []) {
    if (num(m.quantidade) <= 0) continue;
    if (m.custoUnit == null) { semCusto++; continue; }
    const c = num(m.custoUnit) * num(m.quantidade);
    if (ehPeca(m)) custoPecas += c; else custoInclusos += c;
  }
  const pecas = pecasDosMateriais(ms, regra);
  return {
    ajuste: ajusteDosMateriais(ms, regra), pecas: round2(pecas.reduce((s, p) => s + p.valorTotal, 0)), quantasPecas: pecas.length,
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
 * linhas de PRODUTO derivadas do que vai à parte (peças; e materiais com a regra "Cobrado à parte"), na ordem dos
 * serviços. Serviço sem materiais sai como entrou.
 */
export function prepararServicosComMateriais<T extends LinhaServicoComMateriais & { descricao: string }>(servicos: readonly T[], regra?: CobrancaMateriais | null) {
  const linhas = servicos.map((s) => {
    const v = valorDaLinha(s, regra);
    const materiais = (s.materiais ?? []).map((m, ordem) => ({ ...m, quantidade: arred3(num(m.quantidade)), quantidadePadrao: arred3(num(m.quantidadePadrao)), valorVendaUnit: round2(num(m.valorVendaUnit)), ordem }));
    return { linha: s, valor: v, materiais };
  });
  const pecas = linhas.flatMap((l, idxServico) => pecasDosMateriais(l.materiais, regra).map((p) => ({ ...p, idxServico, descricao: p.descricao, observacao: null as string | null })));
  return { linhas, pecas };
}
