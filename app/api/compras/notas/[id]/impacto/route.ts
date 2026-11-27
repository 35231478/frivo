import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { impactoDescarteNota } from "@/lib/compras/notas";

/** Pré-checagem do modal de descartar nota: a lançada não se descarta (a mesma regra do DELETE). */
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermissao("estoque", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const impacto = await impactoDescarteNota(guard.session.user!.empresaId, id);
  if (!impacto) return NextResponse.json({ erro: "Nota não encontrada" }, { status: 404 });
  return NextResponse.json(impacto);
}
