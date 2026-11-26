/**
 * Orçamento, leva B — estoque e margem no Editar orçamento. Regras PURAS (sem banco; tela e servidor).
 *
 * DISPONÍVEL — a MESMA regra do módulo Estoque (lib/estoque/regras, tela de separação): o saldo do produto.
 * A reserva da OS (separação, E4.1) já é um lançamento RESERVA que SUBTRAI do saldo; então o saldo já é
 * "o que há menos o reservado". Produto que não controla estoque não tem disponível (null). Só aparece com o
 * módulo Estoque ligado (quem decide é o servidor: com ele desligado, o campo nem vem).
 *
 * CUSTO — o que o Estoque usa: o ÚLTIMO CUSTO DE COMPRA (lib/estoque/custo → ultimosCustos), por unidade do
 * produto. Materiais do serviço usam o custo copiado na hora de orçar (snapshot, como sempre).
 *
 * MARGEM — sobre a VENDA, como no Estoque (lib/estoque/preco → margemSobreVenda): (venda − custo) ÷ venda.
 * Lucro = venda − custo. Só entra o que tem custo conhecido: mão de obra não tem custo no sistema.
 *
 * SEGURANÇA — custo, lucro e margem são só para quem tem "Orçamentos › Ver custo e margem". Sem ela, o
 * servidor TIRA o custo do que manda ao navegador (`semCustoNosMateriais`) e, ao salvar, nunca confia no
 * custo vindo do navegador (`custoConfiavel`): mantém o gravado ou busca o último custo de compra.
 */
import { margemSobreVenda } from "@/lib/estoque/preco";

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => { const n = typeof v === "number" ? v : Number(v ?? NaN); return Number.isFinite(n) ? n : null; };

/* ───────── disponível ───────── */

/** Situação de um produto na tela: disponível (só com Estoque ligado) e custo (só com a permissão) */
export interface SituacaoProduto {
  /** Saldo disponível (já descontadas as reservas); null = produto que não controla estoque. Ausente = Estoque desligado. */
  disponivel?: number | null;
  unidade?: string;
  /** Último custo de compra; null = nunca comprado com custo. Ausente = sem a permissão. */
  custo?: number | null;
}

/** Quanto falta no estoque para a quantidade do orçamento (0 = cobre; null = sem controle de estoque / sem dado). */
export function faltaNoEstoque(quantidade: unknown, disponivel: number | null | undefined): number | null {
  if (disponivel == null) return null;
  const q = num(quantidade) ?? 0;
  const falta = Math.round((q - disponivel) * 1000) / 1000;
  return falta > 0 ? falta : 0;
}

/* ───────── custo, lucro e margem ───────── */

export interface MargemItem { custo: number; lucro: number; margem: number | null }

/** Custo, lucro e margem de UMA linha: venda = total da linha; custo = custo unitário × quantidade. Sem custo: null. */
export function margemDoItem(venda: unknown, custoUnit: number | null | undefined, quantidade: unknown): MargemItem | null {
  if (custoUnit == null || !Number.isFinite(custoUnit)) return null;
  const v = num(venda) ?? 0;
  const custo = round2(custoUnit * (num(quantidade) ?? 0));
  return { custo, lucro: round2(v - custo), margem: margemSobreVenda(v, custo) };
}

export interface ResumoMargem {
  /** Venda considerada: o total do orçamento SEM o ISS (o imposto não é receita da empresa) */
  venda: number;
  /** Soma dos custos conhecidos: produtos, peças e materiais inclusos (último custo de compra) */
  custo: number;
  lucro: number;
  margem: number | null;
  /** Itens com custo desconhecido (nunca comprados com custo, ou digitados à mão): ficam fora do custo */
  semCusto: number;
}

/**
 * O resumo do orçamento: lucro bruto = total sem ISS − custos conhecidos; margem sobre a venda. `custos` tem um valor
 * por produto, peça e material incluso (custo × quantidade), ou null quando o custo é desconhecido — esses contam em
 * `semCusto` e ficam fora. Mão de obra não tem custo no sistema: não entra (a tela avisa no ⓘ).
 */
