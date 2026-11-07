import { round2, totalDoUnitario, unitarioDoTotal } from "@/lib/orcamentos/calculo";
import { pecasDosMateriais, valorDaLinha, type MaterialOrcamento } from "@/lib/orcamentos/materiais";

/**
 * Estoque E3.3b — item da OS sem orçamento com materiais e peças: a MESMA regra do orçamento
 * (lib/orcamentos/materiais.ts), pura. Um item de SERVIÇO com materiais vale base + ajuste dos inclusos (ou o
 * total manual); cada PEÇA (venda à parte) vira um item PRODUTO derivado, cobrado à parte. Item sem materiais
 * (serviço, produto do catálogo ou linha livre) vale unitário × quantidade, como sempre.
 */

export type TipoItemOs = "SERVICO" | "PRODUTO";

export interface EntradaItemOs {
  tipo?: TipoItemOs | null;
  servicoId?: string | null;
  produtoId?: string | null;
  descricao: string;
  quantidade: unknown;
  /** Serviço com materiais: o unitário BASE (antes do ajuste) */
  valorUnitario: unknown;
  valorTotal?: unknown;
  valorManual?: boolean | null;
  materiais?: readonly MaterialOrcamento[] | null;
}

export interface ItemOsPreparado {
  tipo: TipoItemOs;
  servicoId: string | null;
  produtoId: string | null;
  descricao: string;
  quantidade: number;
  valorUnitario: number;
  valorTotal: number;
  valorBase: number | null;
  ajusteMateriais: number;
  valorManual: boolean;
  materiais: (MaterialOrcamento & { ordem: number })[];
  /** Peças derivadas: itens PRODUTO (índice do material de origem em `materiais`) */
  pecas: { idxMaterial: number; produtoId: string | null; descricao: string; quantidade: number; valorUnitario: number; valorTotal: number }[];
}

const num = (v: unknown) => { const n = typeof v === "number" ? v : Number(v ?? 0); return Number.isFinite(n) ? n : 0; };
const arred3 = (n: number) => Math.round(n * 1000) / 1000;

/** Monta o que gravar a partir do que a tela mandou (produto nunca leva materiais; peça só de serviço). */
export function prepararItemOs(e: EntradaItemOs): ItemOsPreparado {
  const tipo: TipoItemOs = e.tipo === "PRODUTO" ? "PRODUTO" : "SERVICO";
  const materiais = tipo === "SERVICO"
    ? (e.materiais ?? []).map((m, ordem) => ({ ...m, quantidade: arred3(num(m.quantidade)), quantidadePadrao: arred3(num(m.quantidadePadrao)), valorVendaUnit: round2(num(m.valorVendaUnit)), ordem }))
    : [];
  const quantidade = num(e.quantidade);
  const v = valorDaLinha({ quantidade, valorUnitario: e.valorUnitario, valorTotal: e.valorTotal, valorManual: e.valorManual, materiais });
  const valorTotal = v.temMateriais ? v.valorTotal : (e.valorTotal !== undefined && e.valorTotal !== null && e.valorTotal !== "" ? round2(num(e.valorTotal)) : totalDoUnitario(quantidade, e.valorUnitario));
  const pecas = pecasDosMateriais(materiais).map((p) => ({
    idxMaterial: materiais.indexOf(p.material as (typeof materiais)[number]), produtoId: p.material.produtoId ?? null,
    descricao: p.descricao, quantidade: p.quantidade, valorUnitario: p.valorUnitario, valorTotal: p.valorTotal,
  }));
  return {
    tipo, servicoId: tipo === "SERVICO" ? e.servicoId || null : null, produtoId: tipo === "PRODUTO" ? e.produtoId || null : null,
    descricao: e.descricao.trim().slice(0, 500), quantidade,
    valorUnitario: v.temMateriais ? v.valorUnitario : unitarioDoTotal(valorTotal, quantidade) || round2(num(e.valorUnitario)),
    valorTotal, valorBase: v.valorBase, ajusteMateriais: v.ajuste, valorManual: v.valorManual, materiais, pecas,
  };
}

/** A linha de serviço (gravada) como a tela edita: unitário BASE quando há materiais. */
export function unitarioParaEdicao(it: { quantidade: unknown; valorUnitario: unknown; valorBase?: unknown; materiais?: readonly unknown[] | null }) {
  if (it.materiais?.length && it.valorBase != null) return unitarioDoTotal(it.valorBase, it.quantidade);
  return num(it.valorUnitario);
}
