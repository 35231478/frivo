import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pode, type Acao, type Permissoes } from "@/lib/permissoes";

/**
 * Guarda de permissão para route handlers. Use no início da API:
 *
 *   const guard = await exigirPermissao("clientes", "criar");
 *   if (guard.erro) return guard.resposta;
 *   const { session } = guard;
 *
 * Libera automaticamente o administrador master (role ADMIN).
 */
export async function exigirPermissao(modulo: string, acao: Acao = "visualizar") {
  const session = await auth();
  if (!session) {
    return { erro: true as const, resposta: NextResponse.json({ erro: "Não autorizado" }, { status: 401 }) };
  }
  const user = session.user;
  if (!pode(user.permissoes as Permissoes, modulo, acao, user.role)) {
    return { erro: true as const, resposta: NextResponse.json({ erro: "Sem permissão para esta ação" }, { status: 403 }) };
  }
  return { erro: false as const, session };
}
