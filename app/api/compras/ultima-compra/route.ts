import { NextRequest, NextResponse } from "next/server";
import { exigirAlgumaPermissao } from "@/lib/permissoes-server";
import { ultimasCompras } from "@/lib/compras/pedido-server";

/** GET ?produtoIds=a,b — última compra de cada produto (dica do valor estimado do pedido de compra) */
export async function GET(req: NextRequest) {
  const guard = await exigirAlgumaPermissao([["compras", "visualizar"], ["ordens", "editar"], ["orcamentos", "editar"]]);
  if (guard.erro) return guard.resposta;
  const ids = (new URL(req.url).searchParams.get("produtoIds") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 200);
  return NextResponse.json(await ultimasCompras(guard.session.user!.empresaId, ids));
}
