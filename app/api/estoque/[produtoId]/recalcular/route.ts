import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { recalcularSaldo } from "@/lib/estoque/servidor";

type Params = { params: Promise<{ produtoId: string }> };

/**
 * POST /api/estoque/:produtoId/recalcular — recalcula o saldo do produto pela soma do razão e corrige
 * o cache se divergir (Estoque › gerenciar). Não cria movimentação: o histórico é a verdade.
 * Resposta: { produtoId, nome, saldoCache (antes), somaRazao (o saldo agora), divergia }.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("estoque", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { produtoId } = await params;
  const r = await recalcularSaldo(guard.session.user!.empresaId, produtoId);
  if (!r) return NextResponse.json({ erro: "Produto não encontrado" }, { status: 404 });
  console.info(JSON.stringify({ evento: "estoque_recalculo", quando: new Date().toISOString(), usuarioId: guard.session.user!.id, empresaId: guard.session.user!.empresaId, ...r }));
  return NextResponse.json(r);
}
