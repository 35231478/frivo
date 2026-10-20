import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { conciliar, ErroNota } from "@/lib/compras/notas";
import { conciliacaoSchema } from "@/lib/compras/validacao";

type Params = { params: Promise<{ id: string }> };

/** PUT /api/compras/notas/:id/conciliacao { itens: [{ itemId, produtoId } | { itemId, novo: { nome, unidade? } }] } */
export async function PUT(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("estoque", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const parsed = conciliacaoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos." }, { status: 400 });
  try {
    return NextResponse.json(await conciliar({ empresaId: guard.session.user!.empresaId, notaId: id, escolhas: parsed.data.itens }));
  } catch (e) {
    if (e instanceof ErroNota) return NextResponse.json({ erro: e.message, ...e.extra }, { status: e.status });
    throw e;
  }
}
