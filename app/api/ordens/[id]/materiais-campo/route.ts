import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { materiaisCampoDaOs } from "@/lib/execucao/materiais-campo";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/ordens/[id]/materiais-campo — o material que os técnicos lançaram pelo app nesta OS, com quem lançou,
 * quem corrigiu ou estornou e quando (as estornadas continuam na lista, como registro). Sem valores.
 */
export async function GET(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("ordens", "visualizar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const linhas = await materiaisCampoDaOs(guard.session.user.empresaId, id);
  if (!linhas) return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });
  return NextResponse.json({ linhas }, { headers: { "Cache-Control": "private, no-store" } });
}
