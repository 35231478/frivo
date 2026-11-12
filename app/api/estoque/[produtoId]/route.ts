import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { paramsDe } from "@/lib/listagem";
import { extratoProduto } from "@/lib/estoque/servidor";

type Params = { params: Promise<{ produtoId: string }> };

/** GET /api/estoque/:produtoId?pagina=&por= → extrato (movimentações, mais recentes primeiro) */
export async function GET(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("estoque", "visualizar");
  if (guard.erro) return guard.resposta;
  const { produtoId } = await params;
  const extrato = await extratoProduto(guard.session.user!.empresaId, produtoId, paramsDe(req.nextUrl.searchParams));
  if (!extrato) return NextResponse.json({ erro: "Produto não encontrado" }, { status: 404 });
  return NextResponse.json(extrato);
}
