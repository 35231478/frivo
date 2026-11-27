import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { recusaSchema } from "@/lib/tecnico/despesas";
import { recusarDespesa } from "@/lib/execucao/despesas";

type Params = { params: Promise<{ id: string }> };

/** POST { motivo } — recusa (motivo obrigatório; o colaborador vê no app). */
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("financeiro", "fluxoCaixa");
  if (guard.erro) return guard.resposta;
  const parsed = recusaSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Diga o motivo da recusa." }, { status: 400 });
  const { id } = await params;
  const r = await recusarDespesa(guard.session.user.empresaId, id, guard.session.user.id, parsed.data.motivo);
  return r.ok ? NextResponse.json(r.dados) : NextResponse.json({ erro: r.erro }, { status: r.status });
}