export function resumoMargem(totalSemIss: unknown, custos: readonly (number | null | undefined)[]): ResumoMargem {
  let custo = 0, semCusto = 0;
  for (const c of custos) {
    if (c == null || !Number.isFinite(c)) { semCusto++; continue; }
    custo += c;
  }
  const venda = round2(num(totalSemIss) ?? 0);
  custo = round2(custo);
  return { venda, custo, lucro: round2(venda - custo), margem: margemSobreVenda(venda, custo), semCusto };
}

/**
 * Os custos que entram no resumo, um por item: cada MATERIAL dos serviços (incluso ou peça: custo copiado × quantidade)
 * e cada PRODUTO digitado pelo usuário (último custo de compra × quantidade). As peças derivadas NÃO entram de novo
 * como produto: já vieram pelos materiais. Produto sem vínculo com o catálogo, ou sem custo: null (fica fora).
 */
export function custosDoOrcamento(
  itens: {
    produtos: readonly { catalogoId?: string | null; quantidade: unknown; derivada?: unknown }[];
    servicos: readonly { materiais?: readonly { custoUnit?: number | null; quantidade: unknown }[] | null }[];
  },
  custoDoProduto: (produtoId: string) => number | null | undefined,
): (number | null)[] {
  const custos: (number | null)[] = [];
  for (const s of itens.servicos) {
    for (const m of s.materiais ?? []) {
      const q = num(m.quantidade) ?? 0;
      if (q <= 0) continue;
      custos.push(m.custoUnit == null ? null : round2(m.custoUnit * q));
    }
  }
  for (const p of itens.produtos) {
    if (p.derivada) continue;
    const q = num(p.quantidade) ?? 0;
    if (q <= 0) continue;
    const c = p.catalogoId ? custoDoProduto(p.catalogoId) : null;
    custos.push(c == null ? null : round2(c * q));
  }
  return custos;
}

/** Tom da margem: negativa = prejuízo (atrasado), até 10% = apertada (atenção), acima = ok. Sem margem: neutro. */
export const MARGEM_APERTADA = 10;
export function tomDaMargem(margem: number | null | undefined): "atrasado" | "atencao" | "ok" | "neutro" {
  if (margem == null || !Number.isFinite(margem)) return "neutro";
  if (margem < 0) return "atrasado";
  if (margem <= MARGEM_APERTADA) return "atencao";
  return "ok";
}

/* ───────── segurança: o custo não sai do servidor sem a permissão ───────── */

/** Tira `custoUnit` de cada material (o campo some, não vira null): o que vai ao navegador de quem não tem a permissão. */
export function semCustoNosMateriais<T extends { custoUnit?: unknown }>(materiais: readonly T[]): Omit<T, "custoUnit">[] {
  return materiais.map(({ custoUnit: _c, ...resto }) => resto);
}

/** O mesmo para as linhas de serviço com materiais */
export function semCustoNosServicos<S extends { materiais?: readonly { custoUnit?: unknown }[] | null }>(servicos: readonly S[]): S[] {
  return servicos.map((s) => (s.materiais ? { ...s, materiais: semCustoNosMateriais(s.materiais) } : s)) as S[];
}

/**
 * O custo que o SERVIDOR grava para um material do orçamento — nunca o que veio do navegador:
 *  - material que já estava gravado neste orçamento (mesmo id e mesmo produto): mantém o custo copiado na hora de orçar;
 *  - material novo de produto do catálogo: o último custo de compra de agora;
 *  - material digitado à mão (sem produto): sem custo.
 */
export function custoConfiavel(
  m: { id?: string | null; produtoId?: string | null },
  gravados: ReadonlyMap<string, { produtoId: string | null; custoUnit: number | null }>,
  ultimos: ReadonlyMap<string, number>,
): number | null {
  const g = m.id ? gravados.get(m.id) : undefined;
  if (g && (g.produtoId ?? null) === (m.produtoId ?? null)) return g.custoUnit;
  if (!m.produtoId) return null;
  return ultimos.get(m.produtoId) ?? null;
}
