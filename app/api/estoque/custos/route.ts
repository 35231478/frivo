import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pode, type Permissoes } from "@/lib/permissoes";
import { custosParaTela } from "@/lib/estoque/composicao-server";
import { podeVerCustoDeCompra } from "@/lib/estoque/custo-acesso";

/**
 * GET /api/estoque/custos?ids=a,b,c → { custos: { [produtoId]: ultimoCustoDeCompra } }
 * Custo de referência dos produtos (E3.2: custo do kit e dos materiais inclusos no serviço). Só produtos da
 * empresa da sessão; quem não tem compra com custo não aparece.
 * Custo de compra é dado restrito (lib/estoque/custo-acesso): só quem tem Estoque › visualizar ou
 * Orçamentos › Ver custo e margem. Sem nenhuma das duas: 403 e o dado não sai do servidor.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  const u = session?.user;
  if (!u) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  if (!podeVerCustoDeCompra((m, a) => pode(u.permissoes as Permissoes, m, a, u.role))) {
    return NextResponse.json({ erro: "Sem permissão para ver custo de compra" }, { status: 403 });
  }
  const ids = (req.nextUrl.searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return NextResponse.json({ custos: await custosParaTela(u.empresaId, ids) });
}
