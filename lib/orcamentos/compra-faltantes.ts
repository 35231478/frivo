/**
 * Orçamento, leva C — "Solicitar compra dos faltantes". Regras PURAS (sem banco).
 *
 * NECESSIDADE — por PRODUTO, somando o orçamento inteiro: as linhas de produto digitadas e os materiais das linhas de
 * serviço (inclusos e peças). A peça "venda à parte" vira também uma linha de produto derivada (materialId): ela entra
 * UMA vez, pelo material. Produto que não controla estoque não entra (não há disponível para comparar).
 *
 * FALTA — a MESMA regra da leva B (lib/orcamentos/estoque-margem → faltaNoEstoque): necessidade − disponível, onde o
 * disponível é o saldo do produto (já líquido das reservas da OS).
 *
 * IDEMPOTENTE — o que já está em pedido de compra ABERTO deste orçamento conta como "já solicitado" e sai do que falta
 * pedir. Sem nada a pedir: nada nasce. Com algo a pedir e um pedido deste orçamento ainda "Solicitado" (não foi ao
 * fornecedor): o que falta ENTRA NELE (não duplica). Só se todos os abertos já estão em cotação nasce um pedido novo,
 * e só com a diferença.
 */
import { faltaNoEstoque } from "@/lib/orcamentos/estoque-margem";
import { pedidoEncerrado } from "@/lib/compras/pedido";

const n = (v: unknown) => { const x = typeof v === "number" ? v : Number(v ?? NaN); return Number.isFinite(x) ? x : 0; };
const arred = (v: number) => Math.round(v * 1000) / 1000;

export interface LinhaProdutoOrcamento { produtoId?: string | null; quantidade: unknown; materialId?: string | null }
export interface LinhaMaterialOrcamento { produtoId?: string | null; quantidade: unknown }

/** Quanto o orçamento usa de cada produto (produtos digitados + materiais; peça derivada só pelo material). */
export function necessidadePorProduto(itens: { produtos: readonly LinhaProdutoOrcamento[]; materiais: readonly LinhaMaterialOrcamento[] }): Map<string, number> {
  const m = new Map<string, number>();
  const somar = (id: string | null | undefined, q: unknown) => {
    const qtd = n(q);
    if (!id || qtd <= 0) return;
    m.set(id, arred((m.get(id) ?? 0) + qtd));
  };
  for (const p of itens.produtos) if (!p.materialId) somar(p.produtoId, p.quantidade);
  for (const x of itens.materiais) somar(x.produtoId, x.quantidade);
  return m;
}

export interface ProdutoEstoque { id: string; nome: string; unidade: string; controlaEstoque: boolean; disponivel: number }
export interface PedidoAbertoResumo { id: string; numero: string; status: string; itens: { produtoId: string | null; quantidade: unknown }[] }

export interface Faltante {
  produtoId: string;
  descricao: string;
  unidade: string;
  necessario: number;
  disponivel: number;
  /** necessário − disponível (o que o estoque não cobre) */
  falta: number;
  /** já pedido em pedidos de compra abertos deste orçamento */
  solicitado: number;
  /** o que ainda falta pedir (falta − solicitado, nunca negativo) */
  aSolicitar: number;
  /** os pedidos abertos deste orçamento que já têm este produto */
  pedidos: { id: string; numero: string; status: string }[];
}

/** Os produtos do orçamento que o estoque não cobre, com o que já foi pedido e o que ainda falta pedir. */
export function faltantesDoOrcamento(
  necessidade: ReadonlyMap<string, number>,
  produtos: readonly ProdutoEstoque[],
  pedidos: readonly PedidoAbertoResumo[],
): Faltante[] {
  const abertos = pedidos.filter((p) => !pedidoEncerrado(p.status));
  const r: Faltante[] = [];
  for (const p of produtos) {
    if (!p.controlaEstoque) continue;
    const necessario = necessidade.get(p.id) ?? 0;
    const falta = faltaNoEstoque(necessario, p.disponivel) ?? 0;
    if (falta <= 0) continue;
    const comEle = abertos.filter((pc) => pc.itens.some((i) => i.produtoId === p.id));
    const solicitado = arred(comEle.reduce((s, pc) => s + pc.itens.filter((i) => i.produtoId === p.id).reduce((a, i) => a + n(i.quantidade), 0), 0));
    r.push({
      produtoId: p.id, descricao: p.nome, unidade: p.unidade || "un", necessario, disponivel: p.disponivel, falta, solicitado,
      aSolicitar: Math.max(0, arred(falta - solicitado)),
      pedidos: comEle.map((pc) => ({ id: pc.id, numero: pc.numero, status: pc.status })),
    });
  }
  return r.sort((a, b) => a.descricao.localeCompare(b.descricao, "pt-BR"));
}

export type PlanoSolicitacao =
  | { acao: "nada"; pedidos: { id: string; numero: string }[] }
  | { acao: "acrescentar"; pedidoId: string; itens: { produtoId: string; descricao: string; unidade: string; quantidade: number }[] }
  | { acao: "criar"; itens: { produtoId: string; descricao: string; unidade: string; quantidade: number }[] };

/**
 * O que fazer ao clicar: nada (tudo já pedido), acrescentar no pedido deste orçamento que ainda está "Solicitado"
 * (o mais recente), ou criar um pedido novo com o que falta pedir.
 */
export function planoDaSolicitacao(faltantes: readonly Faltante[], pedidos: readonly PedidoAbertoResumo[]): PlanoSolicitacao {
  const itens = faltantes.filter((f) => f.aSolicitar > 0).map((f) => ({ produtoId: f.produtoId, descricao: f.descricao, unidade: f.unidade, quantidade: f.aSolicitar }));
  if (!itens.length) {
    const ids = new Map<string, { id: string; numero: string }>();
    for (const f of faltantes) for (const p of f.pedidos) ids.set(p.id, { id: p.id, numero: p.numero });
    return { acao: "nada", pedidos: [...ids.values()] };
  }
  const solicitado = pedidos.find((p) => p.status === "SOLICITADO");
  if (solicitado) return { acao: "acrescentar", pedidoId: solicitado.id, itens };
  return { acao: "criar", itens };
}

/** A observação de origem do pedido criado aqui (aparece no pedido e no PDF interno do comprador). */
export const observacaoDeOrigem = (codigoOrcamento: string) => `Gerado do orçamento ${codigoOrcamento}: itens sem estoque suficiente.`;

/** Status do orçamento em que a ação faz sentido: não em orçamento cancelado ou reprovado. */
export const orcamentoAceitaSolicitacao = (status: string) => status !== "CANCELADO" && status !== "REPROVADO";
