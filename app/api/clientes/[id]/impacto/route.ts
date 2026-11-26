import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { impactoCliente } from "@/lib/inativacao-server";

/** Pré-checagem do modal de inativar cliente: o que continua andando (só avisos). Exige a permissão de excluir. */
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermissao("clientes", "excluir");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const impacto = await impactoCliente(id, guard.session.user!.empresaId);
  if (!impacto) return NextResponse.json({ erro: "Cliente não encontrado" }, { status: 404 });
  return NextResponse.json(impacto);
}
