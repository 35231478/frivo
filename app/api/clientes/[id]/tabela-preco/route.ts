import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

/**
 * A tabela de preços que vale para um cliente (empresa da sessão):
 * - cliente COM tabela vinculada e ATIVA → a tabela dela (os itens indexados pelo id do serviço/produto);
 * - cliente SEM tabela → `null`: vale o catálogo padrão (serviços/produtos ativos da empresa, preço padrão);
 * - cliente com tabela vinculada INATIVA → também o catálogo padrão, e a resposta diz qual tabela estava
 *   ligada (`vinculadaInativa`) para a tela avisar.
 *
 * Nunca cai em outra tabela. Antes, "sem tabela" voltava para a tabela de tipo "Padrão" da empresa — e
 * qualquer tabela marcada com esse tipo (até uma feita para um cliente específico) virava o catálogo
 * de todos os clientes sem tabela, com os itens e os preços dela.
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
  if (!cliente.tabelaPrecoId) return NextResponse.json(null);

  const tabela = await prisma.tabelaPreco.findFirst({ where: { id: cliente.tabelaPrecoId, empresaId }, include: { itens: true } });
  if (!tabela) return NextResponse.json(null);
  if (!tabela.ativo) {
    return NextResponse.json({ id: null, nome: null, tipo: null, precosBloqueados: false, itens: null, vinculadaInativa: { id: tabela.id, nome: tabela.nome } });
  }

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
    vinculadaInativa: null,
  });
}
