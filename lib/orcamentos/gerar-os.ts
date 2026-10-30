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

interface ItemOrcamento { id?: string; descricao: string; quantidade: unknown; valorUnitario: unknown; valorTotal: unknown; ordem?: number | null }

/**
 * Itens da OS: serviços e depois produtos, na ordem do orçamento, com os mesmos valores. O serviço
 * guarda de qual item do orçamento veio (`orcamentoServicoId`): é por ele que o serviço do catálogo
 * (dados fiscais) chega à nota quando a OS é faturada.
 */
export function itensParaOs(servicos: ItemOrcamento[], produtos: ItemOrcamento[]) {
  const ordenar = (l: ItemOrcamento[]) => [...l].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
  const linha = (i: ItemOrcamento, orcamentoServicoId: string | null) => ({
    descricao: i.descricao.trim().slice(0, 500),
    quantidade: Number(i.quantidade),
    valorUnitario: Number(i.valorUnitario),
    valorTotal: Number(i.valorTotal),
    orcamentoServicoId,
  });
  return [...ordenar(servicos).map((i) => linha(i, i.id ?? null)), ...ordenar(produtos).map((i) => linha(i, null))];
}

/** Descrição da OS: nome do orçamento (com o código) e, se houver, o resumo da proposta. */
export function descricaoDaOs(o: { codigo: string; nome: string; descricao?: string | null }) {
  const titulo = `${o.nome.trim() || "Serviço"} (orçamento ${o.codigo})`;
  const resumo = o.descricao?.trim();
  return (resumo ? `${titulo}\n\n${resumo}` : titulo).slice(0, 4000);
}
