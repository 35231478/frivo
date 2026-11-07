/**
 * "Gerar OS" a partir do orçamento aprovado (faturamento avulso, caminho inverso): regras puras.
 * A OS nasce com o cliente, o endereço (unidade) e os itens do orçamento; os itens entram como
 * NÃO executados (a execução marca). Um orçamento gera no máximo uma OS.
 */

/** Por que o orçamento não pode gerar OS (null = pode). */
export function motivoNaoGerarOs(o: { status: string; tipo: string }): string | null {
  if (o.tipo === "PROPOSTA_CONTRATO") return "Proposta de contrato não gera OS avulsa: as OS saem do contrato.";
  if (o.status !== "APROVADO") return "Disponível apenas para orçamento aprovado.";
  return null;
}

interface MaterialOrc { id?: string; produtoId?: string | null; descricao: string; unidade?: string | null; comportamento: string; quantidade: unknown; quantidadePadrao: unknown; valorVendaUnit: unknown; custoUnit?: unknown; origem: string; kitNome?: string | null; ordem?: number | null }
interface ItemOrcamento {
  id?: string; descricao: string; quantidade: unknown; valorUnitario: unknown; valorTotal: unknown; ordem?: number | null;
  servicoId?: string | null; produtoId?: string | null;
  /** E3.3: a linha de serviço com materiais e a peça derivada (materialId) */
  valorBase?: unknown; ajusteMateriais?: unknown; valorManual?: boolean | null; materiais?: MaterialOrc[] | null; materialId?: string | null;
}

export interface ItemParaOs {
  descricao: string; quantidade: number; valorUnitario: number; valorTotal: number; orcamentoServicoId: string | null;
  tipo: "SERVICO" | "PRODUTO"; servicoId: string | null; produtoId: string | null;
  valorBase: number | null; ajusteMateriais: number; valorManual: boolean;
  /** Snapshot copiado do orçamento (E3.3b): o id de origem liga a peça derivada ao material na OS */
  materiais: { origemId: string | null; produtoId: string | null; descricao: string; unidade: string; comportamento: string; quantidade: number; quantidadePadrao: number; valorVendaUnit: number; custoUnit: number | null; origem: string; kitNome: string | null; ordem: number }[];
  /** Peça derivada: o id do material do ORÇAMENTO de onde veio */
  materialOrigemId: string | null;
}

const n = (v: unknown) => Number(v ?? 0) || 0;

/**
 * Itens da OS: serviços e depois produtos, na ordem do orçamento, com os MESMOS valores (o serviço já ajustado pelos
 * materiais, a peça como produto). O serviço guarda de qual item do orçamento veio (`orcamentoServicoId`): é por ele
 * que o serviço do catálogo (dados fiscais) chega à nota. E3.3b: tipo, catálogo e o snapshot dos materiais vão junto.
 */
export function itensParaOs(servicos: ItemOrcamento[], produtos: ItemOrcamento[]): ItemParaOs[] {
  const ordenar = (l: ItemOrcamento[]) => [...l].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
  const linha = (i: ItemOrcamento, tipo: "SERVICO" | "PRODUTO", orcamentoServicoId: string | null): ItemParaOs => ({
    descricao: i.descricao.trim().slice(0, 500),
    quantidade: Number(i.quantidade),
    valorUnitario: Number(i.valorUnitario),
    valorTotal: Number(i.valorTotal),
    orcamentoServicoId,
    tipo, servicoId: tipo === "SERVICO" ? i.servicoId ?? null : null, produtoId: tipo === "PRODUTO" ? i.produtoId ?? null : null,
    valorBase: i.valorBase == null ? null : n(i.valorBase), ajusteMateriais: n(i.ajusteMateriais), valorManual: !!i.valorManual,
    materiais: (i.materiais ?? []).map((m, ordem) => ({
      origemId: m.id ?? null, produtoId: m.produtoId ?? null, descricao: m.descricao, unidade: m.unidade || "un", comportamento: m.comportamento,
      quantidade: n(m.quantidade), quantidadePadrao: n(m.quantidadePadrao), valorVendaUnit: n(m.valorVendaUnit), custoUnit: m.custoUnit == null ? null : n(m.custoUnit),
      origem: m.origem, kitNome: m.kitNome ?? null, ordem,
    })),
    materialOrigemId: i.materialId ?? null,
  });
  return [...ordenar(servicos).map((i) => linha(i, "SERVICO", i.id ?? null)), ...ordenar(produtos).map((i) => linha(i, "PRODUTO", null))];
}

/** Descrição da OS: nome do orçamento (com o código) e, se houver, o resumo da proposta. */
export function descricaoDaOs(o: { codigo: string; nome: string; descricao?: string | null }) {
  const titulo = `${o.nome.trim() || "Serviço"} (orçamento ${o.codigo})`;
  const resumo = o.descricao?.trim();
  return (resumo ? `${titulo}\n\n${resumo}` : titulo).slice(0, 4000);
}
