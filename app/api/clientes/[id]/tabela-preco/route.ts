import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

/**
 * Resolve a tabela de preços efetiva de um cliente:
 * - a tabela vinculada ao cliente, se estiver ATIVA;
 * - senão (sem tabela, ou com tabela inativada), a tabela PADRAO ativa da empresa.
 * Retorna os itens indexados pelo id do serviço/produto e, quando a vinculada está inativa,
 * `vinculadaInativa` (para a tela avisar que o preço veio da Padrão).
 */
export async function GET(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  if (!pode(session.user!.permissoes, "clientes", "visualizar", session.user!.role))
    return NextResponse.json({ erro: "Sem permissão" }, { status: 403 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const cliente = await prisma.cliente.findFirst({ where: { id, empresaId }, select: { tabelaPrecoId: true } });
  if (!cliente) return NextResponse.json({ erro: "Cliente não encontrado" }, { status: 404 });

  const vinculada = cliente.tabelaPrecoId
    ? await prisma.tabelaPreco.findFirst({ where: { id: cliente.tabelaPrecoId, empresaId }, include: { itens: true } })
    : null;
  // Tabela inativada não vale mais para preço novo: volta para a Padrão (antes ficava sem tabela nenhuma)
  const tabela = vinculada?.ativo
    ? vinculada
    : await prisma.tabelaPreco.findFirst({
        where: { empresaId, tipo: "PADRAO", ativo: true },
        include: { itens: true },
        orderBy: { criadoEm: "asc" },
      });
  const vinculadaInativa = vinculada && !vinculada.ativo ? { id: vinculada.id, nome: vinculada.nome } : null;

  if (!tabela) return NextResponse.json(null);

  const itens: Record<string, { valorFinal: number; bloqueado: boolean; tipoPreco: string; descontoPercent: number | null }> = {};
  for (const it of tabela.itens) {
    const chave = it.servicoId ?? it.produtoId;
    if (!chave) continue;
    itens[chave] = {
      valorFinal: Number(it.valorFinal),
      bloqueado: it.bloqueado,
      tipoPreco: it.tipoPreco,
      descontoPercent: it.descontoPercent != null ? Number(it.descontoPercent) : null,
    };
  }

  return NextResponse.json({
    id: tabela.id,
    nome: tabela.nome,
    tipo: tabela.tipo,
    precosBloqueados: tabela.precosBloqueados,
    itens,
    vinculadaInativa,
  });
}
