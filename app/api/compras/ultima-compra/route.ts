import { NextRequest, NextResponse } from "next/server";
import { exigirAlgumaPermissao } from "@/lib/permissoes-server";
import { pode, type Acao, type Permissoes } from "@/lib/permissoes";
import { ultimasCompras } from "@/lib/compras/pedido-server";
import { podeVerCustoDeCompra } from "@/lib/estoque/custo-acesso";

/**
 * GET ?produtoIds=a,b — última compra de cada produto (dica do valor estimado do pedido de compra).
 * O último preço pago É custo de compra: quem chega só pelo orçamento (Orçamentos › editar) precisa também poder
 * ver custo (lib/estoque/custo-acesso) — senão 403 e a dica some do editor do pedido. Compras › visualizar segue
 * vendo (é o dado da área). Quem chega pela OS (Ordens › editar) fica como estava: a regra do custo na OS é a
 * leva seguinte.
 */
export async function GET(req: NextRequest) {
  const guard = await exigirAlgumaPermissao([["compras", "visualizar"], ["ordens", "editar"], ["orcamentos", "editar"]]);
  if (guard.erro) return guard.resposta;
  const u = guard.session.user!;
  const p = (m: string, a: Acao) => pode(u.permissoes as Permissoes, m, a, u.role);
  if (!p("compras", "visualizar") && !p("ordens", "editar") && !podeVerCustoDeCompra(p)) {
    return NextResponse.json({ erro: "Sem permissão para ver custo de compra" }, { status: 403 });
  }
  const ids = (new URL(req.url).searchParams.get("produtoIds") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 200);
  return NextResponse.json(await ultimasCompras(guard.session.user!.empresaId, ids));
}
