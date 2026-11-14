import { prisma } from "@/lib/prisma";
import { montarValoresOrcamento } from "@/lib/orcamento-helpers";
import { orcamentoJaFaturado } from "@/lib/faturamento-os";
import { motivoDaLinhaDoOrcamento } from "@/lib/edicao-contexto";
import type { OrcamentoInput } from "@/lib/validations";

export interface MudancaDaLinha { descricao?: string; quantidade?: number; valorUnitario?: number; observacao?: string | null }
export type ResultadoLinha =
  | { ok: true; linha: { id: string; tipo: "SERVICO" | "PRODUTO"; descricao: string; quantidade: number; valorUnitario: number; valorTotal: number; observacao: string | null }; totalGeral: number }
  | { ok: false; status: number; erro: string };

const n = (v: unknown) => Number(v ?? 0) || 0;

/**
 * Edita UMA linha do orçamento como USO ("Editando este item do orçamento"): descrição, quantidade, preço
 * aplicado neste orçamento e observação — só o que veio. O catálogo não é lido nem gravado, e o retrato dos
 * materiais copiado para a linha fica como está.
 *
 * Os totais saem da MESMA conta do salvar do formulário (`montarValoresOrcamento`): as linhas gravadas
 * voltam como o formulário as mandaria, com a linha alterada no lugar — uma regra só para desconto, ISS e
 * serviço com materiais. Só a linha editada e os totais do orçamento são regravados.
 */
export async function editarLinhaDoOrcamento(empresaId: string, orcamentoId: string, linhaId: string, m: MudancaDaLinha): Promise<ResultadoLinha> {
  const o = await prisma.orcamento.findFirst({
    where: { id: orcamentoId, empresaId },
    include: { servicos: { orderBy: { ordem: "asc" }, include: { materiais: { orderBy: { ordem: "asc" } } } }, produtos: { orderBy: { ordem: "asc" } } },
  });
  if (!o) return { ok: false, status: 404, erro: "Orçamento não encontrado" };
  const servico = o.servicos.find((s) => s.id === linhaId);
  const produto = servico ? undefined : o.produtos.find((p) => p.id === linhaId);
  if (!servico && !produto) return { ok: false, status: 404, erro: "Item não encontrado" };

  const motivo = motivoDaLinhaDoOrcamento({ materialId: produto?.materialId }, { status: o.status, faturado: !!(await orcamentoJaFaturado(orcamentoId)) });
  if (motivo) return { ok: false, status: 409, erro: motivo };
  if (m.descricao === undefined && m.quantidade === undefined && m.valorUnitario === undefined && m.observacao === undefined) return { ok: false, status: 400, erro: "Nada para alterar." };
  // Serviço com total digitado à mão: o preço dele é esse total (muda no formulário do orçamento, não pelo unitário)
  if (servico?.valorManual && servico.materiais.length && m.valorUnitario !== undefined)
    return { ok: false, status: 400, erro: "Linha com valor manual: ajuste o valor no formulário do orçamento." };

  const mudouValor = m.quantidade !== undefined || m.valorUnitario !== undefined;
  const aplicar = <T extends { descricao: string; quantidade: number; valorUnitario: number; valorTotal?: number; observacao: string | null }>(l: T, alvo: boolean): T => (!alvo ? l : {
    ...l, descricao: m.descricao ?? l.descricao, quantidade: m.quantidade ?? l.quantidade, valorUnitario: m.valorUnitario ?? l.valorUnitario,
    observacao: m.observacao === undefined ? l.observacao : m.observacao,
    // Quantidade ou preço novos: o total volta a ser quantidade × unitário (o total antigo não manda mais)
    valorTotal: mudouValor ? undefined : l.valorTotal,
  });

  // As linhas gravadas, como o formulário as mandaria (as peças derivadas o servidor recompõe dos materiais)
  const servicos = o.servicos.map((s) => {
    const comMateriais = s.materiais.length > 0;
    const l = aplicar({
      catalogoId: s.servicoId, descricao: s.descricao, quantidade: n(s.quantidade),
      // Com materiais, o unitário editável é o BASE (antes do ajuste dos inclusos)
      valorUnitario: comMateriais && s.valorBase != null ? n(s.valorBase) / (n(s.quantidade) || 1) : n(s.valorUnitario),
      valorTotal: n(s.valorTotal) as number | undefined, observacao: s.observacao, valorManual: s.valorManual,
    }, s.id === linhaId);
    return comMateriais ? {
      ...l, valorTotal: s.valorManual ? n(s.valorTotal) : undefined,
      materiais: s.materiais.map((x) => ({
        id: x.id, produtoId: x.produtoId, descricao: x.descricao, unidade: x.unidade, comportamento: x.comportamento, quantidade: n(x.quantidade),
        quantidadePadrao: n(x.quantidadePadrao), valorVendaUnit: n(x.valorVendaUnit), custoUnit: x.custoUnit == null ? null : n(x.custoUnit), origem: x.origem, kitNome: x.kitNome, ordem: x.ordem,
      })),
    } : l;
  });
  const doUsuario = o.produtos.filter((p) => !p.materialId);
  const produtos = doUsuario.map((p) => aplicar({
    catalogoId: p.produtoId, descricao: p.descricao, quantidade: n(p.quantidade), valorUnitario: n(p.valorUnitario), valorTotal: n(p.valorTotal) as number | undefined, observacao: p.observacao,
  }, p.id === linhaId));

  const valores = montarValoresOrcamento({
    servicos, produtos, desconto: 0, tipoDesconto: "VALOR",
    descontoServicos: n(o.descontoServicos), tipoDescontoServicos: o.tipoDescontoServicos, descontoProdutos: n(o.descontoProdutos), tipoDescontoProdutos: o.tipoDescontoProdutos,
  } as unknown as OrcamentoInput, n(o.issAliquota));

  const tipo = servico ? "SERVICO" as const : "PRODUTO" as const;
  const novo = servico ? valores.servicos[o.servicos.indexOf(servico)] : valores.produtos[doUsuario.indexOf(produto!)];
  await prisma.$transaction(async (tx) => {
    if (servico) {
      const s = valores.servicos[o.servicos.indexOf(servico)];
      await tx.orcamentoServico.update({ where: { id: linhaId }, data: {
        descricao: s.descricao, quantidade: s.quantidade, valorUnitario: s.valorUnitario, valorTotal: s.valorTotal, observacao: s.observacao,
        valorBase: s.valorBase, ajusteMateriais: s.ajusteMateriais, valorManual: s.valorManual,
      } });
    } else {
      await tx.orcamentoProduto.update({ where: { id: linhaId }, data: { descricao: novo.descricao, quantidade: novo.quantidade, valorUnitario: novo.valorUnitario, valorTotal: novo.valorTotal, observacao: novo.observacao } });
    }
    await tx.orcamento.update({ where: { id: orcamentoId }, data: valores.campos });
  });
  return {
    ok: true, totalGeral: valores.totais.totalGeral,
    linha: { id: linhaId, tipo, descricao: novo.descricao, quantidade: n(novo.quantidade), valorUnitario: n(novo.valorUnitario), valorTotal: n(novo.valorTotal), observacao: novo.observacao },
  };
}
