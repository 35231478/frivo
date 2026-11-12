import { NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { contarAlertas } from "@/lib/estoque/servidor";

/** GET /api/estoque/alertas → { abaixo, negativo } (produtos ativos da empresa da sessão) */
export async function GET() {
  const guard = await exigirPermissao("estoque", "visualizar");
  if (guard.erro) return guard.resposta;
  return NextResponse.json(await contarAlertas(guard.session.user!.empresaId));
}
