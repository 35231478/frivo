import { comportamentoDoProduto, ehComportamento, type Comportamento } from "@/lib/estoque/categoria";

/**
 * Estoque E3.2 — composição do serviço ("Materiais padrão") e kits de material. REGRA PURA (sem Prisma):
 * a tela, o servidor e a E3.3 (materiais no orçamento/OS) usam o mesmo cálculo.
 *
 *  - Cada linha da composição é um PRODUTO SOLTO ou um KIT, com a quantidade padrão.
 *  - O comportamento de faturamento de cada material vem da CATEGORIA do produto (E3.1); um produto
 *    solto pode ter um override pontual. Item de kit não tem override: para mudar, adicione o produto solto.
 *  - O kit é "vivo": a composição guarda só a referência; expandir (aqui) lê os itens ATUAIS do kit.
 *    A cópia editável acontece só no lançamento do orçamento/OS (E3.3).
 *  - Custo: referência informativa (último custo de compra × quantidade); nunca altera preço.
 */

export interface ProdutoDaComposicao {
  id: string;
  nome: string;
  unidade?: string | null;
  ativo?: boolean;
  categoriaProduto?: { comportamento: string } | null;
}
export interface ItemDoKit { produtoId: string; quantidade: unknown; produto?: ProdutoDaComposicao | null }
export interface KitDaComposicao { id: string; nome: string; ativo?: boolean; itens?: ItemDoKit[] | null }

/** Uma linha gravada (ou em edição) da composição do serviço */
export interface LinhaComposicao {
  produtoId?: string | null;
  kitId?: string | null;
  quantidade: unknown;
  /** Override do comportamento (só produto solto); nulo = o da categoria */
  comportamento?: unknown;
  produto?: ProdutoDaComposicao | null;
  kit?: KitDaComposicao | null;
}

/** Um material "efetivo": o que a E3.3 vai copiar para o orçamento/OS */
export interface MaterialEfetivo {
  produtoId: string;
  nome: string;
  unidade: string;
  quantidade: number;
  comportamento: Comportamento;
  /** De onde veio: produto solto ou um kit (id + nome) */
  origem: { tipo: "solto" } | { tipo: "kit"; kitId: string; kitNome: string };
  /** Produto inativo no catálogo (continua valendo na composição; a tela avisa) */
  inativo: boolean;
}

