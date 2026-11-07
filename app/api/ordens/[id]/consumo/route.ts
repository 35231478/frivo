import { NextRequest, NextResponse } from "next/server";
import { exigirAlgumaPermissao } from "@/lib/permissoes-server";
import { respostaRefEmpresa } from "@/lib/ref-empresa";
import { ErroEstoque } from "@/lib/estoque/servidor";
import { consumoSchema, mensagemSeparacao } from "@/lib/estoque/separacao";
import { ErroSeparacao } from "@/lib/estoque/separacao-server";
import { consumirMateriais, desfazerConsumo } from "@/lib/estoque/consumo-server";

type Params = { params: Promise<{ id: string }> };

const tratar = (e: unknown) => {
  if (e instanceof ErroSeparacao || e instanceof ErroEstoque) return NextResponse.json({ erro: e.message }, { status: 400 });
  return respostaRefEmpresa(e);
};

/**
 * POST /api/ordens/[id]/consumo { materiais: [{ id, quantidade }] } — informa o consumo (baixa definitiva): a reserva da
 * parte consumida vira SAIDA, o excedente é SAIDA a mais (aviso se o saldo não cobre), a sobra fica reservada. Quem
 * executa/conclui OS (Ordens › editar ou concluir). Depois, o status automático da OS é recalculado.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await exigirAlgumaPermissao([["ordens", "editar"], ["ordens", "concluir"]]);
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  const parsed = consumoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: mensagemSeparacao(parsed.error) }, { status: 400 });
  try {
    const r = await consumirMateriais(session.user!.empresaId, id, session.user!.id, parsed.data.materiais);
    if (!r) return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });
    return NextResponse.json(r);
  } catch (e) { const r = tratar(e); if (r) return r; throw e; }
}

/** DELETE /api/ordens/[id]/consumo { id } — desfaz o consumo de um material (enquanto a OS não foi finalizada). */
export async function DELETE(req: NextRequest, { params }: Params) {
  const guard = await exigirAlgumaPermissao([["ordens", "editar"], ["ordens", "concluir"]]);
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const materialId = typeof body?.id === "string" ? body.id.trim() : "";
  if (!materialId || materialId.length > 40) return NextResponse.json({ erro: "Material inválido." }, { status: 400 });
  try {
    const r = await desfazerConsumo(session.user!.empresaId, id, session.user!.id, materialId);
    if (!r) return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });
    return NextResponse.json(r);
  } catch (e) { const r = tratar(e); if (r) return r; throw e; }
}
