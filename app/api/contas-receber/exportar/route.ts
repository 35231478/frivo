import { NextRequest, NextResponse } from "next/server";
import { recebidoDaConta, saldoDaConta } from "@/lib/financeiro/parcelas";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { prisma } from "@/lib/prisma";
import { whereListaReceber } from "@/lib/listas/filtros";
import { lerPeriodo } from "@/lib/periodo";
import { paramsDe } from "@/lib/listagem";
import { statusVisualReceber } from "@/lib/financeiro-status";
import { categoriaDaConta } from "@/lib/financeiro/categoria";
import { formatarData } from "@/lib/utils";

/** Teto do CSV: bem acima do dia a dia, sem deixar uma URL derrubar o servidor. */
const MAX_LINHAS = 20000;

/**
 * UX-4 (E4): exporta o FILTRO da tela de Contas a Receber (mesmo where da lista),
 * não só a página visível. GET /api/contas-receber/exportar?mes=|de=&ate=|periodo=todos&q=&status=&card=&…
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  if (!pode(session.user!.permissoes, "financeiro", "contasReceber", session.user!.role))
    return NextResponse.json({ erro: "Sem permissão" }, { status: 403 });
  const empresaId = session.user!.empresaId;

  const sp = paramsDe(new URL(req.url).searchParams) as Record<string, string | undefined>;
  // O mesmo where da tela: filtros + período (vencimento) + card do período
  const agora = new Date();
  const where = whereListaReceber(empresaId, sp, lerPeriodo(sp, agora, { permitirTodos: true }), agora);

  const [contas, categorias] = await Promise.all([
    prisma.contaReceber.findMany({
      where,
      include: { cliente: { select: { nome: true, nomeFantasia: true, cpfCnpj: true } } },
      orderBy: [{ dataVencimento: "asc" }, { criadoEm: "desc" }, { id: "asc" }],
      take: MAX_LINHAS,
    }),
    prisma.categoriaFinanceira.findMany({ where: { empresaId }, select: { id: true, nome: true, cor: true, ativo: true } }),
  ]);

  // Parcela e baixa parcial no fim (as colunas de antes ficam no mesmo lugar)
  const linhas = [["Número", "Cliente", "CNPJ", "Descrição", "Categoria", "Vencimento", "Valor", "Status", "Parcela", "Recebido", "Em aberto"]];
  const reais = (v: number) => String(v).replace(".", ",");
  for (const c of contas) {
    const sv = statusVisualReceber(c.status, c.dataVencimento);
    linhas.push([
      c.numero,
      c.cliente.nomeFantasia ?? c.cliente.nome,
      c.clienteCnpj ?? c.cliente.cpfCnpj ?? "",
      c.descricao,
      categoriaDaConta({ categoriaId: c.categoriaId, categoria: c.categoria }, categorias)?.nome ?? "",
      c.dataVencimento ? formatarData(c.dataVencimento) : "",
      String(Number(c.valor)).replace(".", ","),
      sv.label,
      c.parcelaNumero && c.parcelaTotal ? `${c.parcelaNumero}/${c.parcelaTotal}` : "",
      reais(recebidoDaConta(c)),
      reais(saldoDaConta(c)),
    ]);
  }
  const csv = linhas.map((l) => l.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(";")).join("\n");
  return new NextResponse("﻿" + csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="contas-a-receber.csv"',
    },
  });
}
