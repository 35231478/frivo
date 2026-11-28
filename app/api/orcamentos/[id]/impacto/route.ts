import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { impactoOrcamento } from "@/lib/inativacao-server";
import { escopoBarra } from "@/lib/escopo/proprios-server";

/** Pré-checagem do modal de inativar: o que bloqueia e o que será impactado. Exige a permissão de excluir. */
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermissao("orcamentos", "excluir");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const foraDoEscopo = await escopoBarra("orcamento", id); // COM-1: "Ver só os próprios" → 404
  if (foraDoEscopo) return foraDoEscopo;
  const impacto = await impactoOrcamento(id, guard.session.user!.empresaId);
  if (!impacto) return NextResponse.json({ erro: "Orçamento não encontrado" }, { status: 404 });
  return NextResponse.json(impacto);
}
