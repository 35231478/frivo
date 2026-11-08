import { NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { filaDevolucao } from "@/lib/estoque/devolucao-server";

/** GET /api/estoque/devolucao → a fila "A devolver" da empresa da sessão (Estoque › Separar material). */
export async function GET() {
  const guard = await exigirPermissao("estoque", "separar");
  if (guard.erro) return guard.resposta;
  return NextResponse.json(await filaDevolucao(guard.session.user!.empresaId));
}
