import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { pode } from "@/lib/permissoes";
import { fornecedorDaConta } from "@/lib/financeiro/fornecedor";
import { CAMPO_CARD_PAGAR, CARDS_PERIODO_PAGAR, condCardPeriodoPagar, condPeriodoVencimento, whereListaPagar } from "@/lib/listas/filtros";
import { lerPeriodo } from "@/lib/periodo";
import { janela, lerPaginacao, paginaValida } from "@/lib/listagem";
import { hojeDiaCivil } from "@/lib/fuso";
import { ContasPagarView, type ResumoPagar } from "@/components/financeiro/contas-pagar-view";

export const metadata: Metadata = { title: "Contas a Pagar" };

export default async function ContasPagarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const session = await auth();
  if (!pode(session!.user!.permissoes, "financeiro", "visualizar", session!.user!.role)) redirect("/sem-permissao");
  const u = session!.user!;
  const empresaId = u.empresaId;
  // Atalho para a mesma importação de XML do Estoque (importar exige Estoque › gerenciar)
  const podeImportarNf = pode(u.permissoes, "estoque", "gerenciar", u.role);

  const agora = new Date();
  const hoje = hojeDiaCivil(agora); // vencimento é dia civil: vencida só depois do dia de Brasília
  await prisma.contaPagar.updateMany({
    where: { empresaId, status: "PENDENTE", dataVencimento: { lt: hoje } },
    data: { status: "VENCIDO" },
  });

  // Período (padrão da casa) pelo VENCIMENTO: mês com ‹ ›, intervalo ou todo o período — na URL.
  // O filtro roda no BANCO e a lista é paginada (UX-4).
  const periodo = lerPeriodo(sp, agora, { permitirTodos: true });
  const where = whereListaPagar(empresaId, sp, periodo, agora) as any;
  const { pagina: paginaPedida, porPagina } = lerPaginacao(sp);

  // Cards do período: só o período (busca e filtros do painel mexem só na lista). Abertos pelo
  // saldo restante, "Pagos" pelo valor pago, "Total" pelo valor das contas (CAMPO_CARD_PAGAR).
  const noPeriodo = condPeriodoVencimento(periodo);
  const soma = (card: (typeof CARDS_PERIODO_PAGAR)[number]) =>
    prisma.contaPagar.aggregate({
      where: { empresaId, AND: [noPeriodo ?? {}, condCardPeriodoPagar(card, agora) ?? {}] as object[] },
      _sum: { [CAMPO_CARD_PAGAR[card]]: true }, _count: true,
    });

  const [total, agFiltrado, agAberto, aggCards, categorias, fornecedores, centros] = await Promise.all([
    prisma.contaPagar.count({ where }),
    prisma.contaPagar.aggregate({ where, _sum: { valorTotal: true } }),
    prisma.contaPagar.aggregate({ where: { AND: [where, { status: { in: ["PENDENTE", "PAGO_PARCIAL", "VENCIDO"] } }] }, _sum: { saldoRestante: true } }),
    Promise.all(CARDS_PERIODO_PAGAR.map(soma)),
    // Todas (ativas e inativas): cor/nome das contas que já usam uma categoria inativa não somem
    prisma.categoriaFinanceira.findMany({ where: { empresaId }, select: { id: true, nome: true, cor: true, ativo: true }, orderBy: { nome: "asc" } }),
    prisma.fornecedor.findMany({ where: { empresaId }, select: { id: true, nome: true, ativo: true }, orderBy: { nome: "asc" } }),
    prisma.centroCusto.findMany({ where: { empresaId }, select: { id: true, nome: true, ativo: true }, orderBy: { nome: "asc" } }),
  ]);
  const pagina = paginaValida(paginaPedida, porPagina, total);
  const contas = total
    ? await prisma.contaPagar.findMany({
        where,
        include: {
          pedidoCompra: { select: { numero: true } }, notaCompra: { select: { id: true, numero: true } },
          centroCusto: { select: { id: true, nome: true, ativo: true } },
          fornecedorCadastro: { select: { id: true, nome: true, documento: true, ativo: true } },
        },
        orderBy: [{ dataVencimento: "asc" }, { criadoEm: "desc" }, { id: "asc" }],
        ...janela(pagina, porPagina),
      })
    : [];

  const resumo = Object.fromEntries(CARDS_PERIODO_PAGAR.map((k, i) => {
    const a = aggCards[i] as { _sum?: Record<string, unknown>; _count: number };
    return [k, { v: Number(a._sum?.[CAMPO_CARD_PAGAR[k]] ?? 0), q: a._count }];
  })) as ResumoPagar;

  return (
    <ContasPagarView
      contas={contas.map((c) => ({
        id: c.id, numero: c.numero, descricao: c.descricao,
        valorTotal: Number(c.valorTotal), valorPago: Number(c.valorPago), saldoRestante: Number(c.saldoRestante),
        dataVencimento: c.dataVencimento ? new Date(c.dataVencimento).toISOString() : null, status: c.status,
        categoriaId: c.categoriaId ?? null, categoria: null,
        centroCusto: c.centroCusto ?? null,
        fornecedor: fornecedorDaConta(c),
        temBoleto: !!c.linhaDigitavel,
        notaCompra: c.notaCompra ?? null, pedidoCompra: c.pedidoCompra ?? null,
      }))}
      resumo={resumo}
      periodo={{ tipo: periodo.tipo, mes: periodo.mes, de: periodo.de, ate: periodo.ate, rotulo: periodo.rotulo }}
      filtros={{
        fornecedor: sp.fornecedor ?? "", card: sp.card ?? "", status: sp.status ?? "", fornecedorId: sp.fornecedorId ?? "",
        categoria: sp.categoria ?? "", centro: sp.centro ?? "", origem: sp.origem ?? "",
      }}
      categorias={categorias} centros={centros} fornecedores={fornecedores}
      total={total} pagina={pagina} porPagina={porPagina}
      totalFiltrado={Number(agFiltrado._sum.valorTotal ?? 0)} totalAberto={Number(agAberto._sum.saldoRestante ?? 0)}
      podeImportarNf={podeImportarNf}
    />
  );
}
