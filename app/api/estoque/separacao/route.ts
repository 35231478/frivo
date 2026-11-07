import { NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { filaSeparacao } from "@/lib/estoque/separacao-server";

/** GET /api/estoque/separacao → a fila "A separar" da empresa da sessão (Estoque › Separar material). */
export async function GET() {
  const guard = await exigirPermissao("estoque", "separar");
  if (guard.erro) return guard.resposta;
  return NextResponse.json(await filaSeparacao(guard.session.user!.empresaId));
}
