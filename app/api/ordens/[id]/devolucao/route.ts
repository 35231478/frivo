import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { respostaRefEmpresa } from "@/lib/ref-empresa";
import { ErroEstoque } from "@/lib/estoque/servidor";
import { devolucaoSchema, mensagemSeparacao } from "@/lib/estoque/separacao";
import { ErroSeparacao, separacaoDaOs } from "@/lib/estoque/separacao-server";
import { desfazerDevolucao, devolverMateriais } from "@/lib/estoque/devolucao-server";

type Params = { params: Promise<{ id: string }> };

const tratar = (e: unknown) => {
  if (e instanceof ErroSeparacao || e instanceof ErroEstoque) return NextResponse.json({ erro: e.message }, { status: 400 });
  return respostaRefEmpresa(e);
};

/** GET /api/ordens/[id]/devolucao → os materiais da OS com o que há a devolver (Estoque › Separar material). */
export async function GET(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("estoque", "separar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const r = await separacaoDaOs(guard.session.user!.empresaId, id);
  if (!r) return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });
  return NextResponse.json(r);
}

/** POST /api/ordens/[id]/devolucao { materiais: [id] } — devolve ao estoque tudo o que há a devolver de cada material (DEVOLUCAO no razão). */
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("estoque", "separar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  const parsed = devolucaoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: mensagemSeparacao(parsed.error) }, { status: 400 });
  try {
    const r = await devolverMateriais(session.user!.empresaId, id, session.user!.id, parsed.data.materiais);
    if (!r) return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });
    return NextResponse.json(r);
  } catch (e) { const r = tratar(e); if (r) return r; throw e; }
}

/** DELETE /api/ordens/[id]/devolucao { id } — desfaz a devolução de um material (enquanto a OS não foi faturada). */
export async function DELETE(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("estoque", "separar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const materialId = typeof body?.id === "string" ? body.id.trim() : "";
  if (!materialId || materialId.length > 40) return NextResponse.json({ erro: "Material inválido." }, { status: 400 });
  try {
    const r = await desfazerDevolucao(session.user!.empresaId, id, session.user!.id, materialId);
    if (!r) return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });
    return NextResponse.json(r);
  } catch (e) { const r = tratar(e); if (r) return r; throw e; }
}
