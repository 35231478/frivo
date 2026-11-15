/**
 * Sugestão do pedido de compra — o lado do banco das regras de lib/compras/sugestao-compra.ts.
 *
 * Duas consultas, e nada mais:
 *  - os produtos ativos que controlam estoque e estão no mínimo ou abaixo (mesma conta da tela de
 *    Estoque: situacaoEstoque, que já trata saldo negativo);
 *  - as compras desses produtos na janela (entrada por COMPRA com custo, e item de NF já vinculado),
 *    cada nota contando UMA vez — é ela o documento da compra.
 * Empresa sempre a da sessão (quem chama passa).
 */
import { prisma } from "@/lib/prisma";
import { situacaoEstoque } from "@/lib/estoque/regras";
import {
  inicioDaJanela, sugestoesDeCompra, type CompraDoHistorico, type ProdutoEmFalta, type SugestaoCompra,
} from "@/lib/compras/sugestao-compra";

/** Produtos no mínimo ou abaixo, do mais crítico para o menos — com o último fornecedor e preço de quem tem histórico. */
export async function sugestoesDoEstoque(empresaId: string, agora: Date = new Date()): Promise<SugestaoCompra[]> {
  const candidatos = await prisma.produto.findMany({
    where: { empresaId, ativo: true, controlaEstoque: true, OR: [{ estoqueMinimo: { not: null } }, { saldo: { lt: 0 } }] },
    select: { id: true, nome: true, unidade: true, saldo: true, estoqueMinimo: true },
  });
  const emFalta: ProdutoEmFalta[] = candidatos
    .filter((p) => situacaoEstoque(Number(p.saldo), p.estoqueMinimo) !== "ok")
    .map((p) => ({
      produtoId: p.id, nome: p.nome, unidade: p.unidade,
      saldo: Number(p.saldo), estoqueMinimo: p.estoqueMinimo ?? 0,
    }));
  if (!emFalta.length) return [];

  const ids = emFalta.map((p) => p.produtoId);
  const desde = inicioDaJanela(agora);
  const [movs, itensNf] = await Promise.all([
    prisma.movimentacaoEstoque.findMany({
      where: { empresaId, produtoId: { in: ids }, tipo: "ENTRADA", origem: "COMPRA", custoUnitario: { gt: 0 }, data: { gte: desde } },
      select: { id: true, produtoId: true, custoUnitario: true, data: true, refId: true },
    }),
    prisma.notaCompraItem.findMany({
      where: { produtoId: { in: ids }, valorUnitario: { gt: 0 }, nota: { empresaId, dataEmissao: { gte: desde } } },
      select: {
        notaId: true, produtoId: true, valorUnitario: true, fatorConversao: true,
        nota: { select: { dataEmissao: true, emitenteNome: true, fornecedor: { select: { nome: true } } } },
      },
    }),
  ]);

  // O fornecedor e a data da entrada vêm da nota que a originou, quando existe
  const notaIds = movs.map((m) => m.refId).filter((x): x is string => !!x);
  const notas = notaIds.length
    ? await prisma.notaCompra.findMany({
        where: { empresaId, id: { in: notaIds } },
        select: { id: true, dataEmissao: true, emitenteNome: true, fornecedor: { select: { nome: true } } },
      })
    : [];
  const notaPorId = new Map(notas.map((n) => [n.id, n]));

  const compras: CompraDoHistorico[] = [];
  for (const m of movs) {
    const nota = m.refId ? notaPorId.get(m.refId) : undefined;
    compras.push({
      produtoId: m.produtoId,
      // A nota é o documento da compra: a entrada e o item da MESMA nota são uma compra só
      compraId: m.refId ?? `mov:${m.id}`,
      fornecedor: nota ? nota.fornecedor?.nome ?? nota.emitenteNome : null,
      valorUnitario: Number(m.custoUnitario),
      data: nota?.dataEmissao ?? m.data,
    });
  }
  for (const i of itensNf) {
    const fator = Number(i.fatorConversao) > 0 ? Number(i.fatorConversao) : 1;
    compras.push({
      produtoId: i.produtoId!,
      compraId: i.notaId,
      fornecedor: i.nota.fornecedor?.nome ?? i.nota.emitenteNome,
      valorUnitario: Number(i.valorUnitario) / fator,
      data: i.nota.dataEmissao,
    });
  }
  return sugestoesDeCompra(emFalta, compras);
}
