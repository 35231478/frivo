import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { tetoSchema } from "@/lib/comissoes/executor";
import { excluirTeto, salvarTeto } from "@/lib/comissoes/executor-server";

type Params = { params: Promise<{ id: string }> };

/** COM-2 — edita o teto (valor, alvo, ativo). "Desempenho › Gerenciar". */
export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("desempenho", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const parsed = tetoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.errors[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const r = await salvarTeto(guard.session.user!.empresaId, parsed.data, id);
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status });
  return NextResponse.json({ id: r.id });
}

/** COM-2 — exclui o teto (é configuração: o excedente que já passou para o mês seguinte continua lá). */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("desempenho", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  if (!(await excluirTeto(guard.session.user!.empresaId, id))) return NextResponse.json({ erro: "Teto não encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
