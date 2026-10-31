import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { marcarContasReceberVencidas } from "@/lib/financeiro-server";
import { CARD_RECEBER_PELO_SALDO, CARD_SO_COBRANCAS, CARDS_PERIODO_RECEBER, condCardPeriodoReceber, condPeriodoVencimento, whereListaReceber } from "@/lib/listas/filtros";
import { saldoDoAgregado } from "@/lib/financeiro/parcelas-server";
import { lerPeriodo } from "@/lib/periodo";
import { janela, lerPaginacao, paginaValida } from "@/lib/listagem";
import { ContasReceberView, type ContaView, type ResumoReceber } from "@/components/financeiro/contas-receber-view";

export const metadata: Metadata = { title: "Contas a Receber" };

export default async function ContasReceberPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const session = await auth();
  if (!pode(session!.user!.permissoes, "financeiro", "contasReceber", session!.user!.role)) redirect("/sem-permissao");
  const empresaId = session!.user!.empresaId;

  // PREVISTO não vira ATRASADO (C6/F5) — regra única em marcarContasReceberVencidas
  await marcarContasReceberVencidas(empresaId);

  const agora = new Date();
  // Período (padrão da casa) pelo VENCIMENTO: mês com ‹ ›, intervalo ou todo o período — na URL
  const periodo = lerPeriodo(sp, agora, { permitirTodos: true });
  // UX-4 (E4): o filtro roda no BANCO — nada some por corte de fatia
  const where = whereListaReceber(empresaId, sp, periodo, agora);
  const { pagina: paginaPedida, porPagina } = lerPaginacao(sp);

  // Cards do período: só o período (os outros filtros não mexem nos cards)
  const noPeriodo = condPeriodoVencimento(periodo);
  const soma = (card: string) =>
    prisma.contaReceber.aggregate({
      where: { empresaId, excluidaEm: null, AND: [CARD_SO_COBRANCAS, noPeriodo ?? {}, condCardPeriodoReceber(card, agora) ?? {}] as object[] },
      _sum: { valor: true, valorRecebido: true }, _count: true,
    });

  const [total, somaFiltrada, abertoAgg, aggCards, clientes, categorias, integracao] = await Promise.all([
    prisma.contaReceber.count({ where }),
    prisma.contaReceber.aggregate({ where, _sum: { valor: true } }),
    // O que falta receber no filtro (só as abertas, pelo saldo)
    prisma.contaReceber.aggregate({ where: { AND: [where, { status: { in: ["PREVISTO", "A_RECEBER", "ATRASADO"] } }] }, _sum: { valor: true, valorRecebido: true } }),
    Promise.all(CARDS_PERIODO_RECEBER.map(soma)),
    prisma.cliente.findMany({ where: { empresaId, ativo: true }, select: { id: true, nome: true, nomeFantasia: true }, orderBy: { nome: "asc" } }),
    // Todas (ativas e inativas): a cor das contas antigas não some e a edição mostra a categoria atual;
    // o SeletorCadastro só oferece as ativas para nova escolha
    prisma.categoriaFinanceira.findMany({ where: { empresaId }, select: { id: true, nome: true, cor: true, ativo: true }, orderBy: { nome: "asc" } }),
    prisma.integracaoInter.findUnique({ where: { empresaId }, select: { ativo: true } }),
  ]);

  const pagina = paginaValida(paginaPedida, porPagina, total);
  const contas = total
    ? await prisma.contaReceber.findMany({
        where,
        include: {
          cliente: {
            select: {
              id: true, nome: true, nomeFantasia: true, logo: true, cpfCnpj: true,
              email: true, telefone: true, celular: true, whatsappFaturamento: true, emailsFaturamento: true,
            },
          },
          medicao: { select: { numero: true, avulsa: true } },
          orcamento: { select: { codigo: true } },
          contrato: { select: { numero: true } },
          notasFiscais: { select: { status: true } },
          // Parcela: a origem e as notas são as do lançamento (a conta que foi dividida)
          lancamento: {
            select: {
              numero: true, medicaoId: true, orcamentoId: true, contratoId: true,
              medicao: { select: { numero: true, avulsa: true } }, orcamento: { select: { codigo: true } }, contrato: { select: { numero: true } },
              notasFiscais: { select: { status: true } },
            },
          },
        },
        orderBy: [{ dataVencimento: "asc" }, { criadoEm: "desc" }, { id: "asc" }],
        ...janela(pagina, porPagina),
      })
    : [];

  const resumo = Object.fromEntries(CARDS_PERIODO_RECEBER.map((k, i) => [
    k, { v: CARD_RECEBER_PELO_SALDO[k] ? saldoDoAgregado(aggCards[i]) : Number(aggCards[i]._sum?.valor ?? 0), q: aggCards[i]._count },
  ])) as ResumoReceber;

  const view: ContaView[] = contas.map((c) => {
    // Parcela: origem/notas do lançamento
    const o = c.lancamento ?? c;
    return {
    id: c.id, numero: c.numero, descricao: c.descricao, categoriaId: c.categoriaId, categoria: c.categoria, valor: Number(c.valor),
    valorRecebido: Number(c.valorRecebido),
    lancamentoId: c.lancamentoId, lancamentoNumero: c.lancamento?.numero ?? null, parcelaNumero: c.parcelaNumero, parcelaTotal: c.parcelaTotal,
    dataVencimento: c.dataVencimento ? c.dataVencimento.toISOString() : null,
    dataRecebimento: c.dataRecebimento ? c.dataRecebimento.toISOString() : null,
    status: c.status, banco: c.banco, formaPagamento: c.formaPagamento,
    clienteId: c.cliente.id,
    clienteNome: c.cliente.nomeFantasia ?? c.cliente.nome,
    clienteCnpj: c.clienteCnpj ?? c.cliente.cpfCnpj,
    clienteLogo: c.cliente.logo,
    whatsapp: c.cliente.whatsappFaturamento ?? c.cliente.celular ?? c.cliente.telefone ?? null,
    email: c.cliente.emailsFaturamento?.[0] ?? c.cliente.email ?? null,
    notificacaoEnviadaEm: c.notificacaoEnviadaEm ? c.notificacaoEnviadaEm.toISOString() : null,
    boletoStatus: c.boletoStatus,
    boletoEmitidoEm: c.boletoEmitidoEm ? c.boletoEmitidoEm.toISOString() : null,
    boletoVencimento: c.boletoVencimento ? c.boletoVencimento.toISOString() : null,
    boletoLinhaDigitavel: c.boletoLinhaDigitavel,
    boletoCodigoBarras: c.boletoCodigoBarras,
    observacao: c.observacao, centroCustoId: c.centroCustoId, contaBancariaId: c.contaBancariaId,
    medicaoId: o.medicaoId, orcamentoId: o.orcamentoId, contratoId: o.contratoId,
    medicaoNumero: o.medicao?.numero ?? null, medicaoAvulsa: o.medicao?.avulsa ?? false, orcamentoCodigo: o.orcamento?.codigo ?? null, contratoNumero: o.contrato?.numero ?? null,
    notas: o.notasFiscais,
    };
  });

  return (
    <ContasReceberView
      contas={view}
      clientes={clientes.map((c) => ({ id: c.id, nome: c.nomeFantasia ?? c.nome }))}
      categorias={categorias}
      interAtivo={!!integracao?.ativo}
      resumo={resumo}
      total={total}
      totalFiltrado={Number(somaFiltrada._sum.valor ?? 0)}
      abertoFiltrado={saldoDoAgregado(abertoAgg)}
      pagina={pagina}
      porPagina={porPagina}
      periodo={{ tipo: periodo.tipo, mes: periodo.mes, de: periodo.de, ate: periodo.ate, rotulo: periodo.rotulo }}
      filtros={{
        q: sp.q ?? "", card: sp.card === "A_RECEBER" ? "A_VENCER" : sp.card ?? "", clienteId: sp.clienteId ?? "", categoria: sp.categoria ?? "",
        forma: sp.forma ?? "", banco: sp.banco ?? "", valorMin: sp.valorMin ?? "", valorMax: sp.valorMax ?? "",
        vencDe: sp.vencDe ?? "", vencAte: sp.vencAte ?? "", status: sp.status ?? "", conta: sp.conta ?? "",
      }}
    />
  );
}
