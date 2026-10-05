import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { impactoColaborador } from "@/lib/inativacao-server";

/** Pré-checagem do modal de inativar: o que bloqueia e o que será impactado. Exige a permissão de excluir. */
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermissao("equipes", "excluir");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const impacto = await impactoColaborador(id, guard.session.user!.empresaId);
  if (!impacto) return NextResponse.json({ erro: "Colaborador não encontrado" }, { status: 404 });
  return NextResponse.json(impacto);
}
