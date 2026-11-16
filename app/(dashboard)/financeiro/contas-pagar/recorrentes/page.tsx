import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { pode } from "@/lib/permissoes";
import { RecorrentesView, type RegraView } from "@/components/financeiro/recorrentes-view";

export const metadata: Metadata = { title: "Despesas recorrentes" };

/**
 * DESPESAS RECORRENTES (contas a pagar): a lista das REGRAS, não das contas. Cada regra abre uma
 * conta a pagar por competência — essas contas vivem na lista de Contas a pagar, independentes.
 * Ver é leitura (Financeiro › visualizar); pausar, encerrar, editar e pular exigem fluxo de caixa.
 */
export default async function RecorrentesPage() {
  const session = await auth();
  const u = session!.user!;
  if (!pode(u.permissoes, "financeiro", "visualizar", u.role)) redirect("/sem-permissao");
  const empresaId = u.empresaId;
  const podeMexer = pode(u.permissoes, "financeiro", "fluxoCaixa", u.role);

  const [regras, categorias, emAberto] = await Promise.all([
    prisma.contaPagarRecorrencia.findMany({
      where: { empresaId },
      include: {
        categoriaFinanceira: { select: { id: true, nome: true, cor: true, ativo: true } },
        centroCusto: { select: { id: true, nome: true, ativo: true } },
        fornecedorCadastro: { select: { id: true, nome: true, ativo: true } },
        tecnico: { select: { id: true, nome: true, ativo: true } },
        _count: { select: { contas: true } },
      },
      orderBy: [{ situacao: "asc" }, { descricao: "asc" }],
    }),
    prisma.categoriaFinanceira.findMany({ where: { empresaId }, select: { id: true, nome: true, cor: true, ativo: true }, orderBy: { nome: "asc" } }),
    // Dinheiro que as regras já colocaram no fluxo e ainda não foi pago (é número de verdade, não projeção)
    prisma.contaPagar.aggregate({
      where: { empresaId, recorrenciaId: { not: null }, status: { in: ["PENDENTE", "VENCIDO"] } },
      _sum: { saldoRestante: true }, _count: true,
    }),
  ]);

  // A próxima ocorrência em aberto de cada regra (o que a pessoa olha primeiro)
  const proximas = regras.length
    ? await prisma.contaPagar.groupBy({
        by: ["recorrenciaId"],
        where: { empresaId, recorrenciaId: { in: regras.map((r) => r.id) }, status: { in: ["PENDENTE", "VENCIDO"] } },
        _min: { dataVencimento: true },
      })
    : [];
  const proxima = new Map(proximas.map((p) => [p.recorrenciaId, p._min.dataVencimento]));

  const linhas: RegraView[] = regras.map((r) => ({
    id: r.id,
    descricao: r.descricao,
    favorecido: {
      nome: r.favorecidoNome,
      tipo: r.tecnicoId ? "COLABORADOR" : "FORNECEDOR",
      ativo: r.tecnico?.ativo ?? r.fornecedorCadastro?.ativo ?? true,
      semCadastro: !r.tecnicoId && !r.fornecedorId,
    },
    passoMeses: r.passoMeses,
    diaVencimento: r.diaVencimento,
    ajusteDiaNaoUtil: r.ajusteDiaNaoUtil,
    valor: Number(r.valor),
    valorEstimado: r.valorEstimado,
    inicioAno: r.inicioAno, inicioMes: r.inicioMes,
    fimAno: r.fimAno, fimMes: r.fimMes, ocorrencias: r.ocorrencias,
    situacao: r.situacao,
    encerramentoMotivo: r.encerramentoMotivo,
    categoriaId: r.categoriaId, categoria: null,
    centroCusto: r.centroCusto ?? null,
    fornecedorId: r.fornecedorId, tecnicoId: r.tecnicoId,
    formaPagamento: r.formaPagamento ?? null,
    observacao: r.observacao,
    contas: r._count.contas,
    proximoVencimento: proxima.get(r.id)?.toISOString() ?? null,
  }));

  return (
    <RecorrentesView
      regras={linhas} categorias={categorias} podeMexer={podeMexer}
      emAberto={{ v: Number(emAberto._sum.saldoRestante ?? 0), q: emAberto._count }}
    />
  );
}
