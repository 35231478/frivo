import { NextResponse } from "next/server";
import { exigirAlgumaPermissao } from "@/lib/permissoes-server";
import { compradoresDaEmpresa } from "@/lib/compras/pedido-server";

/** GET — quem pode ser comprador responsável: usuários ativos da empresa com acesso a Compras */
export async function GET() {
  const guard = await exigirAlgumaPermissao([["compras", "visualizar"], ["ordens", "editar"], ["orcamentos", "editar"]]);
  if (guard.erro) return guard.resposta;
  return NextResponse.json(await compradoresDaEmpresa(guard.session.user!.empresaId));
}
