import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { impactoEndereco } from "@/lib/inativacao-server";

/**
 * Pré-checagem do modal de inativar endereço: o principal e os equipamentos ativos bloqueiam; contratos,
 * PMOC e OS em aberto daquele local só avisam. A mesma permissão de inativar (Clientes › Editar).
 */
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermissao("clientes", "editar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const impacto = await impactoEndereco(id, guard.session.user!.empresaId);
  if (!impacto) return NextResponse.json({ erro: "Endereço não encontrado" }, { status: 404 });
  return NextResponse.json(impacto);
}
