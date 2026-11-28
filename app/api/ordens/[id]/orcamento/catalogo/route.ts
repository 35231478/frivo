import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { catalogoParaItemOs } from "@/lib/os/materiais-server";
import { usuarioVeCustoDeCompra } from "@/lib/estoque/custo-acesso";
import { semCustoNosMateriais } from "@/lib/orcamentos/estoque-margem";
import { escopoBarra } from "@/lib/escopo/proprios-server";

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
  const foraDoEscopo = await escopoBarra("ordem", id); // COM-1: "Ver só os próprios" → 404
  if (foraDoEscopo) return foraDoEscopo;
  const os = await prisma.ordemServico.findFirst({ where: { id, empresaId }, select: { clienteId: true } });
  if (!os) return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });
  const sp = req.nextUrl.searchParams;
  const r = await catalogoParaItemOs(empresaId, os.clienteId, { servicoId: sp.get("servicoId"), produtoId: sp.get("produtoId") });
  if (!r) return NextResponse.json({ erro: "Item do catálogo não encontrado" }, { status: 404 });
  // Custo na OS: sem permissão de ver custo, os materiais vêm sem `custoUnit` (o salvar busca o custo no servidor)
  if (usuarioVeCustoDeCompra(guard.session.user)) return NextResponse.json(r);
  return NextResponse.json(r.tipo === "SERVICO" ? { ...r, materiais: semCustoNosMateriais(r.materiais) } : { ...r, material: semCustoNosMateriais([r.material])[0] });
}