export const qtd = (v: unknown) => {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const arred = (n: number, casas = 3) => Math.round(n * 10 ** casas) / 10 ** casas;

/** Comportamento efetivo de um material: o override (quando válido) ou o da categoria do produto. */
export function comportamentoEfetivo(override: unknown, produto: ProdutoDaComposicao | null | undefined): Comportamento {
  return ehComportamento(override) ? override : comportamentoDoProduto(produto);
}

/**
 * Expande a composição nos materiais efetivos: produto solto = 1 material; kit = seus itens (quantidade do
 * item × quantidade de kits). Linha sem produto/kit carregado (removido) é ignorada.
 */
export function expandirComposicao(linhas: readonly LinhaComposicao[] | null | undefined): MaterialEfetivo[] {
  const out: MaterialEfetivo[] = [];
  for (const l of linhas ?? []) {
    if (l.produtoId && l.produto) {
      out.push({
        produtoId: l.produtoId, nome: l.produto.nome, unidade: l.produto.unidade || "un", quantidade: arred(qtd(l.quantidade)),
        comportamento: comportamentoEfetivo(l.comportamento, l.produto), origem: { tipo: "solto" }, inativo: l.produto.ativo === false,
      });
    } else if (l.kitId && l.kit) {
      const vezes = qtd(l.quantidade);
      for (const it of l.kit.itens ?? []) {
        if (!it.produto) continue;
        out.push({
          produtoId: it.produtoId, nome: it.produto.nome, unidade: it.produto.unidade || "un", quantidade: arred(qtd(it.quantidade) * vezes),
          comportamento: comportamentoDoProduto(it.produto), origem: { tipo: "kit", kitId: l.kit.id, kitNome: l.kit.nome }, inativo: it.produto.ativo === false,
        });
      }
    }
  }
  return out;
}

export interface ResumoCusto {
  /** Soma (custo × quantidade) dos materiais INCLUSOS no serviço: o que sai do bolso sem cobrar à parte */
  inclusos: number;
  /** Soma dos materiais cobrados à parte (referência) */
  aParte: number;
  /** Produtos (ids, sem repetir) que não têm custo de compra registrado: a soma está incompleta */
  semCusto: string[];
}

/** Custo de referência dos materiais a partir do último custo de compra de cada produto (Map produtoId → custo). */
export function custoDosMateriais(materiais: readonly MaterialEfetivo[], custos: ReadonlyMap<string, number>): ResumoCusto {
  let inclusos = 0, aParte = 0;
  const semCusto = new Set<string>();
  for (const m of materiais) {
    const c = custos.get(m.produtoId);
    if (c == null) { semCusto.add(m.produtoId); continue; }
    if (m.comportamento === "VENDA_A_PARTE") aParte += c * m.quantidade; else inclusos += c * m.quantidade;
  }
  return { inclusos: arred(inclusos, 2), aParte: arred(aParte, 2), semCusto: [...semCusto] };
}

/** Custo de referência de 1 kit (soma de custo × quantidade dos itens). */
export function custoDoKit(kit: Pick<KitDaComposicao, "itens">, custos: ReadonlyMap<string, number>): { total: number; semCusto: string[] } {
  let total = 0;
  const semCusto = new Set<string>();
  for (const it of kit.itens ?? []) {
    const c = custos.get(it.produtoId);
    if (c == null) { semCusto.add(it.produtoId); continue; }
    total += c * qtd(it.quantidade);
  }
  return { total: arred(total, 2), semCusto: [...semCusto] };
}

/** Rótulo curto da origem de um material (tela) */
export const rotuloOrigem = (m: MaterialEfetivo) => (m.origem.tipo === "kit" ? `Kit ${m.origem.kitNome}` : "Avulso");

/**
 * Conferência pura das linhas (a mesma da tela e do servidor): produto OU kit, quantidade > 0, override só em
 * produto solto, sem repetir o mesmo produto solto nem o mesmo kit. Devolve a mensagem do primeiro problema.
 */
export function erroDasLinhas(linhas: readonly { produtoId?: string | null; kitId?: string | null; quantidade: unknown; comportamento?: unknown }[]): string | null {
  const produtos = new Set<string>(), kits = new Set<string>();
  for (const l of linhas) {
    const temProduto = !!l.produtoId, temKit = !!l.kitId;
    if (temProduto === temKit) return "Cada material é um produto OU um kit.";
    if (!(qtd(l.quantidade) > 0)) return "A quantidade de cada material precisa ser maior que zero.";
    if (temKit && l.comportamento != null && l.comportamento !== "") return "O comportamento de um kit vem da categoria de cada produto dele. Para mudar, adicione o produto solto.";
    if (temProduto && l.comportamento != null && l.comportamento !== "" && !ehComportamento(l.comportamento)) return "Comportamento de faturamento inválido.";
    if (temProduto) { if (produtos.has(l.produtoId!)) return "O mesmo produto aparece duas vezes: some as quantidades numa linha só."; produtos.add(l.produtoId!); }
    if (temKit) { if (kits.has(l.kitId!)) return "O mesmo kit aparece duas vezes: aumente a quantidade numa linha só."; kits.add(l.kitId!); }
  }
  return null;
}

/** Itens de um kit: produto obrigatório, quantidade > 0, sem repetir produto. */
export function erroDosItensDoKit(itens: readonly { produtoId?: string | null; quantidade: unknown }[]): string | null {
  const vistos = new Set<string>();
  for (const it of itens) {
    if (!it.produtoId) return "Cada item do kit precisa de um produto.";
    if (!(qtd(it.quantidade) > 0)) return "A quantidade de cada item do kit precisa ser maior que zero.";
    if (vistos.has(it.produtoId)) return "O mesmo produto aparece duas vezes no kit: some as quantidades numa linha só.";
    vistos.add(it.produtoId);
  }
  return null;
}
