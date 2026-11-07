import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { custosParaTela } from "@/lib/estoque/composicao-server";

/**
 * GET /api/estoque/custos?ids=a,b,c → { custos: { [produtoId]: ultimoCustoDeCompra } }
 * Custo de referência dos produtos (E3.2: custo do kit e dos materiais inclusos no serviço). Só produtos da
 * empresa da sessão; quem não tem compra com custo não aparece. Qualquer usuário logado (quem edita o kit/serviço
 * já precisa de Configurações › gerenciar; o valor padrão do produto já é visível a todos).
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const ids = (req.nextUrl.searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return NextResponse.json({ custos: await custosParaTela(session.user.empresaId, ids) });
}
