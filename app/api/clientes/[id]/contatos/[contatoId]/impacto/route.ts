import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { impactoContato } from "@/lib/inativacao-server";

/** Pré-checagem do modal de inativar contato (só avisos: acesso ao portal e principal). Clientes › Editar. */
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string; contatoId: string }> }) {
  const guard = await exigirPermissao("clientes", "editar");
  if (guard.erro) return guard.resposta;
  const { id, contatoId } = await params;
  const impacto = await impactoContato(contatoId, id, guard.session.user!.empresaId);
  if (!impacto) return NextResponse.json({ erro: "Contato não encontrado" }, { status: 404 });
  return NextResponse.json(impacto);
}
