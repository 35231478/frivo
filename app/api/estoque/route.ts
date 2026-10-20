import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { paramsDe } from "@/lib/listagem";
import { contarAlertas, listarEstoque } from "@/lib/estoque/servidor";

/**
 * GET /api/estoque?busca=&situacao=abaixo|negativo&inativos=1&ordem=nome|saldo|minimo|unidade&dir=&pagina=&por=
 * Saldos dos produtos da empresa da sessão (paginado) + contadores de alerta.
 */
export async function GET(req: NextRequest) {
  const guard = await exigirPermissao("estoque", "visualizar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  const [lista, alertas] = await Promise.all([listarEstoque(empresaId, paramsDe(req.nextUrl.searchParams)), contarAlertas(empresaId)]);
  return NextResponse.json({ ...lista, alertas });
}
