import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { catalogoParaItemOs } from "@/lib/os/materiais-server";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/ordens/[id]/orcamento/catalogo?servicoId=… | ?produtoId=… — o item do catálogo pronto para entrar na OS:
 * preço do cliente da OS (tabela de preços ativa ou padrão) e, no serviço com composição, os materiais já
 * materializados (kit explodido, venda e custo). Tudo da empresa da sessão.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("ordens", "editar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  const { id } = await params;
  const os = await prisma.ordemServico.findFirst({ where: { id, empresaId }, select: { clienteId: true } });
  if (!os) return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });
  const sp = req.nextUrl.searchParams;
  const r = await catalogoParaItemOs(empresaId, os.clienteId, { servicoId: sp.get("servicoId"), produtoId: sp.get("produtoId") });
  if (!r) return NextResponse.json({ erro: "Item do catálogo não encontrado" }, { status: 404 });
  return NextResponse.json(r);
}
