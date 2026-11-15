/**
 * SUGESTÃO DO PEDIDO DE COMPRA (Princípio 9: sugere, não preenche no escuro).
 *
 * No pedido avulso (reposição), a tela oferece o que o estoque já sabe: os produtos **no mínimo ou
 * abaixo**, com quanto falta para voltar ao mínimo. Para cada um, quando o histórico permite, vem
 * também **de quem se comprou da última vez e por quanto**.
 *
 * Duas fontes, duas regras — e elas são diferentes de propósito:
 *  - QUAIS produtos: é fato do estoque (saldo ≤ mínimo), não palpite. Entra mesmo sem histórico.
 *  - FORNECEDOR e PREÇO: vêm do histórico e seguem a regra da casa, irmã das sugestões da OS (leva 5)
 *    e do item do orçamento (leva 6B): janela de JANELA_MESES meses, mínimo de MINIMO_COMPRAS compras
 *    distintas, e o preço é o da compra mais recente — nunca média. Sem isso, o produto aparece sem
 *    palpite de preço, e a tela diz que é compra nova.
 *
 * Nada é preenchido sozinho: a linha só entra no pedido quando a pessoa clica, e segue editável.
 */

export const JANELA_MESES = 6;
export const MINIMO_COMPRAS = 2;
/** Teto da faixa: ela sugere, não vira lista de compras — no celular cada sugestão é uma linha */
export const MAXIMO_SUGESTOES = 6;

/** Um produto que o estoque marcou como no mínimo ou abaixo. */
export interface ProdutoEmFalta {
  produtoId: string;
  nome: string;
  unidade: string;
  saldo: number;
  estoqueMinimo: number;
}

/** Uma compra daquele produto (entrada por NF/compra), da mais nova para a mais antiga. */
export interface CompraDoHistorico {
  produtoId: string;
  /** Documento que trouxe a compra (nota); duas linhas da mesma nota são UMA compra */
  compraId: string;
  fornecedor: string | null;
  valorUnitario: number;
  data: Date;
}

export interface SugestaoCompra {
  produtoId: string;
  nome: string;
  unidade: string;
  saldo: number;
  estoqueMinimo: number;
  /** Quanto falta para voltar ao mínimo (nunca negativo) */
  faltam: number;
  /** Último fornecedor e preço — só com histórico suficiente */
  fornecedor: string | null;
  valorUnitario: number | null;
  /** Em quantas compras distintas ele apareceu no período (o motivo que a tela mostra) */
  vezes: number;
}

/** O instante a partir do qual o histórico conta (janela móvel de JANELA_MESES). */
export function inicioDaJanela(agora: Date = new Date()): Date {
  const d = new Date(agora);
  d.setMonth(d.getMonth() - JANELA_MESES);
  return d;
}

/** Quanto falta para o produto voltar ao mínimo (saldo negativo conta a dívida inteira). */
export function faltaParaOMinimo(p: Pick<ProdutoEmFalta, "saldo" | "estoqueMinimo">): number {
  const falta = p.estoqueMinimo - p.saldo;
  return falta > 0 ? Math.round(falta * 1000) / 1000 : 0;
}

/**
 * Monta a sugestão: os produtos em falta (do mais crítico para o menos) com o último fornecedor e
 * preço de quem tem histórico suficiente. Lista vazia = a tela não mostra nada.
 */
export function sugestoesDeCompra(
  emFalta: readonly ProdutoEmFalta[],
  compras: readonly CompraDoHistorico[],
  opcoes: { minimo?: number; maximo?: number } = {},
): SugestaoCompra[] {
  const minimo = opcoes.minimo ?? MINIMO_COMPRAS;
  const maximo = opcoes.maximo ?? MAXIMO_SUGESTOES;

  const porProduto = new Map<string, { documentos: Set<string>; recente: CompraDoHistorico }>();
  for (const c of compras) {
    if (!(c.valorUnitario > 0)) continue;
    const atual = porProduto.get(c.produtoId);
    if (!atual) { porProduto.set(c.produtoId, { documentos: new Set([c.compraId]), recente: c }); continue; }
    atual.documentos.add(c.compraId);
    if (c.data.getTime() > atual.recente.data.getTime()) atual.recente = c;
  }

  return emFalta
    .map<SugestaoCompra>((p) => {
      const h = porProduto.get(p.produtoId);
      const vezes = h ? h.documentos.size : 0;
      const temHistorico = vezes >= minimo;
      return {
        produtoId: p.produtoId,
        nome: p.nome,
        unidade: p.unidade,
        saldo: p.saldo,
        estoqueMinimo: p.estoqueMinimo,
        faltam: faltaParaOMinimo(p),
        fornecedor: temHistorico ? h!.recente.fornecedor : null,
        valorUnitario: temHistorico ? h!.recente.valorUnitario : null,
        vezes,
      };
    })
    // o mais crítico primeiro: quem está negativo, depois quem falta mais
    .sort((a, b) => a.saldo - b.saldo || b.faltam - a.faltam || a.nome.localeCompare(b.nome, "pt-BR"))
    .slice(0, maximo);
}

/** O texto que a tela mostra para explicar de onde veio o preço. */
export function motivoDoPreco(s: Pick<SugestaoCompra, "vezes">): string {
  return `${s.vezes} compras nos últimos ${JANELA_MESES} meses`;
}
